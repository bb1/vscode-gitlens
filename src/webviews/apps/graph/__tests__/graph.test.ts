import * as assert from 'assert';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import {
	parseGraphDisplayPreferences,
	parseGraphHostMessage,
	parseGraphWebviewMessage,
} from '../../../graph/protocol.js';
import type { IpcMessage } from '../../../ipc/models/ipc.js';
import { setHostIpcFactory } from '../../shared/ipc.js';
import {
	applyGraphMessage,
	createGraphState,
	focusVirtualizedGraphRow,
	GlGraphApp,
	getGraphFilterRequest,
	getGraphKeyboardAction,
	getGraphNavigationIndex,
	getGraphRowAction,
	getVisibleGraphColumns,
	getGraphRowView,
	shouldPageGraph,
	updateGraphSelection,
} from '../graph.js';
import type { GraphState } from '../graph.js';
import { layoutGraphRows } from '../laneLayout.js';

type Deferred<T> = {
	promise: Promise<T>;
	resolve(value: T): void;
};

type GraphAppTestView = {
	getRowContext(row: GitGraphRow): string;
	focusSelectedRow(): void;
	graph: GraphState;
	inspectorDismissed: boolean;
	inspectorOpen: boolean;
	isUpdatePending: boolean;
	minimapRange: { first: number; last: number };
	onKeyDown(event: KeyboardEvent): void;
	onMessageReceived(message: IpcMessage): void;
	onRangeChanged(event: CustomEvent<{ first: number; last: number }>): void;
	onRowKeyDown(event: KeyboardEvent): void;
	post(message: unknown): void;
	paging: boolean;
	requestUpdate(): void;
	renderRoot: { querySelector<T extends HTMLElement>(selectors: string): T | null };
	restoreSelectedRow(): void;
	selected: readonly string[];
	toggleCompact(event: Event): void;
	workspace: { display: { columns: readonly string[]; compact: boolean; minimap: boolean } };
};

const reactiveGraphProperties = [
	'graph',
	'workspace',
	'selected',
	'context',
	'details',
	'filterQuery',
	'inspectorOpen',
	'inspectorDismissed',
	'error',
	'minimapRange',
	'paging',
] as const;

function activateReactiveGraphState(app: GraphAppTestView): void {
	const instance = app as unknown as Record<string, unknown>;
	for (const property of reactiveGraphProperties) {
		const value = instance[property];
		Reflect.deleteProperty(instance, property);
		instance[property] = value;
	}

	app.isUpdatePending = false;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(res => {
		resolve = res;
	});

	return { promise: promise, resolve: resolve };
}

function row(sha: string, overrides?: Partial<GitGraphRow>): GitGraphRow {
	return {
		sha: sha,
		parents: [],
		author: 'Ada Lovelace',
		email: 'ada@example.com',
		date: Date.UTC(2026, 7, 14),
		message: 'Add graph',
		kind: 'commit',
		...overrides,
	};
}

suite('Graph app', () => {
	setup(() => {
		setHostIpcFactory(() => ({ getState: () => undefined, postMessage: () => {}, setState: () => {} }));
	});

	test('posts a validated filter request after committed search input', () => {
		assert.deepStrictEqual(getGraphFilterRequest('author:ada'), { type: 'graph/filter', query: 'author:ada' });
		assert.strictEqual(getGraphFilterRequest('x'.repeat(10001)), undefined);
	});

	test('keeps only visible graph, message, and refs columns in compact mode', () => {
		assert.deepStrictEqual(
			getVisibleGraphColumns({
				columns: ['graph', 'message', 'refs', 'author', 'date', 'sha'],
				compact: true,
				minimap: true,
			}),
			['graph', 'message', 'refs'],
		);
	});

	test('maps Space to toggling the focused row without discarding other selected rows', () => {
		assert.strictEqual(getGraphKeyboardAction({ key: ' ' }), 'toggle-selection');
		assert.deepStrictEqual(updateGraphSelection(['a', 'b'], ['a'], 'b', { toggle: true }), {
			active: 'b',
			selected: ['a', 'b'],
		});
	});

	test('toggles the focused row on Space and posts the multi-selection', () => {
		const app = new GlGraphApp() as unknown as GraphAppTestView;
		activateReactiveGraphState(app);
		app.graph = { layout: [], rows: [row('aaaaa'), row('bbbbb')], hasMore: false, selection: 'aaaaa' };
		app.selected = ['aaaaa'];
		app.inspectorDismissed = true;
		const posted: unknown[] = [];
		app.post = message => posted.push(message);
		app.isUpdatePending = false;
		let prevented = false;

		app.onRowKeyDown({
			key: ' ',
			preventDefault: () => {
				prevented = true;
			},
			target: {
				closest: <T extends HTMLElement>() => ({ dataset: { index: '1', sha: 'bbbbb' } }) as T,
			},
		} as unknown as KeyboardEvent);

		assert.strictEqual(prevented, true);
		assert.strictEqual(app.graph.selection, 'bbbbb');
		assert.deepStrictEqual(app.selected, ['aaaaa', 'bbbbb']);
		assert.strictEqual(app.inspectorOpen, true);
		assert.strictEqual(app.inspectorDismissed, false);
		assert.strictEqual(app.isUpdatePending, true);
		assert.deepStrictEqual(posted, [
			{ type: 'graph/selection/update', selection: ['aaaaa', 'bbbbb'] },
			{ type: 'graph/details', sha: 'bbbbb', includeFiles: false },
		]);
	});

	test('updates the visible inspector state when Escape closes it', () => {
		const app = new GlGraphApp() as unknown as GraphAppTestView;
		activateReactiveGraphState(app);
		app.inspectorOpen = true;
		app.isUpdatePending = false;
		app.focusSelectedRow = () => {};
		let prevented = false;

		app.onKeyDown({
			key: 'Escape',
			preventDefault: () => {
				prevented = true;
			},
		} as KeyboardEvent);

		assert.strictEqual(prevented, true);
		assert.strictEqual(app.inspectorOpen, false);
		assert.strictEqual(app.inspectorDismissed, true);
		assert.strictEqual(app.isUpdatePending, true);
	});

	test('updates the compact column header state after its display toggle', () => {
		const app = new GlGraphApp() as unknown as GraphAppTestView;
		activateReactiveGraphState(app);
		class Input {
			checked = true;
		}
		const htmlInputElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLInputElement');
		Object.defineProperty(globalThis, 'HTMLInputElement', { configurable: true, value: Input });

		try {
			app.toggleCompact({ target: new Input() } as unknown as Event);

			assert.strictEqual(app.workspace.display.compact, true);
			assert.deepStrictEqual(getVisibleGraphColumns(app.workspace.display), ['graph', 'message', 'refs']);
			assert.strictEqual(app.isUpdatePending, true);
		} finally {
			if (htmlInputElement == null) {
				delete (globalThis as { HTMLInputElement?: typeof Input }).HTMLInputElement;
			} else {
				Object.defineProperty(globalThis, 'HTMLInputElement', htmlInputElement);
			}
		}
	});

	test('updates the minimap viewport range after a virtualizer range event', () => {
		const app = new GlGraphApp() as unknown as GraphAppTestView;
		activateReactiveGraphState(app);
		app.graph = { layout: [], rows: [row('aaaaa'), row('bbbbb')], hasMore: true, selection: 'aaaaa' };
		app.isUpdatePending = false;

		app.onRangeChanged({ detail: { first: 1, last: 1 } } as CustomEvent<{ first: number; last: number }>);

		assert.deepStrictEqual(app.minimapRange, { first: 1, last: 1 });
		assert.strictEqual(app.paging, true);
		assert.strictEqual(app.isUpdatePending, true);
	});

	test('provides native multi-selection context for graph commands', () => {
		const app = new GlGraphApp() as unknown as GraphAppTestView;
		app.selected = ['aaaaa', 'bbbbb'];

		assert.deepStrictEqual(JSON.parse(app.getRowContext(row('aaaaa'))), {
			webviewItemValue: { type: 'commit', ref: 'aaaaa' },
			listMultiSelection: true,
			listDoubleSelection: true,
			webviewItems: 'gitlens:commit',
			webviewItemsUnion: 'gitlens:commit',
			webviewItemsValues: [
				{ webviewItem: 'gitlens:commit', webviewItemValue: { type: 'commit', ref: 'aaaaa' } },
				{ webviewItem: 'gitlens:commit', webviewItemValue: { type: 'commit', ref: 'bbbbb' } },
			],
		});
	});

	test('keeps an Escape-closed inspector closed across graph replacement', () => {
		const app = new GlGraphApp() as unknown as GraphAppTestView;
		app.graph = createGraphState();
		app.selected = [];
		app.inspectorDismissed = true;
		app.inspectorOpen = false;
		app.details = undefined;
		app.post = () => {};
		app.restoreSelectedRow = () => {};

		app.onMessageReceived({
			params: {
				type: 'graph/replace',
				rows: [row('aaaaa')],
				paging: { hasMore: false },
			},
		} as IpcMessage);

		assert.strictEqual(app.inspectorOpen, false);
	});

	test('ignores a virtualizer range event without bounds', () => {
		const app = new GlGraphApp() as unknown as GraphAppTestView;

		assert.doesNotThrow(() =>
			app.onRangeChanged({ detail: undefined } as unknown as CustomEvent<{ first: number; last: number }>),
		);
	});

	test('updates after the graph message task completes', async () => {
		const app = new GlGraphApp() as unknown as GraphAppTestView;
		let updates = 0;
		app.requestUpdate = () => {
			updates++;
		};

		app.onMessageReceived({
			params: {
				type: 'graph/context',
				repository: { name: 'repo' },
				refs: [],
			},
		} as IpcMessage);
		await new Promise(resolve => setTimeout(resolve, 0));

		assert.strictEqual(updates, 1);
	});

	test('restores focus to the rendered active row without waiting for the virtualizer', () => {
		let focused = false;
		const app = new GlGraphApp() as unknown as GraphAppTestView;
		app.graph = { layout: [], rows: [row('aaaaa')], hasMore: false, selection: 'aaaaa' };
		app.renderRoot = {
			querySelector: () =>
				({
					focus: () => {
						focused = true;
					},
				}) as HTMLElement,
		};

		app.focusSelectedRow();

		assert.strictEqual(focused, true);
	});

	test('applies bootstrap, append, and replacement row messages', () => {
		let state = createGraphState();
		state = applyGraphMessage(state, {
			type: 'graph/bootstrap',
			rows: [row('one')],
			paging: { hasMore: true },
			selection: 'one',
		});
		state = applyGraphMessage(state, {
			type: 'graph/append',
			rows: [row('two')],
			paging: { hasMore: false },
		});
		state = applyGraphMessage(state, {
			type: 'graph/replace',
			rows: [row('two'), row('three')],
			paging: { hasMore: false },
		});

		assert.deepStrictEqual(
			state.rows.map(r => r.sha),
			['two', 'three'],
		);
		assert.strictEqual(state.selection, 'two');
		assert.strictEqual(state.hasMore, false);
	});

	test('derives lane layout once for multiple row views in one state update', () => {
		let layouts = 0;
		const state = applyGraphMessage(
			createGraphState(),
			{
				type: 'graph/bootstrap',
				rows: [row('one'), row('two'), row('three')],
				paging: { hasMore: false },
				selection: 'one',
			},
			rows => {
				layouts++;
				return layoutGraphRows(rows);
			},
		);

		for (const [index, graphRow] of state.rows.entries()) {
			getGraphRowView(graphRow, state.layout[index]);
		}

		assert.strictEqual(layouts, 1);
	});

	test('provides lanes, refs, and an accessible row label', () => {
		const view = getGraphRowView(
			row('abcdef123456', {
				parents: ['parent'],
				heads: [{ id: 'main', name: 'main', isCurrentHead: true }],
				remotes: [{ id: 'origin/main', name: 'main', owner: 'origin' }],
				tags: [{ id: 'v1.0.0', name: 'v1.0.0', annotated: true }],
			}),
			{ lane: 0, edges: [{ from: 0, to: 0, parent: 'parent' }] },
		);

		assert.deepStrictEqual(view.refs, ['main', 'origin/main', 'v1.0.0']);
		assert.strictEqual(view.lane, 0);
		assert.strictEqual(
			view.ariaLabel,
			'Add graph, Ada Lovelace, 2026-08-14, abcdef123456, refs: main, origin/main, v1.0.0',
		);
	});

	test('uses an unknown date label when a finite row date is outside the Date range', () => {
		const view = getGraphRowView(row('abcdef123456', { date: Number.MAX_VALUE }), { lane: 0, edges: [] });

		assert.strictEqual(view.ariaLabel, 'Add graph, Ada Lovelace, Unknown date, abcdef123456, no refs');
	});

	test('parses only bounded host graph messages', () => {
		const valid = {
			type: 'graph/bootstrap',
			rows: [
				{
					sha: 'abcdef',
					parents: ['12345'],
					author: 'Ada Lovelace',
					email: 'ada@example.com',
					date: Date.UTC(2026, 7, 14),
					message: 'Add graph',
					kind: 'commit',
					heads: [{ name: 'main', ignored: 'metadata' }],
					remotes: [{ name: 'main', owner: 'origin', ignored: 'metadata' }],
					tags: [{ name: 'v1.0.0', ignored: 'metadata' }],
					ignored: { deeply: { nested: 'metadata' } },
				},
			],
			paging: { hasMore: true },
			selection: 'abcdef',
		};

		assert.deepStrictEqual(parseGraphHostMessage(valid), {
			type: 'graph/bootstrap',
			rows: [
				{
					sha: 'abcdef',
					parents: ['12345'],
					author: 'Ada Lovelace',
					email: 'ada@example.com',
					date: Date.UTC(2026, 7, 14),
					message: 'Add graph',
					kind: 'commit',
					heads: [{ name: 'main' }],
					remotes: [{ name: 'main', owner: 'origin' }],
					tags: [{ name: 'v1.0.0' }],
				},
			],
			paging: { hasMore: true },
			selection: 'abcdef',
		});

		for (const message of [
			null,
			{ type: 'graph/unknown', rows: [], paging: { hasMore: false } },
			{ type: 'graph/append', rows: Array(5001).fill(valid.rows[0]), paging: { hasMore: false } },
			{ type: 'graph/append', rows: [{ ...valid.rows[0], sha: 'nope!' }], paging: { hasMore: false } },
			{
				type: 'graph/append',
				rows: [{ ...valid.rows[0], parents: Array(65).fill('abcdef') }],
				paging: { hasMore: false },
			},
			{ type: 'graph/append', rows: [{ ...valid.rows[0], author: 'a'.repeat(257) }], paging: { hasMore: false } },
			{ type: 'graph/append', rows: [{ ...valid.rows[0], email: 'a'.repeat(321) }], paging: { hasMore: false } },
			{
				type: 'graph/append',
				rows: [{ ...valid.rows[0], message: 'a'.repeat(10001) }],
				paging: { hasMore: false },
			},
			{
				type: 'graph/append',
				rows: [{ ...valid.rows[0], date: Number.POSITIVE_INFINITY }],
				paging: { hasMore: false },
			},
			{ type: 'graph/append', rows: [{ ...valid.rows[0], commitDate: null }], paging: { hasMore: false } },
			{ type: 'graph/append', rows: [{ ...valid.rows[0], kind: 'unknown' }], paging: { hasMore: false } },
			{ type: 'graph/append', rows: [{ ...valid.rows[0], heads: [{ name: 1 }] }], paging: { hasMore: false } },
			{
				type: 'graph/append',
				rows: [{ ...valid.rows[0], heads: Array(65).fill({ name: 'main' }) }],
				paging: { hasMore: false },
			},
			{
				type: 'graph/append',
				rows: [{ ...valid.rows[0], remotes: [{ name: 'main' }] }],
				paging: { hasMore: false },
			},
			{ type: 'graph/append', rows: [{ ...valid.rows[0], tags: [{ name: 1 }] }], paging: { hasMore: false } },
			{ type: 'graph/append', rows: valid.rows, paging: { hasMore: 'yes' } },
			{ ...valid, selection: 'nope!' },
		]) {
			assert.strictEqual(parseGraphHostMessage(message), undefined);
		}
	});

	test('parses bounded workspace context and details messages', () => {
		assert.deepStrictEqual(
			parseGraphHostMessage({
				type: 'graph/context',
				repository: { name: 'vscode-gitlens', branch: 'main', ignored: true },
				refs: [
					{ type: 'head', name: 'main', ignored: true },
					{ type: 'remote', name: 'origin/main', ignored: true },
				],
			}),
			{
				type: 'graph/context',
				repository: { name: 'vscode-gitlens', branch: 'main' },
				refs: [
					{ type: 'head', name: 'main' },
					{ type: 'remote', name: 'origin/main' },
				],
			},
		);
		assert.deepStrictEqual(
			parseGraphHostMessage({ type: 'graph/error', operation: 'details', message: 'Could not load commit' }),
			{ type: 'graph/error', operation: 'details', message: 'Could not load commit' },
		);
		assert.deepStrictEqual(
			parseGraphHostMessage({
				type: 'graph/details',
				sha: 'abcdef',
				author: 'Ada Lovelace',
				date: Date.UTC(2026, 7, 14),
				message: 'Add graph workspace',
				refs: [{ type: 'head', name: 'main', ignored: true }],
				files: [{ path: 'src/webviews/graph/protocol.ts', status: 'M', ignored: true }],
			}),
			{
				type: 'graph/details',
				sha: 'abcdef',
				author: 'Ada Lovelace',
				date: Date.UTC(2026, 7, 14),
				message: 'Add graph workspace',
				refs: [{ type: 'head', name: 'main' }],
				files: [{ path: 'src/webviews/graph/protocol.ts', status: 'M' }],
			},
		);
	});

	test('parses only bounded workspace requests and display preferences', () => {
		assert.deepStrictEqual(parseGraphWebviewMessage({ type: 'graph/filter', query: 'author:ada' }), {
			type: 'graph/filter',
			query: 'author:ada',
		});
		assert.deepStrictEqual(
			parseGraphWebviewMessage({ type: 'graph/details', sha: 'abcdef', includeFiles: false }),
			{
				type: 'graph/details',
				sha: 'abcdef',
				includeFiles: false,
			},
		);
		assert.deepStrictEqual(
			parseGraphDisplayPreferences({
				columns: ['graph', 'message', 'refs', 'author', 'date', 'sha'],
				compact: false,
				minimap: true,
				ignored: true,
			}),
			{
				columns: ['graph', 'message', 'refs', 'author', 'date', 'sha'],
				compact: false,
				minimap: true,
			},
		);

		for (const message of [
			{ type: 'graph/filter', query: 'x'.repeat(10001) },
			{ type: 'graph/details', sha: 'not a sha', includeFiles: false },
			{ type: 'graph/details', sha: 'abcdef', includeFiles: 'false' },
			{ type: 'graph/error', operation: 'unknown', message: 'failed' },
			{ type: 'graph/error', operation: 'graph', message: 'x'.repeat(513) },
		]) {
			assert.strictEqual(parseGraphWebviewMessage(message), undefined);
		}

		for (const message of [
			{
				type: 'graph/context',
				repository: { name: 'repo' },
				refs: Array(65).fill({ type: 'head', name: 'main' }),
			},
			{
				type: 'graph/details',
				sha: 'abcdef',
				author: 'Ada Lovelace',
				date: Date.UTC(2026, 7, 14),
				message: 'Add graph workspace',
				refs: [],
				files: Array(1001).fill({ path: 'src/webviews/graph/protocol.ts', status: 'M' }),
			},
		]) {
			assert.strictEqual(parseGraphHostMessage(message), undefined);
		}

		for (const preferences of [
			{ columns: Array(7).fill('graph'), compact: false, minimap: true },
			{ columns: ['graph', 'graph'], compact: false, minimap: true },
		]) {
			assert.strictEqual(parseGraphDisplayPreferences(preferences), undefined);
		}
	});

	test('requests the next page only near the rendered end', () => {
		assert.strictEqual(shouldPageGraph(5, 20, true), false);
		assert.strictEqual(shouldPageGraph(17, 20, true), true);
		assert.strictEqual(shouldPageGraph(17, 20, false), false);
	});

	test('uses roving navigation keys within graph rows', () => {
		assert.strictEqual(getGraphNavigationIndex('ArrowDown', 2, 20), 3);
		assert.strictEqual(getGraphNavigationIndex('ArrowUp', 0, 20), 0);
		assert.strictEqual(getGraphNavigationIndex('Home', 12, 20), 0);
		assert.strictEqual(getGraphNavigationIndex('End', 12, 20), 19);
		assert.strictEqual(getGraphNavigationIndex('PageDown', 12, 20), 19);
		assert.strictEqual(getGraphNavigationIndex('PageUp', 12, 20), 2);
	});

	test('creates local, remote, and copy row action messages', () => {
		assert.deepStrictEqual(getGraphRowAction('copy-sha', 'abc123'), {
			type: 'graph/row/action',
			action: 'copy-sha',
			sha: 'abc123',
		});
		assert.deepStrictEqual(getGraphRowAction('open-local', 'abc123'), {
			type: 'graph/row/action',
			action: 'open-local',
			sha: 'abc123',
		});
		assert.deepStrictEqual(getGraphRowAction('open-remote', 'abc123'), {
			type: 'graph/row/action',
			action: 'open-remote',
			sha: 'abc123',
		});
	});

	test('maps row keyboard actions to local, remote, and copy messages', () => {
		assert.strictEqual(getGraphKeyboardAction({ key: 'Enter' }), 'open-local');
		assert.strictEqual(getGraphKeyboardAction({ key: 'Enter', altKey: true }), 'open-remote');
		assert.strictEqual(getGraphKeyboardAction({ key: 'c', ctrlKey: true }), 'copy-sha');
		assert.strictEqual(getGraphKeyboardAction({ key: 'ArrowDown' }), undefined);
	});

	test('waits for Lit and virtualizer completion before focusing a delayed row', async () => {
		const firstUpdate = deferred<void>();
		const renderedUpdate = deferred<void>();
		const layout = deferred<void>();
		const focused = { count: 0, focus: () => focused.count++ };
		let updateCalls = 0;
		let rowAvailable = false;
		let scrolled = false;

		const focus = focusVirtualizedGraphRow(4, {
			waitForUpdate: () => (++updateCalls === 1 ? firstUpdate.promise : renderedUpdate.promise),
			getVirtualizer: () => ({
				scrollToIndex: (index: number, position: string) => {
					assert.strictEqual(index, 4);
					assert.strictEqual(position, 'nearest');
					scrolled = true;
				},
				layoutComplete: layout.promise,
				updateComplete: Promise.resolve(),
			}),
			getRow: () => (rowAvailable ? focused : undefined),
		});

		assert.strictEqual(scrolled, false);
		assert.strictEqual(focused.count, 0);

		firstUpdate.resolve();
		await Promise.resolve();
		assert.strictEqual(scrolled, true);
		assert.strictEqual(focused.count, 0);

		rowAvailable = true;
		layout.resolve();
		await Promise.resolve();
		assert.strictEqual(focused.count, 0);

		renderedUpdate.resolve();
		await focus;
		assert.strictEqual(focused.count, 1);
	});

	test('waits for the virtualizer update when its layout promise is not ready', async () => {
		const virtualizerUpdate = deferred<void>();
		const focused = { count: 0, focus: () => focused.count++ };
		let completed = false;

		const focus = focusVirtualizedGraphRow(4, {
			waitForUpdate: () => Promise.resolve(),
			getVirtualizer: () => ({
				scrollToIndex: () => {},
				updateComplete: virtualizerUpdate.promise,
			}),
			getRow: () => focused,
		});
		void focus.then(() => {
			completed = true;
		});

		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		assert.strictEqual(completed, false);
		assert.strictEqual(focused.count, 0);

		virtualizerUpdate.resolve();
		await focus;
		assert.strictEqual(focused.count, 1);
	});
});
