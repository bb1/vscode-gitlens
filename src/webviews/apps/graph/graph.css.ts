import { css } from 'lit';

export const graphStyles = css`
	:host {
		--graph-lane-color: color-mix(in srgb, var(--vscode-textLink-foreground) 80%, var(--vscode-editor-foreground));
		--graph-lane-muted-color: color-mix(in srgb, var(--graph-lane-color) 55%, transparent);
		--graph-lane-active-color: color-mix(
			in srgb,
			var(--vscode-list-activeSelectionForeground) 60%,
			var(--vscode-textLink-foreground)
		);

		display: block;
		block-size: 100%;
		min-block-size: 0;
		color: var(--vscode-editor-foreground);
		background: var(--vscode-editor-background);
		container-type: inline-size;
	}

	:host *,
	:host *::before,
	:host *::after {
		box-sizing: border-box;
	}

	.workspace {
		display: grid;
		grid-template-areas:
			'command-deck command-deck command-deck'
			'reference-rail canvas inspector'
			'reference-rail minimap inspector';
		grid-template-columns: minmax(14rem, 20rem) minmax(0, 1fr) minmax(20rem, 30rem);
		grid-template-rows: auto minmax(0, 1fr) auto;
		block-size: 100%;
		min-block-size: 0;
		background: var(--vscode-editor-background);
	}

	.command-deck {
		grid-area: command-deck;
		position: sticky;
		inset-block-start: 0;
		z-index: var(--gl-z-sticky);
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(16rem, 34rem) max-content;
		gap: var(--gl-space-8);
		align-items: center;
		padding: var(--gl-space-8) var(--gl-space-12);
		border-block-end: var(--gl-border-width) solid var(--vscode-panel-border);
		background: var(--vscode-editor-background);
	}

	.command-deck h1,
	.command-deck p,
	.reference-rail h2,
	.inspector h2 {
		margin: 0;
	}

	.command-deck h1 {
		font-size: var(--gl-font-lg);
	}

	.command-deck p,
	.reference-rail p,
	.inspector p {
		color: var(--vscode-descriptionForeground);
		font-size: var(--gl-font-sm);
	}

	.command-deck label {
		min-inline-size: 0;
	}

	.command-deck input[type='search'] {
		inline-size: 100%;
		min-inline-size: 0;
		padding: var(--gl-space-6) var(--gl-space-8);
		border: var(--gl-border-width) solid var(--vscode-input-border);
		border-radius: var(--gl-input-border-radius);
		color: var(--vscode-input-foreground);
		background: var(--vscode-input-background);
	}

	.command-deck details {
		position: relative;
	}

	.command-deck summary {
		cursor: pointer;
	}

	.command-deck details > div,
	.command-deck details > label {
		margin-block-start: var(--gl-space-6);
	}

	.command-deck details[open] {
		padding: var(--gl-space-6) var(--gl-space-8);
		border: var(--gl-border-width) solid var(--vscode-widget-border);
		border-radius: var(--gl-input-border-radius);
		background: var(--vscode-editorWidget-background);
	}

	.command-deck details[open] > label,
	.command-deck details[open] > div {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
	}

	.command-deck details[open] > div {
		flex-wrap: wrap;
	}

	.command-deck button,
	.minimap button,
	.inspector button {
		border: var(--gl-border-width) solid var(--vscode-button-border);
		border-radius: var(--gl-input-border-radius);
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-background);
	}

	.reference-rail,
	.inspector {
		overflow: auto;
		min-block-size: 0;
		padding: var(--gl-space-12);
		background: var(--vscode-sideBar-background);
	}

	.reference-rail {
		grid-area: reference-rail;
		border-inline-end: var(--gl-border-width) solid var(--vscode-sideBar-border);
	}

	.reference-rail h2,
	.inspector h2 {
		font-size: var(--gl-font-base);
	}

	.reference-rail ul,
	.inspector ul {
		padding-inline-start: var(--gl-space-16);
	}

	.reference-rail li,
	.inspector li {
		overflow-wrap: anywhere;
	}

	.canvas {
		grid-area: canvas;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		min-inline-size: 0;
		min-block-size: 0;
		background: var(--vscode-editor-background);
	}

	.column-header {
		position: sticky;
		inset-block-start: 0;
		z-index: var(--gl-z-sticky);
		display: grid;
		grid-template-columns:
			minmax(0, max-content)
			minmax(12rem, 1fr)
			repeat(4, minmax(0, max-content));
		gap: var(--gl-space-8);
		align-items: center;
		min-inline-size: 0;
		padding: var(--gl-space-6) var(--gl-space-8);
		border-block-end: var(--gl-border-width) solid var(--vscode-panel-border);
		color: var(--vscode-descriptionForeground);
		background: var(--vscode-editor-background);
		font-size: var(--gl-font-sm);
	}

	.graph,
	.rows {
		block-size: 100%;
		min-block-size: 0;
	}

	.rows {
		overflow: auto;
		outline: none;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, max-content) minmax(12rem, 1fr) repeat(4, minmax(0, max-content));
		gap: var(--gl-space-8);
		align-items: center;
		min-inline-size: 0;
		min-block-size: 2.8rem;
		padding-block: var(--gl-space-4);
		padding-inline: var(--gl-space-8);
		border: var(--gl-border-width) solid transparent;
		border-block-end: var(--gl-border-width) solid var(--vscode-panel-border);
		color: inherit;
		background: transparent;
		font-size: var(--gl-font-base);
		text-align: start;
		cursor: pointer;
	}

	.row > :is(.lanes, .subject, .refs, .metadata, .sha) {
		min-inline-size: 0;
	}

	.row[aria-selected='true'] {
		background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}

	.row[aria-selected='true'] .lanes {
		color: var(--graph-lane-active-color);
	}

	.row:focus-visible {
		position: relative;
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: calc(-1 * var(--gl-border-width));
	}

	.row:focus-visible .lanes {
		color: var(--graph-lane-active-color);
	}

	.lanes {
		inline-size: fit-content;
		block-size: 2.4rem;
		color: var(--graph-lane-color);
	}

	.subject {
		overflow: hidden;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.metadata,
	.refs,
	.sha {
		color: var(--vscode-descriptionForeground);
		font-size: var(--gl-font-sm);
	}

	.refs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-4);
	}

	.ref {
		max-inline-size: 20ch;
		overflow: hidden;
		padding-block: var(--gl-space-2);
		padding-inline: var(--gl-space-4);
		border: var(--gl-border-width) solid var(--vscode-badge-background);
		border-radius: var(--gl-input-border-radius);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sha {
		font-family: var(--vscode-editor-font-family);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.graph[data-compact] .row {
		min-block-size: 2.4rem;
	}

	.graph[data-compact] .metadata,
	.graph[data-compact] .sha {
		display: none;
	}

	.loading {
		padding: var(--gl-space-12);
		color: var(--vscode-descriptionForeground);
		font-size: var(--gl-font-sm);
		text-align: center;
	}

	.minimap {
		grid-area: minimap;
		padding: var(--gl-space-8);
		border-block-start: var(--gl-border-width) solid var(--vscode-panel-border);
		background: var(--vscode-editor-background);
	}

	.minimap button {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
		gap: var(--gl-space-2);
		inline-size: 100%;
		min-block-size: 2.4rem;
		padding: var(--gl-space-4);
		background: color-mix(in srgb, var(--vscode-editorWidget-background) 85%, transparent);
	}

	.minimap span {
		min-inline-size: 0.2rem;
		background: var(--graph-lane-muted-color);
	}

	.minimap span[data-lane='0'] {
		background: var(--graph-lane-color);
	}

	.inspector {
		grid-area: inspector;
		border-inline-start: var(--gl-border-width) solid var(--vscode-sideBar-border);
	}

	:where(
		.command-deck input,
		.command-deck summary,
		.command-deck button,
		.minimap button,
		.inspector button
	):focus-visible {
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: var(--gl-space-2);
	}

	@container (max-width: 58rem) {
		.workspace {
			grid-template-areas:
				'command-deck'
				'canvas'
				'minimap'
				'inspector';
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr) auto minmax(0, auto);
		}

		.reference-rail {
			display: none;
		}

		.column-header {
			display: none;
		}

		.row {
			grid-template-columns: minmax(0, max-content) minmax(0, 1fr) minmax(0, max-content);
		}

		.metadata,
		.sha {
			display: none;
		}

		.inspector {
			max-block-size: 18rem;
			border-block-start: var(--gl-border-width) solid var(--vscode-sideBar-border);
			border-inline-start: 0;
		}
	}

	@container (max-width: 42rem) {
		.command-deck {
			grid-template-columns: minmax(0, 1fr) max-content;
		}

		.command-deck > label {
			grid-column: 1 / -1;
		}

		.refs {
			display: none;
		}

		.row {
			grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
		}
	}

	@media (forced-colors: active) {
		.lanes,
		.row[aria-selected='true'] .lanes,
		.row:focus-visible .lanes {
			color: CanvasText;
			forced-color-adjust: none;
		}

		.ref,
		.command-deck details[open],
		.command-deck button,
		.minimap button,
		.inspector button {
			border-color: CanvasText;
		}

		.minimap span {
			background: CanvasText;
		}

		.row:focus-visible,
		:where(
			.command-deck input,
			.command-deck summary,
			.command-deck button,
			.minimap button,
			.inspector button
		):focus-visible {
			outline-color: Highlight;
		}
	}
`;
