import { css } from 'lit';

export const graphStyles = css`
	:host {
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

	.graph {
		block-size: 100%;
		min-block-size: 0;
	}

	.rows {
		block-size: 100%;
		min-block-size: 0;
		overflow: auto;
		outline: none;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(4rem, max-content) minmax(0, 1fr) minmax(min-content, max-content);
		gap: var(--gl-space-8);
		align-items: center;
		min-inline-size: 0;
		min-block-size: 3.2rem;
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

	.row[aria-selected='true'] {
		background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}

	.row:focus-visible {
		position: relative;
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: calc(-1 * var(--gl-border-width));
	}

	.lanes {
		inline-size: fit-content;
		block-size: 2.4rem;
		color: var(--vscode-textLink-foreground);
	}

	.message {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-4) var(--gl-space-6);
		align-items: baseline;
		min-inline-size: 0;
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
		max-inline-size: 24ch;
		overflow: hidden;
		padding-block: var(--gl-space-2);
		padding-inline: var(--gl-space-4);
		border: var(--gl-border-width) solid var(--vscode-badge-background);
		border-radius: var(--gl-radius-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sha {
		font-family: var(--vscode-editor-font-family);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.loading {
		padding: var(--gl-space-12);
		color: var(--vscode-descriptionForeground);
		font-size: var(--gl-font-sm);
		text-align: center;
	}

	@container (max-width: 42rem) {
		.row {
			grid-template-columns: minmax(4rem, max-content) minmax(0, 1fr);
		}

		.sha {
			display: none;
		}
	}

	@media (forced-colors: active) {
		.lanes {
			color: CanvasText;
			forced-color-adjust: none;
		}

		.ref {
			border-color: CanvasText;
		}
	}
`;
