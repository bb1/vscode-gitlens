import type { WorkspaceFolder } from 'vscode';
import { Uri, workspace } from 'vscode';
import type { GitDir } from '@gitlens/git/models/repository.js';
import type { GitProvider } from '@gitlens/git/providers/provider.js';
import type { RepositoryVisibility } from '@gitlens/git/providers/types.js';
import { encodeGitLensRevisionUriAuthority } from '@gitlens/git/utils/uriAuthority.js';
import type { GitHubRequestTransport } from '@gitlens/hosting-github/githubClient.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { Event } from '@gitlens/utils/event.js';
import type { Uri as GitUri } from '@gitlens/utils/uri.js';
import { getRepositoryKey } from '@gitlens/utils/uri.js';
import { Schemes } from '../constants.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import type { Features } from '../features.js';
import type {
	GlGitProvider,
	RepositoryCloseEvent,
	RepositoryOpenEvent,
	RevisionUriOptions,
	ScmRepository,
} from '../git/gitProvider.js';
import type { RepositoryChangeEvent } from '../git/models/repository.js';
import { GlRepository } from '../git/models/repository.js';
import { getGitHubRemoteHub, getGitHubVirtualRepository, isGitHubRemoteHubUri } from './githubRemoteHub.js';
import type { GitHubRemoteHubProvider } from './githubRemoteHub.js';
import { GitHubVirtualGitDataProvider } from './githubVirtualGitDataProvider.js';

export class GitHubVirtualGitProvider implements GlGitProvider {
	readonly descriptor = { id: 'github' as const, name: 'GitHub', virtual: true };
	readonly supportedSchemes = new Set<string>([Schemes.Virtual, Schemes.GitHub]);

	private readonly onDidChangeEmitter = new Emitter<void>();
	get onDidChange(): Event<void> {
		return this.onDidChangeEmitter.event;
	}

	private readonly onWillChangeRepositoryEmitter = new Emitter<RepositoryChangeEvent>();
	get onWillChangeRepository(): Event<RepositoryChangeEvent> {
		return this.onWillChangeRepositoryEmitter.event;
	}

	private readonly onDidChangeRepositoryEmitter = new Emitter<RepositoryChangeEvent>();
	get onDidChangeRepository(): Event<RepositoryChangeEvent> {
		return this.onDidChangeRepositoryEmitter.event;
	}

	private readonly onDidCloseRepositoryEmitter = new Emitter<RepositoryCloseEvent>();
	get onDidCloseRepository(): Event<RepositoryCloseEvent> {
		return this.onDidCloseRepositoryEmitter.event;
	}

	private readonly onDidOpenRepositoryEmitter = new Emitter<RepositoryOpenEvent>();
	get onDidOpenRepository(): Event<RepositoryOpenEvent> {
		return this.onDidOpenRepositoryEmitter.event;
	}

	private readonly provider: GitHubVirtualGitDataProvider;
	private registration: UnifiedDisposable | undefined;

	constructor(
		private readonly container: Container,
		register: (provider: GitProvider, canHandle: (repoPath: string) => boolean) => UnifiedDisposable,
		request: GitHubRequestTransport = createGitHubRequestTransport(fetch),
		private readonly getRemoteHub: GitHubRemoteHubProvider = getGitHubRemoteHub,
	) {
		this.provider = new GitHubVirtualGitDataProvider({
			getSession: container.hostingAuthentication.getSession.bind(container.hostingAuthentication),
			request: request,
			resolveRepository: async repoPath => {
				const remoteHub = await this.getRemoteHub();
				return getGitHubVirtualRepository(remoteHub, Uri.parse(repoPath, true));
			},
		});
		this.register = register;
	}

	private readonly register: (provider: GitProvider, canHandle: (repoPath: string) => boolean) => UnifiedDisposable;

	ensureRegistered(): void {
		this.registration ??= this.register(
			this.provider,
			repoPath => this.canHandlePathOrUri(getScheme(repoPath), repoPath) != null,
		);
	}

	dispose(): void {
		this.registration?.dispose();
		this.onDidChangeEmitter.dispose();
		this.onWillChangeRepositoryEmitter.dispose();
		this.onDidChangeRepositoryEmitter.dispose();
		this.onDidCloseRepositoryEmitter.dispose();
		this.onDidOpenRepositoryEmitter.dispose();
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	async discoverRepositories(
		uri: Uri,
		options?: { cancellation?: AbortSignal; depth?: number; silent?: boolean },
	): Promise<GlRepository[]> {
		if (!this.supportedSchemes.has(uri.scheme)) return [];

		const remoteHub = await this.getRemoteHub();
		const workspaceUri = remoteHub.getVirtualWorkspaceUri(uri);
		if (workspaceUri == null) return [];

		await getGitHubVirtualRepository(remoteHub, workspaceUri);
		return this.addRepository(undefined, workspaceUri, undefined, true, !options?.silent);
	}

	addRepository(
		folder: WorkspaceFolder | undefined,
		uri: Uri,
		gitDir: GitDir | undefined,
		root: boolean,
		opened: boolean,
	): GlRepository[] {
		this.ensureRegistered();
		const repository = new GlRepository(
			this.container,
			this.descriptor,
			folder ?? workspace.getWorkspaceFolder(uri),
			uri,
			gitDir,
			root,
			opened,
		);
		repository.onDidChange(event => {
			this.onWillChangeRepositoryEmitter.fire(event);
			this.onDidChangeRepositoryEmitter.fire(event);
		});
		return [repository];
	}

	supports(feature: Features): Promise<boolean> {
		return Promise.resolve(feature === 'timeline');
	}

	async visibility(repoPath: string): Promise<[RepositoryVisibility, string | undefined]> {
		return [await this.provider.getVisibility(repoPath), repoPath];
	}

	getOpenScmRepositories(): Promise<ScmRepository[]> {
		return Promise.resolve([]);
	}

	getScmRepository(_repoPath: string): Promise<ScmRepository | undefined> {
		return Promise.resolve(undefined);
	}

	getOrOpenScmRepository(_repoPath: string, _source?: Source): Promise<ScmRepository | undefined> {
		return Promise.resolve(undefined);
	}

	canHandlePathOrUri(scheme: string, pathOrUri: string | GitUri): string | undefined {
		if (!this.supportedSchemes.has(scheme)) return undefined;

		const uri = typeof pathOrUri === 'string' ? Uri.parse(pathOrUri, true) : pathOrUri;
		if (uri.scheme === Schemes.Virtual && !isGitHubRemoteHubUri(uri)) return undefined;

		return typeof pathOrUri === 'string' ? pathOrUri : getRepositoryKey(pathOrUri);
	}

	async findRepositoryUri(uri: Uri): Promise<Uri | undefined> {
		if (!this.supportedSchemes.has(uri.scheme)) return undefined;

		const remoteHub = await this.getRemoteHub();
		const root = remoteHub.getVirtualWorkspaceUri(uri) ?? uri;
		await getGitHubVirtualRepository(remoteHub, root);
		return root;
	}

	getAbsoluteUri(pathOrUri: string | GitUri, base: string | GitUri): GitUri {
		return this.provider.getAbsoluteUri(pathOrUri, base);
	}

	getBestRevisionUri(
		repoPath: string,
		pathOrUri: string | GitUri,
		rev: string | undefined,
	): Promise<GitUri | undefined> {
		return Promise.resolve(
			rev == null ? undefined : this.getRevisionUri(repoPath, rev, this.getRelativePath(pathOrUri, repoPath)),
		);
	}

	getRelativePath(pathOrUri: string | GitUri, base: string | GitUri): string {
		return this.provider.getRelativePath(pathOrUri, base);
	}

	getRevisionUri(repoPath: string, rev: string, path: string, options?: RevisionUriOptions): GitUri {
		return Uri.from({
			scheme: Schemes.GitLens,
			authority: encodeGitLensRevisionUriAuthority({
				ref: rev,
				repoPath: repoPath,
				submoduleSha: options?.submoduleSha,
			}),
			path: `/${path.replace(/^\//, '')}`,
		});
	}

	getWorkingUri(_repoPath: string, _uri: Uri): Promise<Uri | undefined> {
		return Promise.resolve(undefined);
	}

	async isFolderUri(repoPath: string, uri: Uri): Promise<boolean> {
		return (
			(
				await this.provider.revision.getTreeEntryForRevision(
					repoPath,
					this.getRelativePath(uri, repoPath),
					'HEAD',
				)
			)?.type === 'tree'
		);
	}

	excludeIgnoredUris(_repoPath: string, uris: Uri[]): Promise<Uri[]> {
		return Promise.resolve(uris);
	}

	getIgnoredUrisFilter(_repoPath: string): Promise<(uri: Uri) => boolean> {
		return Promise.resolve(() => false);
	}

	getLastFetchedTimestamp(_repoPath: string): Promise<number | undefined> {
		return Promise.resolve(undefined);
	}

	isTrackable(uri: Uri): boolean {
		return this.supportedSchemes.has(uri.scheme);
	}

	async isTracked(uri: Uri): Promise<boolean> {
		try {
			await this.findRepositoryUri(uri);
			return true;
		} catch {
			return false;
		}
	}
}

export function createGitHubRequestTransport(
	fetcher: (url: string, init: RequestInit) => Promise<Response>,
): GitHubRequestTransport {
	return async request => {
		const response = await fetcher(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});
		const link = response.headers.get('link');
		return {
			status: response.status,
			body: response.status === 204 ? undefined : await response.json().catch(() => undefined),
			...(link == null ? undefined : { headers: { link: link } }),
		};
	};
}

function getScheme(value: string): string {
	return Uri.parse(value, true).scheme;
}
