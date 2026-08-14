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

function getProviderMethod(name: 'executeRowAction' | 'onMessageReceived'): (...args: unknown[]) => void {
	return (GraphWebviewProvider.prototype as unknown as Record<string, (...args: unknown[]) => void>)[name];
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
		const actionCalls: unknown[][] = [];
		const receiver = {
			controller: { more: (...args: unknown[]) => moreCalls.push(args) },
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
		assert.deepStrictEqual(actionCalls, []);

		onMessageReceived.call(receiver, message({ type: 'graph/more', limit: 1, targetId: 'abcdef' }));
		onMessageReceived.call(receiver, message({ type: 'graph/row/action', action: 'copy-sha', sha: 'abcdef' }));

		assert.deepStrictEqual(moreCalls, [[1, 'abcdef']]);
		assert.deepStrictEqual(actionCalls, [[{ type: 'graph/row/action', action: 'copy-sha', sha: 'abcdef' }]]);
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
