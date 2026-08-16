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
	name:
		| 'executeRowAction'
		| 'onMessageReceived'
		| 'onReady'
		| 'onReconnect'
		| 'sendCommitDetails'
		| 'sendError'
		| 'sendWorkspaceContext',
): (...args: unknown[]) => unknown {
	return (GraphWebviewProvider.prototype as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
}

function getProviderAsyncMethod(
	name: 'sendCommitDetails' | 'sendError' | 'sendWorkspaceContext',
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
				more: async (...args: unknown[]) => {
					moreCalls.push(args);
				},
				filter: async (...args: unknown[]) => {
					filterCalls.push(args);
				},
			},
			detailsRequest: 0,
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
		assert.deepStrictEqual(detailCalls, [[{ type: 'graph/details', sha: 'abcdef', includeFiles: false }, 1]]);
		assert.deepStrictEqual(actionCalls, [[{ type: 'graph/row/action', action: 'copy-sha', sha: 'abcdef' }]]);
	});

	test('publishes rejected filter operations from the webview as retryable errors', async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		const notifications: unknown[] = [];
		const receiver: {
			controller: { filter(): Promise<never> };
			host: { notify(notification: unknown, payload: unknown): Promise<number> };
			sendError?: (...args: unknown[]) => Promise<void>;
		} = {
			controller: {
				filter: async () => {
					throw new Error('filter failed');
				},
			},
			host: { notify: async (_notification: unknown, payload: unknown) => notifications.push(payload) },
		};
		receiver.sendError = getProviderAsyncMethod('sendError');

		process.on('unhandledRejection', onUnhandled);
		try {
			getProviderMethod('onMessageReceived').call(
				receiver,
				message({ type: 'graph/filter', query: 'author:ada' }),
			);
			await flush();

			assert.deepStrictEqual(unhandled, []);
			assert.deepStrictEqual(notifications, [
				{ type: 'graph/error', operation: 'filter', message: 'filter failed' },
			]);
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

	test('publishes workspace context after the initial bootstrap reaches the webview', () => {
		const repository = { name: 'active-repository' };
		const contextCalls: unknown[][] = [];
		const receiver = {
			repository: repository,
			sendWorkspaceContext: async (...args: unknown[]) => {
				contextCalls.push(args);
			},
		};

		getProviderMethod('onReady').call(receiver);

		assert.deepStrictEqual(contextCalls, [[repository]]);
	});

	test('initializes the graph when a repository is discovered after the webview is ready', () => {
		const repository = { name: 'active-repository' };
		const initialization: unknown[][] = [];
		const receiver = {
			repository: undefined,
			container: { git: { getBestRepositoryOrFirst: () => repository } },
			initializeBestRepository: async (...args: unknown[]) => {
				initialization.push(args);
			},
		};

		getProviderMethod('onReady').call(receiver);

		assert.deepStrictEqual(initialization, [[]]);
	});

	test('replays graph data after the webview reconnects', () => {
		let republished = 0;
		const receiver = {
			republish: async () => {
				republished++;
			},
		};

		getProviderMethod('onReconnect').call(receiver);

		assert.strictEqual(republished, 1);
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

	test('returns workspace context provider failures to the caller for error publication', async () => {
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

		await assert.rejects(getProviderAsyncMethod('sendWorkspaceContext').call(receiver, repository), {
			message: 'branches failed',
		});
	});

	test('returns workspace context notification failures to the caller for error publication', async () => {
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

		await assert.rejects(getProviderAsyncMethod('sendWorkspaceContext').call(receiver, repository), {
			message: 'context notification failed',
		});
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

	test('ignores a stale commit detail failure after selection changes', async () => {
		let rejectFirstCommit!: (reason: Error) => void;
		const firstCommit = new Promise<object>((_resolve, reject) => {
			rejectFirstCommit = reject;
		});
		const notifications: unknown[] = [];
		const repository = {
			git: {
				commits: {
					getCommit: async (sha: string) => (sha === 'abcdef' ? firstCommit : commit(sha, 'Current commit')),
				},
			},
		};
		const receiver = {
			repository: repository,
			detailsRequest: 0,
			host: { notify: async (_notification: unknown, payload: unknown) => notifications.push(payload) },
		};
		const sendCommitDetails = getProviderAsyncMethod('sendCommitDetails');

		const stale = sendCommitDetails.call(receiver, { type: 'graph/details', sha: 'abcdef', includeFiles: false });
		await sendCommitDetails.call(receiver, { type: 'graph/details', sha: '123456', includeFiles: false });
		rejectFirstCommit(new Error('stale detail failed'));
		await stale;

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

	test('returns commit detail provider failures to the caller for error publication', async () => {
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

		await assert.rejects(
			getProviderAsyncMethod('sendCommitDetails').call(receiver, {
				type: 'graph/details',
				sha: 'abcdef',
				includeFiles: false,
			}),
			{ message: 'commit failed' },
		);
	});

	test('returns commit detail notification failures to the caller for error publication', async () => {
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

		await assert.rejects(
			getProviderAsyncMethod('sendCommitDetails').call(receiver, {
				type: 'graph/details',
				sha: 'abcdef',
				includeFiles: false,
			}),
			{ message: 'details notification failed' },
		);
	});

	test('returns unresolved remote ref failures to the caller for error publication', async () => {
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

		await assert.rejects(
			getProviderAsyncMethod('sendCommitDetails').call(receiver, {
				type: 'graph/details',
				sha: 'abcdef',
				includeFiles: false,
			}),
			{ message: 'remotes failed' },
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
