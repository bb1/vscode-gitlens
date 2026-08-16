import * as assert from 'assert';
import type { GitGraph, GitGraphRow } from '@gitlens/git/models/graph.js';
import type {
	GitGraphSession,
	GitGraphSessionRefreshOptions,
	GitGraphSessionRefreshResult,
} from '@gitlens/git/models/graphSession.js';
import { GraphSessionController } from '../graphSessionController.js';
import type { GraphHostMessage } from '../protocol.js';

type Deferred<T> = {
	promise: Promise<T>;
	resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(res => {
		resolve = res;
	});

	return { promise: promise, resolve: resolve };
}

function flush(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

function graph(rows: GitGraphRow[], paging?: { hasMore: boolean }): GitGraph {
	return {
		repoPath: '/repo',
		avatars: new Map(),
		ids: new Set(rows.map(row => row.sha)),
		includes: undefined,
		branches: new Map(),
		remotes: new Map(),
		downstreams: new Map(),
		stashes: undefined,
		worktrees: undefined,
		worktreesByBranch: undefined,
		rows: rows,
		paging: paging == null ? undefined : { limit: undefined, startingCursor: undefined, hasMore: paging.hasMore },
	};
}

function row(sha: string): GitGraphRow {
	return {
		sha: sha,
		parents: [],
		author: 'Author',
		email: 'author@example.com',
		date: 0,
		message: sha,
		kind: 'commit',
	};
}

class FakeGraphSession implements GitGraphSession {
	readonly repoPath = '/repo';
	window: readonly GitGraphRow[];
	current: GitGraph;
	disposeCount = 0;
	moreCalls: Array<{ limit: number | undefined; targetId: string | undefined }> = [];
	moreSignals: AbortSignal[] = [];
	refreshCalls: GitGraphSessionRefreshOptions[] = [];
	moreResult = true;
	moreResults: Array<boolean | Promise<boolean>> = [];

	constructor(rows: GitGraphRow[]) {
		this.window = rows;
		this.current = graph(rows, { hasMore: true });
	}

	async more(limit?: number, targetId?: string, cancellation?: AbortSignal): Promise<boolean> {
		this.moreCalls.push({ limit: limit, targetId: targetId });
		if (cancellation != null) {
			this.moreSignals.push(cancellation);
		}
		const result = this.moreResults.shift();
		if (result != null) {
			return result;
		}

		return this.moreResult;
	}

	async refresh(options?: GitGraphSessionRefreshOptions): Promise<GitGraphSessionRefreshResult> {
		this.refreshCalls.push(options ?? {});
		return {
			path: 'full',
			changed: { rows: true, reachability: true, rowsStats: true, avatars: true, downstreams: true },
		};
	}

	dispose(): void {
		this.disposeCount++;
	}
}

suite('GraphSessionController', () => {
	test('opens one session and sends its full bootstrap snapshot', async () => {
		const session = new FakeGraphSession([row('first')]);
		const sent: unknown[] = [];
		const controller = new GraphSessionController({
			open: async () => session,
			postMessage: async message => {
				sent.push(message);
			},
		});

		await controller.open();

		assert.deepStrictEqual(sent, [
			{ type: 'graph/bootstrap', rows: [row('first')], paging: { hasMore: true }, selection: undefined },
		]);
	});

	test('replays the current bootstrap without reopening the session', async () => {
		const session = new FakeGraphSession([row('first')]);
		const sent: unknown[] = [];
		let openCalls = 0;
		const controller = new GraphSessionController({
			open: async () => {
				openCalls++;
				return session;
			},
			postMessage: async message => {
				sent.push(message);
			},
		});

		await controller.open();
		await controller.open();

		assert.strictEqual(openCalls, 1);
		assert.deepStrictEqual(sent, [
			{ type: 'graph/bootstrap', rows: [row('first')], paging: { hasMore: true }, selection: undefined },
			{ type: 'graph/bootstrap', rows: [row('first')], paging: { hasMore: true }, selection: undefined },
		]);
	});

	test('retries opening after the session opener rejects', async () => {
		const session = new FakeGraphSession([row('second')]);
		const sent: unknown[] = [];
		let openCalls = 0;
		const controller = new GraphSessionController({
			open: async () => {
				openCalls++;
				if (openCalls === 1) throw new Error('open failed');

				return session;
			},
			postMessage: async message => {
				sent.push(message);
			},
		});

		await assert.rejects(controller.open(), { message: 'open failed' });
		const retry = await controller.open().then(
			() => 'resolved',
			() => 'rejected',
		);

		assert.strictEqual(retry, 'resolved');
		assert.strictEqual(openCalls, 2);
		assert.deepStrictEqual(sent, [
			{ type: 'graph/bootstrap', rows: [row('second')], paging: { hasMore: true }, selection: undefined },
		]);
	});

	test('disposes the failed session and retries after bootstrap delivery rejects', async () => {
		const failedSession = new FakeGraphSession([row('first')]);
		const retrySession = new FakeGraphSession([row('second')]);
		const sent: unknown[] = [];
		let openCalls = 0;
		const controller = new GraphSessionController({
			open: async () => {
				openCalls++;
				return openCalls === 1 ? failedSession : retrySession;
			},
			postMessage: async message => {
				if (message.type === 'graph/bootstrap' && openCalls === 1) throw new Error('bootstrap failed');

				sent.push(message);
			},
		});

		await assert.rejects(controller.open(), { message: 'bootstrap failed' });
		assert.strictEqual(failedSession.disposeCount, 1);
		await controller.open();

		assert.strictEqual(openCalls, 2);
		assert.deepStrictEqual(sent, [
			{ type: 'graph/bootstrap', rows: [row('second')], paging: { hasMore: true }, selection: undefined },
		]);
	});

	test('shares an in-flight opening attempt between callers', async () => {
		const session = new FakeGraphSession([row('first')]);
		const openSession = deferred<GitGraphSession>();
		let openCalls = 0;
		const controller = new GraphSessionController({
			open: async () => {
				openCalls++;
				return openSession.promise;
			},
			postMessage: async () => {},
		});

		const first = controller.open();
		const second = controller.open();

		assert.strictEqual(first, second);
		assert.strictEqual(openCalls, 1);
		openSession.resolve(session);
		await first;
	});

	test('waits for bootstrap delivery before paging', async () => {
		const session = new FakeGraphSession([row('first')]);
		const bootstrapSent = deferred<void>();
		const releaseBootstrap = deferred<void>();
		const controller = new GraphSessionController({
			open: async () => session,
			postMessage: async message => {
				if (message.type === 'graph/bootstrap') {
					bootstrapSent.resolve();
					await releaseBootstrap.promise;
				}
			},
		});

		const opening = controller.open();
		await bootstrapSent.promise;
		const more = controller.more();
		await Promise.resolve();

		assert.deepStrictEqual(session.moreCalls, []);
		releaseBootstrap.resolve();
		await opening;
		await more;
		assert.deepStrictEqual(session.moreCalls, [{ limit: undefined, targetId: undefined }]);
	});

	test('serializes more calls and appends each page after it resolves', async () => {
		const session = new FakeGraphSession([row('first')]);
		const firstMore = deferred<boolean>();
		const secondMore = deferred<boolean>();
		const sent: unknown[] = [];
		session.moreResults = [firstMore.promise, secondMore.promise];
		const controller = new GraphSessionController({
			open: async () => session,
			postMessage: async message => {
				sent.push(message);
			},
		});
		await controller.open();

		const one = controller.more(10, 'one');
		const two = controller.more(20, 'two');
		await flush();
		assert.deepStrictEqual(session.moreCalls, [{ limit: 10, targetId: 'one' }]);

		session.current = graph([row('second')], { hasMore: true });
		firstMore.resolve(true);
		await one;
		await flush();
		assert.deepStrictEqual(session.moreCalls, [
			{ limit: 10, targetId: 'one' },
			{ limit: 20, targetId: 'two' },
		]);

		session.current = graph([row('third')], { hasMore: false });
		secondMore.resolve(true);
		await two;

		assert.deepStrictEqual(sent.slice(1), [
			{ type: 'graph/append', rows: [row('second')], paging: { hasMore: true } },
			{ type: 'graph/append', rows: [row('third')], paging: { hasMore: false } },
		]);
	});

	test('replaces the complete window after refresh', async () => {
		const session = new FakeGraphSession([row('first')]);
		const sent: unknown[] = [];
		const controller = new GraphSessionController({
			open: async () => session,
			postMessage: async message => {
				sent.push(message);
			},
		});
		await controller.open();
		session.window = [row('new-first'), row('new-second')];
		session.current = graph([...session.window], { hasMore: false });

		await controller.refresh({ limit: 50 });

		assert.deepStrictEqual(session.refreshCalls, [{ limit: 50 }]);
		assert.deepStrictEqual(sent.at(-1), {
			type: 'graph/replace',
			rows: [row('new-first'), row('new-second')],
			paging: { hasMore: false },
		});
	});

	test('serializes filtering after an active graph operation', async () => {
		const session = new FakeGraphSession([row('first')]);
		const pendingMore = deferred<boolean>();
		const sent: unknown[] = [];
		session.moreResults = [pendingMore.promise];
		const options = {
			open: async () => session,
			postMessage: async (message: GraphHostMessage) => {
				sent.push(message);
			},
		};
		const controller = new GraphSessionController(options);
		await controller.open();

		const more = controller.more();
		await flush();
		const filter = controller.filter('author:ada');
		await flush();

		assert.deepStrictEqual(sent, [
			{ type: 'graph/bootstrap', rows: [row('first')], paging: { hasMore: true }, selection: undefined },
		]);
		session.window = [row('first'), row('second')];
		pendingMore.resolve(false);
		await more;
		await filter;

		assert.deepStrictEqual(sent.at(-1), {
			type: 'graph/replace',
			rows: [],
			paging: { hasMore: true },
		});
	});

	test('restores the loaded window when filtering is cleared', async () => {
		const session = new FakeGraphSession([row('first'), row('second')]);
		const sent: unknown[] = [];
		const controller = new GraphSessionController({
			open: async () => session,
			postMessage: async (message: GraphHostMessage) => {
				sent.push(message);
			},
		});
		await controller.open();

		await controller.filter('second');
		await controller.filter('');

		assert.deepStrictEqual(sent, [
			{
				type: 'graph/bootstrap',
				rows: [row('first'), row('second')],
				paging: { hasMore: true },
				selection: undefined,
			},
			{ type: 'graph/replace', rows: [row('second')], paging: { hasMore: true } },
			{ type: 'graph/replace', rows: [row('first'), row('second')], paging: { hasMore: true } },
		]);
	});

	test('filters loaded rows and keeps subsequent pages filtered', async () => {
		const session = new FakeGraphSession([row('match-first'), row('other')]);
		const sent: unknown[] = [];
		const controller = new GraphSessionController({
			open: async () => session,
			postMessage: async message => {
				sent.push(message);
			},
		});
		await controller.open();

		await controller.filter('match');
		session.current = graph([row('other-page'), row('match-second')], { hasMore: false });
		await controller.more();

		assert.deepStrictEqual(sent.slice(1), [
			{ type: 'graph/replace', rows: [row('match-first')], paging: { hasMore: true } },
			{ type: 'graph/append', rows: [row('match-second')], paging: { hasMore: false } },
		]);
	});

	test('disposes once, aborts a pending page, and prevents its late append', async () => {
		const session = new FakeGraphSession([row('first')]);
		const pendingMore = deferred<boolean>();
		const sent: unknown[] = [];
		session.moreResults = [pendingMore.promise];
		const controller = new GraphSessionController({
			open: async () => session,
			postMessage: async message => {
				sent.push(message);
			},
		});
		await controller.open();

		const more = controller.more();
		await flush();
		controller.dispose();
		controller.dispose();
		session.current = graph([row('late')], { hasMore: false });
		pendingMore.resolve(true);
		await more;

		assert.strictEqual(session.disposeCount, 1);
		assert.strictEqual(session.moreSignals[0]?.aborted, true);
		assert.deepStrictEqual(sent, [
			{ type: 'graph/bootstrap', rows: [row('first')], paging: { hasMore: true }, selection: undefined },
		]);
		await assert.rejects(controller.refresh(), { message: 'GraphSessionController is disposed' });
	});
});
