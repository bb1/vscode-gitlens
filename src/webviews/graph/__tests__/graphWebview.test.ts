import * as assert from 'assert';
import * as sinon from 'sinon';
import { commands } from 'vscode';
import { GraphWebviewProvider } from '../graphWebview.js';
import { parseGraphWebviewMessage } from '../protocol.js';

function message(params: unknown): {
	compressed: false;
	id: string;
	method: string;
	params: unknown;
	scope: 'graph';
	timestamp: number;
} {
	return {
		compressed: false,
		id: 'test',
		method: 'graph/action',
		params: params,
		scope: 'graph',
		timestamp: 0,
	};
}

function flush(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

function getProviderMethod(
	name: 'executeRowAction' | 'onMessageReceived' | 'sendCommitDetails' | 'sendWorkspaceContext',
): (...args: unknown[]) => unknown {
	return (GraphWebviewProvider.prototype as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
}

function getProviderAsyncMethod(
	name: 'sendCommitDetails' | 'sendWorkspaceContext',
): (...args: unknown[]) => Promise<void> {
	return (GraphWebviewProvider.prototype as unknown as Record<string, (...args: unknown[]) => Promise<void>>)[name];
}

suite('GraphWebviewProvider', () => {
	test('parses only bounded graph webview messages', () => {
		const selection = Array.from({ length: 1000 }, (_, i) => i.toString(16).padStart(5, '0'));

		assert.deepStrictEqual(parseGraphWebviewMessage({ type: 'graph/more', limit: 5000, targetId: 'abcdef' }), {
			type: 'graph/more',
			limit: 5000,
			targetId: 'abcdef',
		});
		assert.deepStrictEqual(
			parseGraphWebviewMessage({ type: 'graph/row/action', action: 'open-local', sha: 'abcdef' }),
			{
				type: 'graph/row/action',
				action: 'open-local',
				sha: 'abcdef',
			},
		);
		assert.deepStrictEqual(parseGraphWebviewMessage({ type: 'graph/selection/update', selection: selection }), {
			type: 'graph/selection/update',
			selection: selection,
		});

		for (const params of [
			null,
			[],
			{ type: 'graph/more' },
			{ type: 'graph/more', limit: 0 },
			{ type: 'graph/more', limit: 5001 },
			{ type: 'graph/more', limit: Number.POSITIVE_INFINITY },
			{ type: 'graph/more', limit: 1, targetId: 'nope!' },
			{ type: 'graph/row/action', action: 'delete', sha: 'abcdef' },
			{ type: 'graph/row/action', action: 'copy-sha', sha: 'abcd' },
			{ type: 'graph/selection/update', selection: ['abcdef', 'ABCDEF'] },
			{ type: 'graph/selection/update', selection: ['abcde', 'invalid'] },
			{ type: 'graph/selection/update', selection: Array(1001).fill('abcdef') },
		]) {
			assert.strictEqual(parseGraphWebviewMessage(params), undefined);
		}
	});

	test('ignores malformed graph messages before controller or action calls', () => {
		const moreCalls: unknown[][] = [];
		const filterCalls: unknown[][] = [];
		const detailCalls: unknown[][] = [];
		const actionCalls: unknown[][] = [];
		const receiver = {
			controller: {
				more: (...args: unknown[]) => moreCalls.push(args),
				filter: async (...args: unknown[]) => {
					filterCalls.push(args);
				},
			},
			sendCommitDetails: async (...args: unknown[]) => {
				detailCalls.push(args);
			},
			executeRowAction: (...args: unknown[]) => actionCalls.push(args),
		};
		const onMessageReceived = getProviderMethod('onMessageReceived');

		for (const params of [
			{ type: 'graph/more', limit: -1 },
			{ type: 'graph/more', limit: 1.5 },
			{ type: 'graph/more', limit: 1, targetId: 'abc!' },
			{ type: 'graph/row/action', action: 'copy-sha', sha: 'not-a-sha' },
			{ type: 'graph/selection/update', selection: ['abcdef', 'abcdef'] },
			{ type: 'graph/selection/update', selection: Array(1001).fill('abcdef') },
		]) {
			onMessageReceived.call(receiver, message(params));
		}

		assert.deepStrictEqual(moreCalls, []);
		assert.deepStrictEqual(filterCalls, []);
		assert.deepStrictEqual(detailCalls, []);
		assert.deepStrictEqual(actionCalls, []);

		onMessageReceived.call(receiver, message({ type: 'graph/more', limit: 1, targetId: 'abcdef' }));
		onMessageReceived.call(receiver, message({ type: 'graph/filter', query: 'author:ada' }));
		onMessageReceived.call(receiver, message({ type: 'graph/details', sha: 'abcdef', includeFiles: false }));
		onMessageReceived.call(receiver, message({ type: 'graph/row/action', action: 'copy-sha', sha: 'abcdef' }));

		assert.deepStrictEqual(moreCalls, [[1, 'abcdef']]);
		assert.deepStrictEqual(filterCalls, [['author:ada']]);
		assert.deepStrictEqual(detailCalls, [[{ type: 'graph/details', sha: 'abcdef', includeFiles: false }]]);
		assert.deepStrictEqual(actionCalls, [[{ type: 'graph/row/action', action: 'copy-sha', sha: 'abcdef' }]]);
	});

	test('observes rejected filter operations from the webview', async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		const receiver = {
			controller: {
				filter: async () => {
					throw new Error('filter failed');
				},
			},
		};

		process.on('unhandledRejection', onUnhandled);
		try {
			getProviderMethod('onMessageReceived').call(
				receiver,
				message({ type: 'graph/filter', query: 'author:ada' }),
			);
			await flush();

			assert.deepStrictEqual(unhandled, []);
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});

	test('ignores filter requests before controller initialization', () => {
		const receiver = { controller: undefined };

		assert.doesNotThrow(() => {
			getProviderMethod('onMessageReceived').call(
				receiver,
				message({ type: 'graph/filter', query: 'author:ada' }),
			);
		});
	});

	test('publishes workspace context for the active repository', async () => {
		const notifications: unknown[] = [];
		const repository = {
			name: 'active-repository',
			git: {
				branches: {
					getBranches: async () => ({
						values: [
							{ name: 'main', current: true, remote: false },
							{ name: 'feature', current: false, remote: false },
							{ name: 'origin/main', current: false, remote: true },
						],
					}),
				},
				tags: { getTags: async () => ({ values: [{ name: 'v1.0.0' }] }) },
			},
		};
		const receiver = {
			repository: repository,
			contextRequest: 0,
			host: { notify: async (_notification: unknown, payload: unknown) => notifications.push(payload) },
		};

		await getProviderMethod('sendWorkspaceContext').call(receiver, repository);

		assert.deepStrictEqual(notifications, [
			{
				type: 'graph/context',
				repository: { name: 'active-repository', branch: 'main' },
				refs: [
					{ type: 'head', name: 'main' },
					{ type: 'branch', name: 'feature' },
					{ type: 'remote', name: 'origin/main' },
					{ type: 'tag', name: 'v1.0.0' },
				],
			},
		]);
	});

	test('bounds workspace context refs to the protocol limit', async () => {
		const notifications: unknown[] = [];
		const repository = {
			name: 'active-repository',
			git: {
				branches: {
					getBranches: async () => ({
						values: Array.from({ length: 65 }, (_, i) => ({
							name: `branch-${i}`,
							current: i === 0,
							remote: false,
						})),
					}),
				},
				tags: { getTags: async () => ({ values: [] }) },
			},
		};
		const receiver = {
			repository: repository,
			contextRequest: 0,
			host: { notify: async (_notification: unknown, payload: unknown) => notifications.push(payload) },
		};

		await getProviderMethod('sendWorkspaceContext').call(receiver, repository);

		assert.strictEqual((notifications[0] as { refs: unknown[] }).refs.length, 64);
	});

	test('absorbs rejected workspace context provider calls', async () => {
		const repository = {
			name: 'active-repository',
			git: {
				branches: { getBranches: async () => Promise.reject(new Error('branches failed')) },
				tags: { getTags: async () => ({ values: [] }) },
			},
		};
		const receiver = {
			repository: repository,
			contextRequest: 0,
			host: { notify: async () => {} },
		};

		await assert.doesNotReject(getProviderAsyncMethod('sendWorkspaceContext').call(receiver, repository));
	});

	test('absorbs rejected workspace context notifications', async () => {
		const repository = {
			name: 'active-repository',
			git: {
				branches: { getBranches: async () => ({ values: [] }) },
				tags: { getTags: async () => ({ values: [] }) },
			},
		};
		const receiver = {
			repository: repository,
			contextRequest: 0,
			host: { notify: async () => Promise.reject(new Error('context notification failed')) },
		};

		await assert.doesNotReject(getProviderAsyncMethod('sendWorkspaceContext').call(receiver, repository));
	});

	test('sends selected commit details from the active repository and ignores stale results', async () => {
		let resolveFirstCommit!: (value: object) => void;
		const firstCommit = new Promise<object>(resolve => {
			resolveFirstCommit = resolve;
		});
		const activeCommitCalls: string[] = [];
		const inactiveCommitCalls: string[] = [];
		const notifications: unknown[] = [];
		const activeRepository = {
			git: {
				commits: {
					getCommit: async (sha: string) => {
						activeCommitCalls.push(sha);
						return sha === 'abcdef' ? firstCommit : commit(sha, 'Current commit');
					},
				},
				branches: { getBranches: async () => ({ values: [] }) },
				tags: { getTags: async () => ({ values: [] }) },
			},
		};
		const inactiveRepository = {
			git: { commits: { getCommit: async (sha: string) => inactiveCommitCalls.push(sha) } },
		};
		const receiver = {
			repository: activeRepository,
			detailsRequest: 0,
			host: { notify: async (_notification: unknown, payload: unknown) => notifications.push(payload) },
		};
		const sendCommitDetails = getProviderMethod('sendCommitDetails');

		const stale = sendCommitDetails.call(receiver, { type: 'graph/details', sha: 'abcdef', includeFiles: false });
		const current = sendCommitDetails.call(receiver, { type: 'graph/details', sha: '123456', includeFiles: false });
		await current;
		resolveFirstCommit(commit('abcdef', 'Stale commit'));
		await stale;

		assert.deepStrictEqual(activeCommitCalls, ['abcdef', '123456']);
		assert.deepStrictEqual(inactiveCommitCalls, []);
		assert.deepStrictEqual(notifications, [
			{
				type: 'graph/details',
				sha: '123456',
				author: 'Ada Lovelace',
				date: Date.UTC(2026, 7, 15),
				message: 'Current commit',
				refs: [],
			},
		]);
	});

	test('absorbs rejected commit details provider calls', async () => {
		const repository = {
			git: {
				commits: { getCommit: async () => Promise.reject(new Error('commit failed')) },
			},
		};
		const receiver = {
			repository: repository,
			detailsRequest: 0,
			host: { notify: async () => {} },
		};

		await assert.doesNotReject(
			getProviderAsyncMethod('sendCommitDetails').call(receiver, {
				type: 'graph/details',
				sha: 'abcdef',
				includeFiles: false,
			}),
		);
	});

	test('absorbs rejected commit details notifications', async () => {
		const repository = {
			git: {
				commits: { getCommit: async () => commit('abcdef', 'Current commit') },
			},
		};
		const receiver = {
			repository: repository,
			detailsRequest: 0,
			host: { notify: async () => Promise.reject(new Error('details notification failed')) },
		};

		await assert.doesNotReject(
			getProviderAsyncMethod('sendCommitDetails').call(receiver, {
				type: 'graph/details',
				sha: 'abcdef',
				includeFiles: false,
			}),
		);
	});

	test('does not publish details with unresolved remote refs', async () => {
		const notifications: unknown[] = [];
		const repository = {
			git: {
				commits: { getCommit: async () => commit('abcdef', 'Current commit', ['origin/main']) },
				remotes: { getRemotes: async () => Promise.reject(new Error('remotes failed')) },
			},
		};
		const receiver = {
			repository: repository,
			detailsRequest: 0,
			host: { notify: async (_notification: unknown, payload: unknown) => notifications.push(payload) },
		};

		await assert.doesNotReject(
			getProviderAsyncMethod('sendCommitDetails').call(receiver, {
				type: 'graph/details',
				sha: 'abcdef',
				includeFiles: false,
			}),
		);

		assert.deepStrictEqual(notifications, []);
	});

	test('does not publish details after the active repository changes', async () => {
		let resolveCommit!: (value: object) => void;
		const pendingCommit = new Promise<object>(resolve => {
			resolveCommit = resolve;
		});
		const activeCommitCalls: string[] = [];
		const inactiveCommitCalls: string[] = [];
		const notifications: unknown[] = [];
		const activeRepository = {
			git: {
				commits: {
					getCommit: async (sha: string) => {
						activeCommitCalls.push(sha);
						return pendingCommit;
					},
				},
			},
		};
		const inactiveRepository = {
			git: {
				commits: {
					getCommit: async (sha: string) => {
						inactiveCommitCalls.push(sha);
						return commit(sha, 'Inactive commit');
					},
				},
			},
		};
		const receiver = {
			repository: activeRepository,
			detailsRequest: 0,
			host: { notify: async (_notification: unknown, payload: unknown) => notifications.push(payload) },
		};
		const sendCommitDetails = getProviderMethod('sendCommitDetails');

		const details = sendCommitDetails.call(receiver, { type: 'graph/details', sha: 'abcdef', includeFiles: false });
		receiver.repository = inactiveRepository;
		resolveCommit(commit('abcdef', 'Stale commit'));
		await details;

		assert.deepStrictEqual(activeCommitCalls, ['abcdef']);
		assert.deepStrictEqual(inactiveCommitCalls, []);
		assert.deepStrictEqual(notifications, []);
	});

	test('serializes commit decoration refs with the active repository remotes', async () => {
		const notifications: unknown[] = [];
		const repository = {
			git: {
				commits: {
					getCommit: async () =>
						commit('abcdef', 'Current commit', [
							'HEAD',
							'->',
							'main,',
							'tag:',
							'v1.0.0,',
							'origin/main,',
							'refs/stash',
						]),
				},
				remotes: { getRemotes: async () => [{ name: 'origin' }] },
			},
		};
		const receiver = {
			repository: repository,
			detailsRequest: 0,
			host: { notify: async (_notification: unknown, payload: unknown) => notifications.push(payload) },
		};

		await getProviderMethod('sendCommitDetails').call(receiver, {
			type: 'graph/details',
			sha: 'abcdef',
			includeFiles: false,
		});

		assert.deepStrictEqual((notifications[0] as { refs: unknown[] }).refs, [
			{ type: 'head', name: 'main' },
			{ type: 'tag', name: 'v1.0.0' },
			{ type: 'remote', name: 'origin/main' },
		]);
	});

	test('revalidates row actions and uses the host-owned repository path', () => {
		const executeCommand = sinon.stub(commands, 'executeCommand').resolves(undefined);
		const executeRowAction = getProviderMethod('executeRowAction');
		const receiver = { repository: { path: '/host/repository' } };

		try {
			executeRowAction.call(receiver, {
				action: 'open-local',
				sha: 'not-a-sha',
				repoPath: '/webview/repository',
			});
			assert.strictEqual(executeCommand.called, false);

			executeRowAction.call(receiver, { action: 'open-local', sha: 'abcdef', repoPath: '/webview/repository' });
			assert.deepStrictEqual(executeCommand.firstCall.args, [
				'gitlens.showCommitInView',
				{ ref: { ref: 'abcdef', refType: 'revision', repoPath: '/host/repository' } },
			]);
		} finally {
			executeCommand.restore();
		}
	});
});

function commit(sha: string, message: string, tips?: string[]): object {
	return {
		sha: sha,
		author: { name: 'Ada Lovelace', date: new Date(Date.UTC(2026, 7, 15)) },
		message: message,
		summary: message,
		...(tips == null ? {} : { tips: tips }),
	};
}
