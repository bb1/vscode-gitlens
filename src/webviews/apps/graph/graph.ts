import type { LitVirtualizer } from '@lit-labs/virtualizer';
import { flow } from '@lit-labs/virtualizer/layouts/flow.js';
import { html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { serializeWebviewItemContext } from '../../../system/webview.js';
import type { GraphHostMessage, GraphRowAction, GraphWebviewMessage, GraphWebviewRow } from '../../graph/protocol.js';
import { parseGraphHostMessage } from '../../graph/protocol.js';
import type { IpcMessage } from '../../ipc/models/ipc.js';
import { SignalWatcherWebviewApp } from '../shared/appBase.js';
import { ContextMenuProxyController } from '../shared/controllers/context-menu-proxy.js';
import { getHostIpcApi } from '../shared/ipc.js';
import { graphStyles } from './graph.css.js';
import { layoutGraphRows } from './laneLayout.js';
import type { GraphLayoutRow } from './laneLayout.js';
import '@lit-labs/virtualizer';

export type GraphState = {
	readonly layout: readonly GraphLayoutRow[];
	readonly rows: readonly GraphWebviewRow[];
	readonly hasMore: boolean;
	readonly selection: string | undefined;
};

export type GraphRowView = {
	readonly ariaLabel: string;
	readonly lane: number;
	readonly refs: readonly string[];
};

const pageThreshold = 3;
const pageSize = 200;

export function createGraphState(): GraphState {
	return { layout: [], rows: [], hasMore: false, selection: undefined };
}

export function applyGraphMessage(
	state: GraphState,
	message: GraphHostMessage,
	deriveLayout: (rows: readonly GraphWebviewRow[]) => readonly GraphLayoutRow[] = layoutGraphRows,
): GraphState {
	switch (message.type) {
		case 'graph/bootstrap': {
			const rows = message.rows;
			return createGraphStateForRows(
				rows,
				message.paging.hasMore,
				message.selection ?? rows[0]?.sha,
				deriveLayout,
			);
		}
		case 'graph/append': {
			const rows = [...state.rows, ...message.rows];
			return createGraphStateForRows(rows, message.paging.hasMore, state.selection, deriveLayout);
		}
		case 'graph/replace': {
			const rows = message.rows;
			return createGraphStateForRows(
				rows,
				message.paging.hasMore,
				rows.some(row => row.sha === state.selection) ? state.selection : rows[0]?.sha,
				deriveLayout,
			);
		}
		case 'graph/context':
		case 'graph/details':
			return state;
	}
}

function createGraphStateForRows(
	rows: readonly GraphWebviewRow[],
	hasMore: boolean,
	selection: string | undefined,
	deriveLayout: (rows: readonly GraphWebviewRow[]) => readonly GraphLayoutRow[],
): GraphState {
	return { layout: deriveLayout(rows), rows: rows, hasMore: hasMore, selection: selection };
}

export function getGraphRowView(
	row: GraphWebviewRow,
	layout: {
		readonly lane: number;
		readonly edges: readonly { readonly from: number; readonly to: number; readonly parent?: string }[];
	},
): GraphRowView {
	const refs = [
		...(row.heads?.map(ref => ref.name) ?? []),
		...(row.remotes?.map(ref => `${ref.owner}/${ref.name}`) ?? []),
		...(row.tags?.map(ref => ref.name) ?? []),
	];
	const timestamp = new Date(row.date).getTime();
	const date = Number.isNaN(timestamp) ? 'Unknown date' : new Date(timestamp).toISOString().slice(0, 10);
	const refsLabel = refs.length === 0 ? 'no refs' : `refs: ${refs.join(', ')}`;

	return {
		ariaLabel: `${row.message}, ${row.author}, ${date}, ${row.sha}, ${refsLabel}`,
		lane: layout.lane,
		refs: refs,
	};
}

export function shouldPageGraph(lastVisibleIndex: number, rowCount: number, hasMore: boolean): boolean {
	return hasMore && lastVisibleIndex >= rowCount - pageThreshold;
}

export function getGraphNavigationIndex(key: string, currentIndex: number, rowCount: number): number | undefined {
	if (rowCount === 0) return undefined;

	switch (key) {
		case 'ArrowDown':
			return Math.min(currentIndex + 1, rowCount - 1);
		case 'ArrowUp':
			return Math.max(currentIndex - 1, 0);
		case 'Home':
			return 0;
		case 'End':
			return rowCount - 1;
		case 'PageDown':
			return Math.min(currentIndex + 10, rowCount - 1);
		case 'PageUp':
			return Math.max(currentIndex - 10, 0);
		default:
			return undefined;
	}
}

export function getGraphRowAction(action: GraphRowAction['action'], sha: string): GraphRowAction {
	return { type: 'graph/row/action', action: action, sha: sha };
}

export function getGraphKeyboardAction(event: {
	readonly altKey?: boolean;
	readonly ctrlKey?: boolean;
	readonly key: string;
	readonly metaKey?: boolean;
}): GraphRowAction['action'] | undefined {
	if (event.key === 'Enter') return event.altKey ? 'open-remote' : 'open-local';
	if (event.key === 'c' && (event.ctrlKey || event.metaKey)) return 'copy-sha';

	return undefined;
}

export type GraphFocusOptions = {
	readonly getRow: () => { focus(): void } | undefined;
	readonly getVirtualizer: () =>
		| {
				layoutComplete?: Promise<void>;
				scrollToIndex(index: number, position: 'nearest'): void;
				updateComplete: Promise<unknown>;
		  }
		| undefined;
	readonly waitForUpdate: () => Promise<unknown>;
};

export async function focusVirtualizedGraphRow(index: number, options: GraphFocusOptions): Promise<void> {
	await options.waitForUpdate();

	const virtualizer = options.getVirtualizer();
	if (virtualizer == null) return;

	virtualizer.scrollToIndex(index, 'nearest');
	await (virtualizer.layoutComplete ?? virtualizer.updateComplete);
	await options.waitForUpdate();
	options.getRow()?.focus();
}

@customElement('gl-graph-app')
export class GlGraphApp extends SignalWatcherWebviewApp {
	static override styles = graphStyles;

	@query('lit-virtualizer')
	private readonly virtualizer?: LitVirtualizer;

	@state()
	private graph = createGraphState();

	private paging = false;
	private messageId = 0;
	private readonly contextMenuProxy = new ContextMenuProxyController(this);
	private readonly renderRow = (row: GraphWebviewRow, index: number) => this.renderGraphRow(row, index);
	private readonly rowKey = (row: GraphWebviewRow) => row.sha;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.disposables.push(this._ipc.onReceiveMessage(this.onMessageReceived));
	}

	protected onMessageReceived = (message: IpcMessage): void => {
		const graphMessage = parseGraphHostMessage(message.params);
		if (graphMessage == null) return;

		this.graph = applyGraphMessage(this.graph, graphMessage);
		this.paging = false;
		this.restoreSelectedRow();
	};

	private post(message: GraphWebviewMessage): void {
		getHostIpcApi().postMessage({
			compressed: false,
			id: `graph:${this.messageId++}`,
			method: 'graph/action',
			params: message,
			scope: 'graph',
			timestamp: Date.now(),
		});
	}

	private select(sha: string): void {
		if (this.graph.selection !== sha) {
			this.graph = { ...this.graph, selection: sha };
			this.post({ type: 'graph/selection/update', selection: [sha] });
		}
	}

	private openDetails(sha: string): void {
		this.select(sha);
		this.post(getGraphRowAction('open-local', sha));
	}

	private onRowKeyDown(event: KeyboardEvent): void {
		const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]');
		if (row == null) return;

		const action = getGraphKeyboardAction(event);
		if (action != null) {
			event.preventDefault();
			this.select(row.dataset.sha!);
			this.post(getGraphRowAction(action, row.dataset.sha!));
			return;
		}

		const index = getGraphNavigationIndex(event.key, Number(row.dataset.index), this.graph.rows.length);
		if (index == null) return;

		event.preventDefault();
		this.focusRow(index);
	}

	private onRangeChanged(event: CustomEvent<{ first: number; last: number }>): void {
		if (!shouldPageGraph(event.detail.last, this.graph.rows.length, this.graph.hasMore) || this.paging) return;

		this.paging = true;
		this.post({ type: 'graph/more', limit: pageSize });
	}

	private onContextMenu(event: MouseEvent): void {
		const row = (event.target as HTMLElement).closest<HTMLElement>('[data-sha]');
		if (row == null) return;

		this.select(row.dataset.sha!);
	}

	private focusRow(index: number): void {
		const row = this.graph.rows[index];
		if (row == null) return;

		this.select(row.sha);
		void focusVirtualizedGraphRow(index, {
			waitForUpdate: () => this.updateComplete,
			getVirtualizer: () => this.virtualizer,
			getRow: () => this.renderRoot.querySelector<HTMLElement>(`[data-index="${index}"]`) ?? undefined,
		});
	}

	private restoreSelectedRow(): void {
		const index = this.graph.rows.findIndex(row => row.sha === this.graph.selection);
		if (index >= 0) {
			queueMicrotask(() => this.virtualizer?.element(index)?.scrollIntoView({ block: 'nearest' }));
		}
	}

	private renderGraphRow(row: GraphWebviewRow, index: number): unknown {
		const layout = this.graph.layout[index];
		if (layout == null) return nothing;

		const view = getGraphRowView(row, layout);
		const context = serializeWebviewItemContext({
			webviewItem: 'gitlens:commit',
			webviewItemValue: { type: 'commit', ref: row.sha },
		});
		return html`<div
			class="row"
			role="option"
			data-index=${index}
			data-sha=${row.sha}
			data-vscode-context=${context}
			aria-label=${view.ariaLabel}
			aria-selected=${String(this.graph.selection === row.sha)}
			tabindex=${this.graph.selection === row.sha ? 0 : -1}
			@click=${() => this.select(row.sha)}
			@dblclick=${() => this.openDetails(row.sha)}
			@keydown=${this.onRowKeyDown}
			@contextmenu=${this.onContextMenu}
		>
			${this.renderLanes(view.lane, layout.edges)}
			<div class="message">
				<span class="subject">${row.message}</span>
				<span class="metadata">${row.author}</span>
				${
					view.refs.length > 0
						? html`<span class="refs">${view.refs.map(ref => html`<span class="ref">${ref}</span>`)}</span>`
						: nothing
				}
			</div>
			<span class="sha">${row.sha.slice(0, 8)}</span>
		</div>`;
	}

	private renderLanes(lane: number, edges: readonly { readonly from: number; readonly to: number }[]): unknown {
		const width = Math.max(lane, ...edges.map(edge => Math.max(edge.from, edge.to)), 0) + 1;
		return html`<svg class="lanes" viewBox="0 0 ${width * 12} 24" aria-hidden="true">
			${edges.map(
				edge => html`<path
					d="M ${edge.from * 12 + 6} 0 L ${edge.to * 12 + 6} 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				></path>`,
			)}
			<circle cx=${lane * 12 + 6} cy="12" r="4" fill="currentColor"></circle>
		</svg>`;
	}

	override render(): unknown {
		return html`<main class="graph">
			<lit-virtualizer
				class="rows"
				role="list"
				scroller
				.items=${this.graph.rows}
				.keyFunction=${this.rowKey}
				.layout=${flow({ direction: 'vertical' })}
				.renderItem=${this.renderRow}
				@rangeChanged=${this.onRangeChanged}
			></lit-virtualizer>
			${this.paging ? html`<div class="loading" role="status">Loading more commits</div>` : nothing}
		</main>`;
	}
}
