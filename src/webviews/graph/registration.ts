import { Disposable, ViewColumn } from 'vscode';
import type { GitReference } from '@gitlens/git/models/reference.js';
import type { Source } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { GlRepository } from '../../git/models/repository.js';
import { registerCommand } from '../../system/-webview/command.js';
import { loadChunk } from '../../system/-webview/loadChunk.js';
import type { WebviewPanelsProxy, WebviewsController, WebviewViewProxy } from '../webviewsController.js';
import type { GraphWebviewShowingArgs } from './graphWebview.js';

type State = Record<string, never>;

export type ShowInCommitGraphCommandArgs =
	| GlRepository
	| { ref: GitReference; preserveFocus?: boolean; source?: Source }
	| { repository: GlRepository; preserveFocus?: boolean; search?: unknown; source?: Source };

export function registerGraphWebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.graph', GraphWebviewShowingArgs, State> {
	return controller.registerWebviewPanel<'gitlens.graph', State, State, GraphWebviewShowingArgs>(
		{ id: 'gitlens.showGraphPage', options: { preserveInstance: true } },
		{
			id: 'gitlens.graph',
			fileName: 'graph.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'Commit Graph',
			contextKeyPrefix: 'gitlens:webview:graph',
			trackingFeature: 'graphWebview',
			type: 'graph',
			column: ViewColumn.Active,
			webviewHostOptions: { retainContextWhenHidden: true, enableFindWidget: false },
		},
		async (container, host) => {
			const { GraphWebviewProvider } = await loadChunk(
				() => import(/* webpackChunkName: "webview-cleanroom-graph" */ './graphWebview.js'),
			);
			return new GraphWebviewProvider(container, host);
		},
	);
}

export function registerGraphWebviewView(
	controller: WebviewsController,
): WebviewViewProxy<'gitlens.views.graph', GraphWebviewShowingArgs, State> {
	return controller.registerWebviewView<'gitlens.views.graph', State, State, GraphWebviewShowingArgs>(
		{
			id: 'gitlens.views.graph',
			fileName: 'graph.html',
			title: 'Commit Graph',
			contextKeyPrefix: 'gitlens:webviewView:graph',
			trackingFeature: 'graphView',
			type: 'graph',
			webviewHostOptions: { retainContextWhenHidden: true },
		},
		async (container, host) => {
			const { GraphWebviewProvider } = await loadChunk(
				() => import(/* webpackChunkName: "webview-cleanroom-graph" */ './graphWebview.js'),
			);
			return new GraphWebviewProvider(container, host);
		},
	);
}

export function registerGraphWebviewCommands(
	container: Container,
	panels: WebviewPanelsProxy<'gitlens.graph', GraphWebviewShowingArgs, State>,
): Disposable {
	return Disposable.from(
		registerCommand('gitlens.showGraph', (...args: unknown[]) => {
			const [arg] = args;
			const source =
				arg != null && typeof arg === 'object' && 'source' in arg
					? (arg as { source?: Source }).source
					: undefined;
			if (container.views.graph.visible) {
				return container.views.graph.show({ source: source });
			}

			return panels.show({ source: source });
		}),
		registerCommand('gitlens.showInCommitGraph', (args: ShowInCommitGraphCommandArgs) => {
			const source = 'source' in args ? args.source : undefined;
			const preserveFocus = 'preserveFocus' in args ? args.preserveFocus : undefined;
			if (container.views.graph.visible) {
				return container.views.graph.show({ preserveFocus: preserveFocus, source: source }, args);
			}

			return panels.show({ preserveFocus: preserveFocus, source: source }, args);
		}),
	);
}
