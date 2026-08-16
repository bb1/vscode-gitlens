import type { Disposable } from 'vscode';
import { GitCommit } from '@gitlens/git/models/commit.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import type { WebviewTelemetryContext } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import * as RepoActions from '../../git/actions/repository.js';
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
	type GraphErrorMessage,
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
	private readonly repositorySubscription: Disposable;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.graph' | 'gitlens.views.graph'>,
	) {
		this.repositorySubscription = this.container.git.onDidChangeRepositories(() => {
			if (this.repository != null) return;

			void this.initializeBestRepository().catch(error => this.sendError('graph', error));
		});
	}

	dispose(): void {
		this.repositorySubscription.dispose();
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
			this.host.registerWebviewCommand('gitlens.graph.cherryPick', item => {
				this.cherryPick(getContextShas(item));
			}),
			this.host.registerWebviewCommand('gitlens.graph.cherryPick.multi', item => {
				this.cherryPick(getContextShas(item));
			}),
			this.host.registerWebviewCommand('gitlens.graph.compareSelectedCommits.multi', item => {
				this.compareSelectedCommits(getContextShas(item));
			}),
			this.host.registerWebviewCommand('gitlens.graph.copyRemoteCommitUrl.multi', item => {
				this.openCommitsOnRemote(getContextShas(item), true);
			}),
			this.host.registerWebviewCommand('gitlens.graph.openCommitOnRemote.multi', item => {
				this.openCommitsOnRemote(getContextShas(item), false);
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
		const repository = await this.initializeRepository(await getRepository(this.container, args[0]));
		if (repository == null) return [true, undefined];

		return [true, undefined];
	}

	onReady(): void {
		const repository = this.repository;
		if (repository != null) {
			void this.sendWorkspaceContext(repository).catch(error => this.sendError('graph', error));
		} else {
			void this.initializeBestRepository().catch(error => this.sendError('graph', error));
		}
	}

	onReconnect(): void {
		void this.republish().catch(error => this.sendError('graph', error));
	}

	onMessageReceived(message: IpcMessage): void {
		if (message.scope !== scope) return;

		const request = parseGraphWebviewMessage(message.params);
		if (request == null) return;

		switch (request.type) {
			case 'graph/refresh':
				void this.refresh().catch(error => this.sendError('graph', error));
				break;
			case 'graph/filter':
				void this.controller?.filter(request.query).catch(error => this.sendError('filter', error));
				break;
			case 'graph/details':
				const requestId = ++this.detailsRequest;
				void this.sendCommitDetails(request, requestId).catch(error => {
					if (this.detailsRequest === requestId) {
						void this.sendError('details', error);
					}
				});
				break;
			case 'graph/more':
				void this.controller
					?.more(request.limit, request.targetId)
					.catch(error => this.sendError('graph', error));
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
			repository.git.branches.getBranches(),
			repository.git.tags.getTags(),
		]);
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

		await this.host.notify(GraphDidChangeNotification, {
			type: 'graph/context',
			repository: {
				name: truncate(repository.name, graphRefNameMaxLength),
				...(branch == null ? {} : { branch: truncate(branch, graphRefNameMaxLength) }),
			},
			refs: refs.slice(0, graphRefsMax).map(ref => ({ ...ref, name: truncate(ref.name, graphRefNameMaxLength) })),
		});
	}

	private async sendCommitDetails(
		request: GraphDetailsRequest,
		generation: number = ++this.detailsRequest,
	): Promise<void> {
		const repository = this.repository;
		if (repository == null) return;

		let commit: Awaited<ReturnType<typeof repository.git.commits.getCommit>>;
		try {
			commit = await repository.git.commits.getCommit(request.sha);
		} catch (error) {
			if (this.repository !== repository || generation !== this.detailsRequest) return;

			throw error;
		}
		if (commit == null || this.repository !== repository || generation !== this.detailsRequest) return;

		const tips = commit.tips?.join(' ').split(', ') ?? [];
		let remoteNames = new Set<string>();
		if (tips.some(tip => tip.includes('/'))) {
			let remotes: Awaited<ReturnType<typeof repository.git.remotes.getRemotes>>;
			try {
				remotes = await repository.git.remotes.getRemotes();
			} catch (error) {
				if (this.repository !== repository || generation !== this.detailsRequest) return;

				throw error;
			}

			remoteNames = new Set(remotes.map(remote => remote.name));
		}
		if (this.repository !== repository || generation !== this.detailsRequest) return;

		if (request.includeFiles) {
			try {
				await GitCommit.ensureFullDetails(commit);
			} catch (error) {
				if (this.repository !== repository || generation !== this.detailsRequest) return;

				throw error;
			}
			if (this.repository !== repository || generation !== this.detailsRequest) return;
		}

		await this.host.notify(GraphDidChangeNotification, {
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
		});
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

	private async republish(): Promise<void> {
		await this.controller?.open();
		const repository = this.repository;
		if (repository != null) {
			await this.sendWorkspaceContext(repository);
		}
	}

	private async initializeRepository(repository: GlRepository | undefined): Promise<GlRepository | undefined> {
		if (repository == null) return undefined;

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
		if (this.host.ready) {
			await this.sendWorkspaceContext(repository);
		}

		return repository;
	}

	private async initializeBestRepository(): Promise<GlRepository | undefined> {
		return this.initializeRepository(await getRepository(this.container));
	}

	private async refresh(): Promise<void> {
		await this.controller?.refresh();
		const repository = this.repository;
		if (repository != null) {
			await this.sendWorkspaceContext(repository);
		}
	}

	private sendError(operation: GraphErrorMessage['operation'], error: unknown): Promise<void> {
		const message = error instanceof Error ? error.message : String(error);
		return this.host
			.notify(GraphDidChangeNotification, {
				type: 'graph/error',
				operation: operation,
				message: message.slice(0, 512),
			})
			.then(
				() => {},
				() => {},
			);
	}

	private cherryPick(shas: readonly string[]): void {
		const repository = this.repository;
		if (repository == null || shas.length === 0) return;

		void RepoActions.cherryPick(
			repository.path,
			shas.map(sha => createReference(sha, repository.path, { refType: 'revision' })),
		);
	}

	private compareSelectedCommits(shas: readonly string[]): void {
		if (this.repository == null || shas.length !== 2) return;

		void this.container.views.searchAndCompare.compare(this.repository.path, shas[0], shas[1]);
	}

	private openCommitsOnRemote(shas: readonly string[], clipboard: boolean): void {
		if (this.repository == null || shas.length === 0) return;

		void executeCommand('gitlens.openOnRemote', {
			repoPath: this.repository.path,
			resource: shas.map(sha => ({ type: RemoteResourceType.Commit, sha: sha })),
			clipboard: clipboard,
		});
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

async function getRepository(container: Container, arg?: unknown): Promise<GlRepository | undefined> {
	if (GlRepository.is(arg)) return arg;
	if (arg == null || typeof arg !== 'object') return getBestRepositoryOrFirst(container);

	const value = arg as { repository?: unknown; ref?: { repoPath?: unknown } };
	if (GlRepository.is(value.repository)) return value.repository;
	if (typeof value.ref?.repoPath === 'string') return container.git.getRepository(value.ref.repoPath);

	return getBestRepositoryOrFirst(container);
}

async function getBestRepositoryOrFirst(container: Container): Promise<GlRepository | undefined> {
	let repository = container.git.getBestRepositoryOrFirst();
	if (repository == null) {
		await container.git.isDiscoveringRepositories;

		repository = container.git.getBestRepositoryOrFirst();
	}

	return repository;
}

function getContextSha(item: unknown): string | undefined {
	if (item == null || typeof item !== 'object' || !isWebviewItemContext<{ ref?: unknown }>(item)) return undefined;

	const ref = item.webviewItemValue?.ref;
	return typeof ref === 'string' ? ref : undefined;
}

function getContextShas(item: unknown): readonly string[] {
	if (item == null || typeof item !== 'object') return [];

	const context = item as {
		webviewItem?: string;
		webviewItemValue?: { ref?: unknown };
		webviewItemsValues?: { webviewItem?: string; webviewItemValue: { ref?: unknown } }[];
	};
	const values =
		context.webviewItemsValues ??
		(context.webviewItemValue == null
			? []
			: [{ webviewItem: context.webviewItem, webviewItemValue: context.webviewItemValue }]);
	return values
		.map(value => value.webviewItemValue.ref)
		.filter((ref): ref is string => isGraphRowAction({ action: 'copy-sha', sha: ref }));
}
