import type { Disposable } from 'vscode';
import { GitCommit } from '@gitlens/git/models/commit.js';
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
import {
	GraphDidChangeNotification,
	type GraphDetailsRequest,
	type GraphWorkspaceRef,
	isGraphRowAction,
	parseGraphWebviewMessage,
	scope,
} from './protocol.js';

export type GraphWebviewShowingArgs = [unknown?];

type State = Record<string, never>;

const graphRefsMax = 64;
const graphDetailFilesMax = 1000;
const graphAuthorMaxLength = 256;
const graphMessageMaxLength = 10000;
const graphRefNameMaxLength = 1024;
const graphFilePathMaxLength = 4096;
const graphFileStatusMaxLength = 16;

export class GraphWebviewProvider implements WebviewProvider<State, State, GraphWebviewShowingArgs> {
	private controller: GraphSessionController | undefined;
	private contextRequest = 0;
	private detailsRequest = 0;
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
				filter: async (query, cancellation) => {
					const search = repository.git.graph.searchGraph({ query: query }, undefined, cancellation);
					let result = await search.next();
					while (!result.done) {
						result = await search.next();
					}

					return new Set(result.value.results.keys());
				},
			});
		}

		await this.controller?.open();
		void this.sendWorkspaceContext(repository).catch(() => undefined);
		return [true, undefined];
	}

	onMessageReceived(message: IpcMessage): void {
		if (message.scope !== scope) return;

		const request = parseGraphWebviewMessage(message.params);
		if (request == null) return;

		switch (request.type) {
			case 'graph/filter':
				void this.controller?.filter(request.query).catch(() => undefined);
				break;
			case 'graph/details':
				void this.sendCommitDetails(request).catch(() => undefined);
				break;
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

	private async sendWorkspaceContext(repository: GlRepository): Promise<void> {
		const request = ++this.contextRequest;
		const [branches, tags] = await Promise.all([
			repository.git.branches.getBranches().catch(() => undefined),
			repository.git.tags.getTags().catch(() => undefined),
		]);
		if (branches == null || tags == null) return;
		if (this.repository !== repository || request !== this.contextRequest) return;

		const refs: GraphWorkspaceRef[] = [];
		let branch: string | undefined;
		for (const item of branches.values) {
			if (item.current) {
				branch = item.name;
				refs.push({ type: 'head', name: item.name });
			} else {
				refs.push({ type: item.remote ? 'remote' : 'branch', name: item.name });
			}
		}
		for (const tag of tags.values) {
			refs.push({ type: 'tag', name: tag.name });
		}

		await this.host
			.notify(GraphDidChangeNotification, {
				type: 'graph/context',
				repository: {
					name: truncate(repository.name, graphRefNameMaxLength),
					...(branch == null ? {} : { branch: truncate(branch, graphRefNameMaxLength) }),
				},
				refs: refs
					.slice(0, graphRefsMax)
					.map(ref => ({ ...ref, name: truncate(ref.name, graphRefNameMaxLength) })),
			})
			.catch(() => undefined);
	}

	private async sendCommitDetails(request: GraphDetailsRequest): Promise<void> {
		const repository = this.repository;
		if (repository == null) return;

		const generation = ++this.detailsRequest;
		const commit = await repository.git.commits.getCommit(request.sha).catch(() => undefined);
		if (commit == null || this.repository !== repository || generation !== this.detailsRequest) return;

		const tips = commit.tips?.join(' ').split(', ') ?? [];
		let remoteNames = new Set<string>();
		if (tips.some(tip => tip.includes('/'))) {
			const remotes = await repository.git.remotes.getRemotes().catch(() => undefined);
			if (remotes == null) return;

			remoteNames = new Set(remotes.map(remote => remote.name));
		}
		if (this.repository !== repository || generation !== this.detailsRequest) return;

		if (request.includeFiles) {
			try {
				await GitCommit.ensureFullDetails(commit);
			} catch {
				return;
			}
			if (this.repository !== repository || generation !== this.detailsRequest) return;
		}

		await this.host
			.notify(GraphDidChangeNotification, {
				type: 'graph/details',
				sha: commit.sha,
				author: truncate(commit.author.name, graphAuthorMaxLength),
				date: commit.author.date.getTime(),
				message: truncate(commit.message ?? commit.summary, graphMessageMaxLength),
				refs: tips
					.flatMap(tip => asWorkspaceRef(tip, remoteNames))
					.slice(0, graphRefsMax)
					.map(ref => ({ ...ref, name: truncate(ref.name, graphRefNameMaxLength) })),
				...(request.includeFiles && commit.fileset?.files != null
					? {
							files: commit.fileset.files.slice(0, graphDetailFilesMax).map(file => ({
								path: truncate(file.path, graphFilePathMaxLength),
								status: truncate(file.status, graphFileStatusMaxLength),
							})),
						}
					: {}),
			})
			.catch(() => undefined);
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

function asWorkspaceRef(tip: string, remoteNames: ReadonlySet<string>): readonly GraphWorkspaceRef[] {
	if (!tip || tip === 'refs/stash') return [];
	if (tip.startsWith('HEAD -> ')) return [{ type: 'head', name: tip.substring(8) }];
	if (tip === 'HEAD') return [{ type: 'head', name: tip }];
	if (tip.startsWith('tag: ')) return [{ type: 'tag', name: tip.substring(5) }];

	const remoteName = tip.substring(0, tip.indexOf('/'));
	return [{ type: remoteNames.has(remoteName) ? 'remote' : 'branch', name: tip }];
}

function truncate(value: string, maxLength: number): string {
	return value.slice(0, maxLength);
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
