import type { Disposable } from 'vscode';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import type { WebviewTelemetryContext } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { GlGraphRowProcessor } from '../../git/graphRowProcessor.js';
import { GlRepository } from '../../git/models/repository.js';
import { executeCommand, registerCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import { isWebviewItemContext } from '../../system/webview.js';
import type { IpcMessage } from '../ipc/models/ipc.js';
import type { WebviewHost, WebviewProvider } from '../webviewProvider.js';
import type { WebviewShowOptions } from '../webviewsController.js';
import { GraphSessionController } from './graphSessionController.js';
import { GraphDidChangeNotification, isGraphRowAction, parseGraphWebviewMessage, scope } from './protocol.js';

export type GraphWebviewShowingArgs = [unknown?];

type State = Record<string, never>;

export class GraphWebviewProvider implements WebviewProvider<State, State, GraphWebviewShowingArgs> {
	private controller: GraphSessionController | undefined;
	private repository: GlRepository | undefined;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.graph' | 'gitlens.views.graph'>,
	) {}

	dispose(): void {
		this.controller?.dispose();
		this.controller = undefined;
	}

	registerCommands(): Disposable[] {
		const commands: Disposable[] = [
			this.host.registerWebviewCommand('gitlens.graph.copySha', item => {
				const sha = getContextSha(item);
				if (sha != null) {
					this.executeRowAction({ action: 'copy-sha', sha: sha });
				}
			}),
			this.host.registerWebviewCommand('gitlens.graph.openCommitOnRemote', item => {
				const sha = getContextSha(item);
				if (sha != null) {
					this.executeRowAction({ action: 'open-remote', sha: sha });
				}
			}),
		];
		if (this.host.is('view')) {
			commands.push(registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true)));
		}

		return commands;
	}

	getTelemetryContext(): WebviewTelemetryContext &
		Record<`context.repository.${string}`, string | boolean | undefined> {
		return {
			...this.host.getTelemetryContext(),
			'context.repository.id': this.repository?.idHash,
			'context.repository.scheme': this.repository?.uri.scheme,
			'context.repository.closed': this.repository != null ? !this.repository.opened : undefined,
			'context.repository.folder.scheme': this.repository?.folder?.uri.scheme,
			'context.repository.provider.id': this.repository?.provider.id,
		};
	}

	async onShowing(
		_loading: boolean,
		_options: WebviewShowOptions,
		...args: GraphWebviewShowingArgs
	): Promise<[boolean, undefined]> {
		const repository = getRepository(this.container, args[0]);
		if (repository == null) return [true, undefined];

		if (this.repository?.path !== repository.path) {
			this.controller?.dispose();
			this.repository = repository;
			this.controller = new GraphSessionController({
				open: cancellation =>
					repository.git.graph.openGraphSession(
						{
							rowProcessor: new GlGraphRowProcessor(this.container, uri => this.host.asWebviewUri(uri)),
							limit: configuration.get('graph').defaultItemLimit,
						},
						cancellation,
					),
				postMessage: message => this.host.notify(GraphDidChangeNotification, message).then(() => {}),
			});
		}

		await this.controller?.open();
		return [true, undefined];
	}

	onMessageReceived(message: IpcMessage): void {
		if (message.scope !== scope) return;

		const request = parseGraphWebviewMessage(message.params);
		if (request == null) return;

		switch (request.type) {
			case 'graph/more':
				void this.controller?.more(request.limit, request.targetId);
				break;
			case 'graph/row/action':
				this.executeRowAction(request);
				break;
			case 'graph/selection/update':
				break;
		}
	}

	private executeRowAction(request: unknown): void {
		if (!isGraphRowAction(request)) return;

		if (this.repository == null) return;

		switch (request.action) {
			case 'copy-sha':
				void executeCommand('gitlens.copyShaToClipboard', { sha: request.sha });
				break;
			case 'open-local':
				void executeCommand('gitlens.showCommitInView', {
					ref: {
						ref: request.sha,
						refType: 'revision',
						repoPath: this.repository.path,
					},
				});
				break;
			case 'open-remote':
				void executeCommand('gitlens.openOnRemote', {
					repoPath: this.repository.path,
					resource: { type: RemoteResourceType.Commit, sha: request.sha },
				});
				break;
		}
	}
}

function getRepository(container: Container, arg: unknown): GlRepository | undefined {
	if (GlRepository.is(arg)) return arg;
	if (arg == null || typeof arg !== 'object') return container.git.getBestRepository();

	const value = arg as { repository?: unknown; ref?: { repoPath?: unknown } };
	if (GlRepository.is(value.repository)) return value.repository;
	if (typeof value.ref?.repoPath === 'string') return container.git.getRepository(value.ref.repoPath);

	return container.git.getBestRepository();
}

function getContextSha(item: unknown): string | undefined {
	if (item == null || typeof item !== 'object' || !isWebviewItemContext<{ ref?: unknown }>(item)) return undefined;

	const ref = item.webviewItemValue?.ref;
	return typeof ref === 'string' ? ref : undefined;
}
