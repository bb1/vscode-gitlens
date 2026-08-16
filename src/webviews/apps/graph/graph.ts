import type { LitVirtualizer } from '@lit-labs/virtualizer';
import { flow } from '@lit-labs/virtualizer/layouts/flow.js';
import { html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { mergeWebviewItems, mergeWebviewItemsUnion, serializeWebviewItemContext } from '../../../system/webview.js';
import type {
	GraphColumn,
	GraphCommitDetails,
	GraphErrorMessage,
	GraphFilterRequest,
	GraphHostMessage,
	GraphRowAction,
	GraphWebviewMessage,
	GraphWebviewRow,
	GraphWorkspaceContext,
} from '../../graph/protocol.js';
import { parseGraphDisplayPreferences, parseGraphHostMessage, parseGraphWebviewMessage } from '../../graph/protocol.js';
import type { IpcMessage } from '../../ipc/models/ipc.js';
import { WebviewReadyRequest } from '../../protocol.js';
import { GlWebviewApp } from '../shared/appBase.js';
import { ContextMenuProxyController } from '../shared/controllers/context-menu-proxy.js';
import { getHostIpcApi, getWebviewClientInfo } from '../shared/ipc.js';
import { graphStyles } from './graph.css.js';
import {
	getMinimapMarkerPosition,
	getMinimapRowMarkers,
	getMinimapTargetIndex,
	getMinimapViewport,
} from './graphMinimap.js';
import { selectGraphRows } from './graphSelection.js';
import type { GraphDisplayPreferences, GraphWorkspaceState } from './graphState.js';
import { applyGraphWorkspaceMessage, toggleGraphColumn } from './graphState.js';
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
const graphColumns: readonly GraphColumn[] = ['graph', 'message', 'refs', 'author', 'date', 'sha'];
const defaultGraphDisplay: GraphDisplayPreferences = { columns: graphColumns, compact: false, minimap: true };

export type GraphSelection = {
	readonly active: string;
	readonly selected: readonly string[];
};

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
		case 'graph/error':
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
	const date = getGraphDateLabel(row.date);
	const refsLabel = refs.length === 0 ? 'no refs' : `refs: ${refs.join(', ')}`;

	return {
		ariaLabel: `${row.message}, ${row.author}, ${date}, ${row.sha}, ${refsLabel}`,
		lane: layout.lane,
		refs: refs,
	};
}

function getGraphDateLabel(timestamp: number): string {
	const date = new Date(timestamp);
	return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toISOString().slice(0, 10);
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

export function getGraphFilterRequest(query: string): GraphFilterRequest | undefined {
	const message = parseGraphWebviewMessage({ type: 'graph/filter', query: query });
	return message?.type === 'graph/filter' ? message : undefined;
}

export function getVisibleGraphColumns(display: GraphDisplayPreferences): readonly GraphColumn[] {
	return display.compact
		? display.columns.filter(column => column === 'graph' || column === 'message' || column === 'refs')
		: display.columns;
}

export function updateGraphSelection(
	rows: readonly string[],
	selected: readonly string[],
	row: string,
	options: { readonly range?: boolean; readonly toggle?: boolean } = {},
): GraphSelection {
	return { active: row, selected: selectGraphRows(rows, selected, row, options) };
}

export function getGraphKeyboardAction(event: {
	readonly altKey?: boolean;
	readonly ctrlKey?: boolean;
	readonly key: string;
	readonly metaKey?: boolean;
}): GraphRowAction['action'] | 'toggle-selection' | undefined {
	if (event.key === 'Enter') return event.altKey ? 'open-remote' : 'open-local';
	if (event.key === 'c' && (event.ctrlKey || event.metaKey)) return 'copy-sha';
	if (event.key === ' ') return 'toggle-selection';

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
export class GlGraphApp extends GlWebviewApp {
	static override styles = graphStyles;

	@query('lit-virtualizer')
	private readonly virtualizer?: LitVirtualizer;

	@state()
	private graph = createGraphState();

	@state()
	private workspace: GraphWorkspaceState = { display: defaultGraphDisplay };

	@state()
	private selected: readonly string[] = [];

	@state()
	private context: GraphWorkspaceContext | undefined;

	@state()
	private details: GraphCommitDetails | undefined;

	@state()
	private filterQuery = '';

	@state()
	private inspectorOpen = false;

	@state()
	private inspectorDismissed = false;

	@state()
	private error: GraphErrorMessage | undefined;

	@state()
	private minimapRange = { first: 0, last: 0 };

	@state()
	private paging = false;
	private messageId = 0;
	private readonly contextMenuProxy = new ContextMenuProxyController(this);
	private readonly renderRow = (row: GraphWebviewRow, index: number) => this.renderGraphRow(row, index);
	private readonly rowKey = (row: GraphWebviewRow) => row.sha;
	private readonly requestFilter = debounce((query: string) => {
		const request = getGraphFilterRequest(query);
		if (request != null) {
			this.post(request);
		}
	}, 250);

	override connectedCallback(): void {
		const state = getHostIpcApi().getState() as { readonly display?: unknown } | undefined;
		const display = parseGraphDisplayPreferences(state?.display);
		if (display != null) {
			this.workspace = applyGraphWorkspaceMessage(this.workspace, { type: 'graph/display', display: display });
		}

		super.connectedCallback?.();
		this.disposables.push(this._ipc.onReceiveMessage(this.onMessageReceived));
		void this._ipc.sendRequest(WebviewReadyRequest, { bootstrap: false, ...getWebviewClientInfo() });
	}

	override disconnectedCallback(): void {
		this.requestFilter.cancel();
		super.disconnectedCallback?.();
	}

	protected onMessageReceived = (message: IpcMessage): void => {
		const graphMessage = parseGraphHostMessage(message.params);
		if (graphMessage == null) return;

		switch (graphMessage.type) {
			case 'graph/context':
				this.context = graphMessage;
				break;
			case 'graph/details':
				this.details = graphMessage;
				if (this.error?.operation === 'details') {
					this.error = undefined;
				}
				break;
			case 'graph/error':
				this.error = graphMessage;
				break;
			default:
				this.graph = applyGraphMessage(this.graph, graphMessage);
				if (!this.inspectorDismissed) {
					this.inspectorOpen = this.graph.selection != null;
				}
				if (graphMessage.type === 'graph/replace' && this.error?.operation === 'filter') {
					this.error = undefined;
				}
				this.selected = this.selected.filter(sha => this.graph.rows.some(row => row.sha === sha));
				if (this.graph.selection != null && this.selected.length === 0) {
					this.selected = [this.graph.selection];
				}
				if (
					(graphMessage.type === 'graph/bootstrap' || graphMessage.type === 'graph/replace') &&
					this.graph.selection != null &&
					this.details?.sha !== this.graph.selection
				) {
					this.post({ type: 'graph/details', sha: this.graph.selection, includeFiles: false });
				}

				this.paging = false;
				this.restoreSelectedRow();
				break;
		}

		setTimeout(() => this.requestUpdate(), 0);
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

	private select(sha: string, options: { readonly range?: boolean; readonly toggle?: boolean } = {}): void {
		this.inspectorDismissed = false;
		this.inspectorOpen = true;
		const selection = updateGraphSelection(
			this.graph.rows.map(row => row.sha),
			this.selected,
			sha,
			options,
		);
		const activeChanged = this.graph.selection !== selection.active;
		const selectedChanged =
			this.selected.length !== selection.selected.length ||
			this.selected.some((selected, index) => selected !== selection.selected[index]);
		if (!activeChanged && !selectedChanged) return;

		this.graph = { ...this.graph, selection: selection.active };
		this.selected = selection.selected;
		this.post({ type: 'graph/selection/update', selection: selection.selected });
		if (activeChanged) {
			this.post({ type: 'graph/details', sha: sha, includeFiles: false });
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
			if (action === 'toggle-selection') {
				this.select(row.dataset.sha!, { toggle: true });
				return;
			}

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
		const range = event.detail;
		if (range == null || !Number.isSafeInteger(range.first) || !Number.isSafeInteger(range.last)) return;

		this.minimapRange = range;
		if (!shouldPageGraph(range.last, this.graph.rows.length, this.graph.hasMore) || this.paging) return;

		this.paging = true;
		this.post({ type: 'graph/more', limit: pageSize });
	}

	private onContextMenu(event: MouseEvent): void {
		const row = (event.target as HTMLElement).closest<HTMLElement>('[data-sha]');
		if (row == null) return;

		if (!this.selected.includes(row.dataset.sha!)) {
			this.select(row.dataset.sha!);
		}
	}

	private onRowClick(row: GraphWebviewRow, event: MouseEvent): void {
		this.select(row.sha, { range: event.shiftKey, toggle: event.ctrlKey || event.metaKey });
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !this.inspectorOpen) return;

		event.preventDefault();
		this.closeInspector();
	}

	private closeInspector(): void {
		this.inspectorDismissed = true;
		this.inspectorOpen = false;
		this.focusSelectedRow();
	}

	private onFilterInput(event: InputEvent): void {
		const input = event.target;
		if (!(input instanceof HTMLInputElement)) return;

		this.filterQuery = input.value;
		this.requestFilter(input.value);
	}

	private onMinimapClick(event: MouseEvent): void {
		const minimap = event.currentTarget as HTMLElement;
		const bounds = minimap.getBoundingClientRect();
		this.focusRow(getMinimapTargetIndex(event.clientY - bounds.top, bounds.height, this.graph.rows.length));
	}

	private retry(): void {
		switch (this.error?.operation) {
			case 'details':
				if (this.graph.selection != null) {
					this.post({ type: 'graph/details', sha: this.graph.selection, includeFiles: false });
				}
				break;
			case 'filter': {
				const request = getGraphFilterRequest(this.filterQuery);
				if (request != null) {
					this.post(request);
				}
				break;
			}
			case 'graph':
				this.post({ type: 'graph/refresh' });
				break;
		}
	}

	private updateDisplay(display: GraphDisplayPreferences): void {
		this.workspace = applyGraphWorkspaceMessage(this.workspace, { type: 'graph/display', display: display });
		getHostIpcApi().setState({ display: display });
	}

	private toggleColumn(column: GraphColumn): void {
		this.updateDisplay(toggleGraphColumn(this.workspace.display, column));
	}

	private toggleCompact(event: Event): void {
		const input = event.target;
		if (!(input instanceof HTMLInputElement)) return;

		this.updateDisplay({ ...this.workspace.display, compact: input.checked });
	}

	private toggleMinimap(event: Event): void {
		const input = event.target;
		if (!(input instanceof HTMLInputElement)) return;

		this.updateDisplay({ ...this.workspace.display, minimap: input.checked });
	}

	private focusRow(index: number): void {
		const row = this.graph.rows[index];
		if (row == null) return;

		this.select(row.sha);
		this.focusGraphRow(index);
	}

	private focusSelectedRow(): void {
		const index = this.graph.rows.findIndex(row => row.sha === this.graph.selection);
		if (index < 0) return;

		const row = this.renderRoot.querySelector<HTMLElement>(`[data-index="${index}"]`);
		if (row != null) {
			row.focus();
			return;
		}

		this.focusGraphRow(index);
	}

	private focusGraphRow(index: number): void {
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
		const context = this.getRowContext(row);
		const columns = getVisibleGraphColumns(this.workspace.display);
		return html`<div
			class="row"
			role="option"
			data-index=${index}
			data-sha=${row.sha}
			data-vscode-context=${context}
			aria-label=${view.ariaLabel}
			aria-selected=${String(this.selected.includes(row.sha))}
			tabindex=${this.graph.selection === row.sha ? 0 : -1}
			@click=${(event: MouseEvent) => this.onRowClick(row, event)}
			@dblclick=${() => this.openDetails(row.sha)}
			@keydown=${this.onRowKeyDown}
			@contextmenu=${this.onContextMenu}
		>
			${columns.includes('graph') ? this.renderLanes(view.lane, layout.edges) : nothing}
			${columns.includes('message') ? html`<span class="subject">${row.message}</span>` : nothing}
			${
				columns.includes('refs') && view.refs.length > 0
					? html`<span class="refs">${view.refs.map(ref => html`<span class="ref">${ref}</span>`)}</span>`
					: nothing
			}
			${columns.includes('author') ? html`<span class="metadata">${row.author}</span>` : nothing}
			${columns.includes('date') ? html`<span class="metadata">${getGraphDateLabel(row.date)}</span>` : nothing}
			${columns.includes('sha') ? html`<span class="sha">${row.sha.slice(0, 8)}</span>` : nothing}
		</div>`;
	}

	private getRowContext(row: GraphWebviewRow): string {
		const value = { type: 'commit', ref: row.sha };
		if (this.selected.length <= 1 || !this.selected.includes(row.sha)) {
			return serializeWebviewItemContext({ webviewItem: 'gitlens:commit', webviewItemValue: value });
		}

		const values = this.selected.map(sha => ({
			webviewItem: 'gitlens:commit',
			webviewItemValue: { type: 'commit', ref: sha },
		}));
		return serializeWebviewItemContext({
			webviewItemValue: value,
			listMultiSelection: true,
			listDoubleSelection: values.length === 2,
			webviewItems: mergeWebviewItems(values.map(item => item.webviewItem)),
			webviewItemsUnion: mergeWebviewItemsUnion(values.map(item => item.webviewItem)),
			webviewItemsValues: values,
		});
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

	private renderCommandDeck(): unknown {
		return html`<section class="command-deck" aria-label="Commit graph commands">
			<div>
				<h1>Commit Graph</h1>
				<p>
					${this.context?.repository.name ?? 'Repository'}${this.context?.repository.branch ? `: ${this.context.repository.branch}` : ''}
				</p>
			</div>
			<label>
				<span class="visually-hidden">Filter loaded commits using plain text</span>
				<input
					type="search"
					placeholder="Filter loaded commits (plain text)"
					.value=${this.filterQuery}
					@input=${this.onFilterInput}
				/>
			</label>
			${
				this.filterQuery && this.graph.hasMore
					? html`<p class="filter-status" role="status">
							Filtering loaded commits.
							<button type="button" @click=${this.loadMore}>Load more to search more history</button>
						</p>`
					: nothing
			}
			${this.error?.operation === 'filter' ? this.renderError() : nothing}
			<details>
				<summary>Display</summary>
				<label
					><input type="checkbox" .checked=${this.workspace.display.compact} @change=${this.toggleCompact} />
					Compact rows</label
				>
				<label
					><input type="checkbox" .checked=${this.workspace.display.minimap} @change=${this.toggleMinimap} />
					Show minimap</label
				>
				<div role="group" aria-label="Visible columns">
					${graphColumns.map(
						column => html`<button
							type="button"
							aria-pressed=${String(this.workspace.display.columns.includes(column))}
							@click=${() => this.toggleColumn(column)}
						>
							${column}
						</button>`,
					)}
				</div>
			</details>
		</section>`;
	}

	private renderReferenceRail(): unknown {
		return html`<aside class="reference-rail" aria-label="Repository references">
			<h2>References</h2>
			${
				this.context?.refs.length
					? html`<ul>
							${this.context.refs.map(ref => html`<li>${ref.name}</li>`)}
						</ul>`
					: html`<p>No references loaded</p>`
			}
		</aside>`;
	}

	private renderColumnHeader(): unknown {
		return html`<header class="column-header" aria-label="Graph columns">
			${getVisibleGraphColumns(this.workspace.display).map(
				column => html`<span class="column--${column}">${column}</span>`,
			)}
		</header>`;
	}

	private renderRows(): unknown {
		return html`<div
			class="graph"
			data-columns=${getVisibleGraphColumns(this.workspace.display).join(' ')}
			?data-compact=${this.workspace.display.compact}
		>
			<lit-virtualizer
				class="rows"
				role="listbox"
				aria-label="Commit graph"
				aria-multiselectable="true"
				scroller
				.items=${this.graph.rows}
				.keyFunction=${this.rowKey}
				.layout=${flow({ direction: 'vertical' })}
				.renderItem=${this.renderRow}
				@rangeChanged=${this.onRangeChanged}
			></lit-virtualizer>
			${this.paging ? html`<div class="loading" role="status">Loading more commits</div>` : nothing}
		</div>`;
	}

	private renderMinimap(): unknown {
		if (!this.workspace.display.minimap) return nothing;

		const range = this.minimapRange ?? { first: 0, last: 0 };
		const viewport = getMinimapViewport(range.first, range.last, this.graph.rows.length);
		const selection = this.graph.rows.findIndex(row => row.sha === this.graph.selection);

		return html`<nav class="minimap" aria-label="Graph minimap">
			<button
				type="button"
				?disabled=${this.graph.rows.length === 0}
				aria-label="Navigate ${this.graph.rows.length} loaded commits"
				@click=${this.onMinimapClick}
			>
				${getMinimapRowMarkers(this.graph.layout.length).map(index => {
					const layout = this.graph.layout[index];
					return html`<span
						aria-hidden="true"
						data-lane=${layout?.lane ?? 0}
						style="inset-block-start: ${getMinimapMarkerPosition(index, this.graph.rows.length)}%"
					></span>`;
				})}
				<span
					class="minimap-viewport"
					aria-hidden="true"
					style="inset-block-start: ${viewport.start}%; block-size: ${viewport.size}%"
				></span>
				${
					selection >= 0
						? html`<span
								class="minimap-selection"
								aria-hidden="true"
								style="inset-block-start: ${getMinimapMarkerPosition(selection, this.graph.rows.length)}%"
							></span>`
						: nothing
				}
			</button>
		</nav>`;
	}

	private renderInspector(): unknown {
		if (!this.inspectorOpen) return nothing;

		const selected = this.graph.selection;
		const details = this.details?.sha === selected ? this.details : undefined;
		return html`<section class="inspector" aria-label="Commit details">
			<h2 id="inspector-title">Inspector</h2>
			<button type="button" aria-label="Close commit details" @click=${this.closeInspector}>Close</button>
			${
				details == null
					? html`<p>${selected == null ? 'Select a commit to inspect it' : 'Loading commit details'}</p>`
					: html`<p>${details.message}</p>
							<p>${details.author} · ${getGraphDateLabel(details.date)}</p>
							${details.refs.length ? html`<p>${details.refs.map(ref => ref.name).join(', ')}</p>` : nothing}
							<details>
								<summary>Files</summary>
								${
									details.files == null
										? html`<button
												type="button"
												@click=${() => this.post({ type: 'graph/details', sha: details.sha, includeFiles: true })}
											>
												Load changed files
											</button>`
										: html`<ul>
												${details.files.map(file => html`<li>${file.status} ${file.path}</li>`)}
											</ul>`
								}
							</details>`
			}
			${this.error?.operation === 'details' ? this.renderError() : nothing}
		</section>`;
	}

	private renderError(): unknown {
		if (this.error == null) return nothing;

		return html`<p class="error" role="status" aria-live="polite">
			${this.error.message} <button type="button" @click=${this.retry}>Retry</button>
		</p>`;
	}

	private loadMore(): void {
		if (!this.paging && this.graph.hasMore) {
			this.paging = true;
			this.post({ type: 'graph/more', limit: pageSize });
		}
	}

	override render(): unknown {
		return html`<main class="workspace" @keydown=${this.onKeyDown}>
			${this.renderCommandDeck()} ${this.renderReferenceRail()}
			<section class="canvas" aria-label="Commit graph">
				${this.renderColumnHeader()} ${this.renderRows()}
			</section>
			${this.renderMinimap()} ${this.renderInspector()}
			${this.error?.operation === 'graph' ? this.renderError() : nothing}
		</main>`;
	}
}
