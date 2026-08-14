import { GitBranch } from '@gitlens/git/models/branch.js';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import { GitContributor } from '@gitlens/git/models/contributor.js';
import type { GitDiffShortStat } from '@gitlens/git/models/diff.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { GitFileIndexStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitGraph, GitGraphRow } from '@gitlens/git/models/graph.js';
import type { GitGraphSearch, GitGraphSearchProgress } from '@gitlens/git/models/graphSearch.js';
import type {
	GitGraphSession,
	GitGraphSessionRefreshOptions,
	GitGraphSessionRefreshResult,
} from '@gitlens/git/models/graphSession.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import type { GitRefTip } from '@gitlens/git/models/reference.js';
import { GitRemote } from '@gitlens/git/models/remote.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import { GitTag } from '@gitlens/git/models/tag.js';
import type { GitUser } from '@gitlens/git/models/user.js';
import type { GitBranchesSubProvider } from '@gitlens/git/providers/branches.js';
import type { GitCommitsSubProvider } from '@gitlens/git/providers/commits.js';
import type { GitConfigSubProvider } from '@gitlens/git/providers/config.js';
import type { GitContributorsSubProvider } from '@gitlens/git/providers/contributors.js';
import type { GitDiffSubProvider } from '@gitlens/git/providers/diff.js';
import type { GitGraphSubProvider } from '@gitlens/git/providers/graph.js';
import type { GitOperationsSubProvider } from '@gitlens/git/providers/operations.js';
import type { GitPatchSubProvider } from '@gitlens/git/providers/patch.js';
import type { GitPausedOperationsSubProvider } from '@gitlens/git/providers/pausedOperations.js';
import type { GitProvider } from '@gitlens/git/providers/provider.js';
import type { GitRefsSubProvider } from '@gitlens/git/providers/refs.js';
import type { GitRemotesSubProvider } from '@gitlens/git/providers/remotes.js';
import type { GitRevisionSubProvider } from '@gitlens/git/providers/revision.js';
import type { GitStagingSubProvider } from '@gitlens/git/providers/staging.js';
import type { GitStashSubProvider } from '@gitlens/git/providers/stash.js';
import type { GitStatusSubProvider } from '@gitlens/git/providers/status.js';
import type { GitTagsSubProvider } from '@gitlens/git/providers/tags.js';
import type { GitWorktreesSubProvider } from '@gitlens/git/providers/worktrees.js';
import { GitHubRemoteProvider } from '@gitlens/git/remotes/github.js';
import type { GitHubAnnotatedTag, GitHubCommit, GitHubCommitFile } from '@gitlens/hosting-github/gitDataModels.js';
import type { GitHubRequestTransport } from '@gitlens/hosting-github/githubClient.js';
import { GitHubClient, GitHubRequestError, GitHubResponseTooLargeError } from '@gitlens/hosting-github/githubClient.js';
import type { PagedResult, PagingOptions } from '@gitlens/utils/paging.js';
import { joinUriPath, parseUri } from '@gitlens/utils/uri.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { GitHubVirtualRepository } from './githubRemoteHub.js';
import type { HostingAuthenticationService } from './models.js';

const pageSize = 100;
const maxPages = 10;
const githubScopes = ['repo'];

export class GitHubVirtualUnsupportedError extends Error {
	static is(error: unknown): error is GitHubVirtualUnsupportedError {
		return (
			error instanceof GitHubVirtualUnsupportedError ||
			(isRecord(error) && error.kind === 'gitlens.github-virtual-unsupported')
		);
	}

	constructor(readonly operation: string) {
		super(`GitHub virtual repositories do not support ${operation}`);
		Object.defineProperty(this, 'kind', { value: 'gitlens.github-virtual-unsupported' });
	}
}

export type GitHubVirtualGitDataProviderDependencies = {
	getSession: HostingAuthenticationService['getSession'];
	request: GitHubRequestTransport;
	resolveRepository(repoPath: string): Promise<GitHubVirtualRepository>;
};

export class GitHubVirtualGitDataProvider implements GitProvider {
	readonly descriptor = { id: 'github' as const, name: 'GitHub', virtual: true };

	readonly branches: GitBranchesSubProvider = {
		getBranch: async (repoPath, name) => {
			const repository = await this.repository(repoPath);
			const branchName = name ?? repository.revisionName;
			if (branchName === repository.revision) {
				return new GitBranch(
					repoPath,
					`refs/heads/${branchName}`,
					true,
					undefined,
					undefined,
					repository.revision,
					undefined,
					false,
					true,
				);
			}

			try {
				const branch = await this.client(repository).then(client => client.getBranch(repository, branchName));
				return this.toBranch(repoPath, branch.name, branch.sha, branch.name === repository.revisionName);
			} catch (ex) {
				if (GitHubRequestError.is(ex) && ex.status === 404) {
					if (name == null) {
						return new GitBranch(
							repoPath,
							`refs/heads/${repository.revisionName}`,
							true,
							undefined,
							undefined,
							repository.revision,
							undefined,
							false,
							true,
						);
					}

					return undefined;
				}

				throw ex;
			}
		},
		getBranches: async (repoPath, options) => {
			const repository = await this.repository(repoPath);
			const page = getPage(options?.paging);
			const result = await this.client(repository).then(client =>
				client.listBranchesPage(repository, { limit: pageSize, page: page }),
			);
			let values = result.values.map(branch =>
				this.toBranch(repoPath, branch.name, branch.sha, branch.name === repository.revisionName),
			);
			if (options?.filter != null) {
				values = values.filter(options.filter);
			}

			return paged(values, result.nextPage);
		},
		getBranchContributionsOverview: () => Promise.reject(unsupported('branch contribution summaries')),
		getBranchesWithCommits: () => Promise.reject(unsupported('branch reachability')),
		getDefaultBranchName: async (repoPath, _remote, options) => {
			if (repoPath == null) return undefined;
			if (options?.local) return undefined;

			const repository = await this.repository(repoPath);
			return this.client(repository)
				.then(client => client.getDefaultBranch(repository))
				.then(branch => branch.name);
		},
		createBranch: () => rejectUnsupported('branch mutations'),
		deleteLocalBranch: () => rejectUnsupported('branch mutations'),
		deleteRemoteBranch: () => rejectUnsupported('branch mutations'),
		renameBranch: () => rejectUnsupported('branch mutations'),
		setUpstreamBranch: () => rejectUnsupported('branch mutations'),
		setBranchDisposition: () => rejectUnsupported('branch mutations'),
		storeBaseBranchName: () => rejectUnsupported('branch mutations'),
		storeMergeTargetBranchName: () => rejectUnsupported('branch mutations'),
		storeUserMergeTargetBranchName: () => rejectUnsupported('branch mutations'),
	};

	readonly commits: GitCommitsSubProvider = {
		getCommit: async (repoPath, rev) => {
			const repository = await this.repository(repoPath);
			const resolved = this.resolveRevisionName(repository, rev);
			try {
				return this.toCommit(
					repoPath,
					await this.client(repository).then(client => client.getCommit(repository, resolved)),
				);
			} catch (ex) {
				if (GitHubRequestError.is(ex) && ex.status === 404) return undefined;

				throw ex;
			}
		},
		getCommitCount: () => Promise.resolve(undefined),
		getCommitFiles: async (repoPath, rev) => {
			const commit = await this.commits.getCommit(repoPath, rev);
			return [...(commit?.fileset?.files ?? [])];
		},
		getCommitForFile: async (repoPath, path, rev) => {
			const log = await this.commits.getLogForPath(repoPath, path, rev, { limit: 1, includeFiles: true });
			return log?.commits.values().next().value;
		},
		getLeftRightCommitCount: async (repoPath, range) => {
			const [base, head] = splitRange(range);
			const repository = await this.repository(repoPath);
			const result = await this.client(repository).then(client => client.compareCommits(repository, base, head));
			return { left: result.behindBy, right: result.aheadBy };
		},
		getLog: (repoPath, rev, options) => this.getLog(repoPath, rev, options),
		getLogForPath: (repoPath, path, rev, options) =>
			this.getLog(repoPath, rev, { ...options, path: this.getRelativePath(path, repoPath) }),
		getLogShas: async (repoPath, rev, options) => {
			const log = await this.getLog(repoPath, rev, options);
			return log?.commits.keys() ?? [];
		},
		getOldestUnpushedShaForPath: () => Promise.resolve(undefined),
		isAncestorOf: async (repoPath, rev1, rev2) => {
			const repository = await this.repository(repoPath);
			const result = await this.client(repository).then(client => client.compareCommits(repository, rev1, rev2));
			return result.behindBy === 0;
		},
		hasCommitBeenPushed: () => Promise.reject(unsupported('pushed commit detection')),
		searchCommits: () => Promise.reject(unsupported('commit search')),
		createUnreachableCommitFromTree: () => rejectUnsupported('commit mutations'),
	};

	readonly config: GitConfigSubProvider = {
		getCurrentUser: async (repoPath): Promise<GitUser | undefined> => {
			const repository = await this.repository(repoPath);
			const session = await this.session(repository.domain);
			return { name: session.accountLabel, email: undefined, username: session.accountLabel };
		},
		setConfig: () => rejectUnsupported('configuration mutations'),
		setGkConfig: () => rejectUnsupported('configuration mutations'),
		removeGkConfigBranchSection: () => rejectUnsupported('configuration mutations'),
		renameGkConfigBranchSection: () => rejectUnsupported('configuration mutations'),
		setSigningConfig: () => rejectUnsupported('configuration mutations'),
	};

	readonly contributors: GitContributorsSubProvider = {
		getContributors: async (repoPath, rev, options) => {
			if (rev != null || options?.pathspec != null || options?.since != null || options?.stats) {
				throw unsupported('filtered contributor history');
			}

			const contributors = await this.contributors.getContributorsLite(repoPath);
			return { contributors: contributors };
		},
		getContributorsLite: async (repoPath, rev) => {
			if (rev != null) throw unsupported('filtered contributor history');

			const repository = await this.repository(repoPath);
			const contributors = await this.getAllPages(page =>
				this.client(repository).then(client =>
					client.listContributorsPage(repository, { limit: pageSize, page: page }),
				),
			);
			return contributors.map(
				contributor =>
					new GitContributor(
						repoPath,
						contributor.login ?? 'Unknown',
						undefined,
						false,
						contributor.contributions,
						undefined,
						undefined,
						undefined,
						undefined,
						contributor.login,
						contributor.avatarUrl,
					),
			);
		},
		getContributorsStats: async (repoPath, options) => {
			if (options?.since != null) throw unsupported('filtered contributor statistics');

			const contributors = await this.contributors.getContributorsLite(repoPath);
			return {
				count: contributors.length,
				contributions: contributors.map(contributor => contributor.contributionCount),
			};
		},
	};

	readonly diff: GitDiffSubProvider = {
		getChangedFilesCount: async (repoPath, to, from) => {
			if (to == null && from == null) throw unsupported('working-tree diff');

			const files = await this.diff.getDiffStatus(repoPath, from ?? 'HEAD', to ?? 'HEAD');
			return files == null ? undefined : shortStat(files);
		},
		getDiffStatus: async (repoPath, ref1, ref2) => {
			if (typeof ref1 === 'string' && ref1.includes('..') && !ref1.includes('...')) {
				throw unsupported('two-dot comparisons');
			}

			const [base, head] =
				typeof ref1 === 'string' && ref1.includes('...') ? splitRange(ref1) : [ref1, ref2 ?? 'HEAD'];
			const repository = await this.repository(repoPath);
			const comparison = await this.client(repository).then(client =>
				client.compareCommits(
					repository,
					this.resolveRevisionName(repository, base),
					this.resolveRevisionName(repository, head),
				),
			);
			return comparison.files.map(file => this.toGitFile(repoPath, file));
		},
		getNextComparisonUris: () => Promise.reject(unsupported('file-history navigation')),
		getPreviousComparisonUris: () => Promise.reject(unsupported('file-history navigation')),
		getPreviousComparisonUrisForRange: () => Promise.reject(unsupported('file-history navigation')),
		openDiffTool: () => rejectUnsupported('external diff tools'),
		openDirectoryCompare: () => rejectUnsupported('external directory comparison'),
	};

	readonly graph: GitGraphSubProvider = {
		openGraphSession: async (repoPath, options, cancellation) => {
			const session = new GitHubVirtualGraphSession(this, repoPath);
			await session.initialize(options, cancellation);
			return session;
		},
		getGraph: (repoPath, rev, options) => this.getGraph(repoPath, rev, options),
		searchGraph: (_repoPath, search) => unsupportedGraphSearch(search),
		continueSearchGraph: (_repoPath, cursor) => unsupportedGraphSearch(cursor.search),
	};

	readonly refs: GitRefsSubProvider = {
		checkIfCouldBeValidBranchOrTagName: (_repoPath, ref) => Promise.resolve(isReference(ref)),
		getMergeBase: async (repoPath, ref1, ref2) => {
			const repository = await this.repository(repoPath);
			return this.client(repository)
				.then(client => client.compareCommits(repository, ref1, ref2))
				.then(result => result.mergeBaseSha);
		},
		getReference: async (repoPath, ref) => {
			const branch = await this.branches.getBranch(repoPath, ref);
			if (branch != null) return branch;

			const tag = await this.tags.getTag(repoPath, ref);
			if (tag != null) return tag;

			return this.commits.getCommit(repoPath, ref);
		},
		getRefTips: async (repoPath, options) => {
			const repository = await this.repository(repoPath);
			const include = options?.include ?? ['heads', 'remotes', 'tags'];
			const tips: GitRefTip[] = [];
			const refs = await this.getAllPages(page =>
				this.client(repository).then(client =>
					client.listRefsPage(repository, { limit: pageSize, page: page }),
				),
			);
			const client = await this.client(repository);
			for (const ref of refs) {
				if (ref.name.startsWith('heads/') && ref.type === 'commit') {
					const name = ref.name.slice('heads/'.length);
					if (include.includes('heads')) {
						tips.push({ type: 'branch', name: name, fullName: `refs/${ref.name}`, sha: ref.sha });
					}
					if (include.includes('remotes')) {
						tips.push({
							type: 'remote',
							name: `origin/${name}`,
							fullName: `refs/remotes/origin/${name}`,
							sha: ref.sha,
						});
					}
				} else if (include.includes('tags') && ref.name.startsWith('tags/')) {
					const sha =
						ref.type === 'tag' ? (await client.getAnnotatedTag(repository, ref.sha)).targetSha : ref.sha;
					tips.push({
						type: 'tag',
						name: ref.name.slice('tags/'.length),
						fullName: `refs/${ref.name}`,
						sha: sha,
					});
				}
			}

			return tips;
		},
		getRefsContainingShas: () => Promise.reject(unsupported('ref reachability')),
		hasBranchOrTag: async (repoPath, options) => {
			if (repoPath == null) return false;

			const [branches, tags] = await Promise.all([this.getAllBranches(repoPath), this.getAllTags(repoPath)]);
			const branchFilter = options?.filter?.branches;
			const tagFilter = options?.filter?.tags;
			return (
				(branchFilter == null ? branches.length !== 0 : branches.some(branchFilter)) ||
				(tagFilter == null ? tags.length !== 0 : tags.some(tagFilter))
			);
		},
		isValidReference: async (repoPath, ref, path) =>
			(await this.revision.resolveRevision(repoPath, ref, path)).sha !== deletedOrMissing,
		validateReference: async (repoPath, ref, path) =>
			(await this.revision.resolveRevision(repoPath, ref, path)).sha,
		updateReference: () => Promise.reject(unsupported('reference updates')),
	};

	readonly remotes: GitRemotesSubProvider = {
		getRemote: async (repoPath, name) => {
			if (repoPath == null || name !== 'origin') return undefined;

			return this.remote(await this.repository(repoPath), repoPath);
		},
		getRemotes: async (repoPath, options) => {
			if (repoPath == null) return [];

			const remote = this.remote(await this.repository(repoPath), repoPath);
			return options?.filter == null || options.filter(remote) ? [remote] : [];
		},
		getDefaultRemote: async repoPath => this.remote(await this.repository(repoPath), repoPath),
		getRemotesWithProviders: async repoPath => [this.remote(await this.repository(repoPath), repoPath)],
		getBestRemoteWithProvider: async repoPath => this.remote(await this.repository(repoPath), repoPath),
		getBestRemotesWithProviders: async repoPath => [this.remote(await this.repository(repoPath), repoPath)],
		setRemoteAsDefault: () => Promise.reject(unsupported('remote updates')),
		addRemote: () => rejectUnsupported('remote updates'),
		addRemoteWithResult: () => rejectUnsupported('remote updates'),
		pruneRemote: () => rejectUnsupported('remote updates'),
		removeRemote: () => rejectUnsupported('remote updates'),
	};

	readonly revision: GitRevisionSubProvider = {
		exists: async (repoPath, path, rev) =>
			(await this.revision.getTreeEntryForRevision(repoPath, path, typeof rev === 'string' ? rev : 'HEAD')) !=
			null,
		getRevisionContent: async (repoPath, path, rev) => {
			if (rev === deletedOrMissing) return undefined;

			const repository = await this.repository(repoPath);
			try {
				return await this.client(repository)
					.then(client =>
						client.getContent(repository, this.getRelativePath(path, repoPath), {
							ref: this.resolveRevisionName(repository, rev),
						}),
					)
					.then(content => content.bytes);
			} catch (ex) {
				const entry = await this.revision.getTreeEntryForRevision(repoPath, path, rev);
				if (entry?.type === 'commit') {
					return new TextEncoder().encode(`Subproject commit ${entry.oid}\n`);
				}
				if (GitHubRequestError.is(ex) && ex.status === 404) return undefined;

				throw ex;
			}
		},
		getTrackedFiles: async repoPath =>
			(await this.revision.getTreeForRevision(repoPath, 'HEAD'))
				.filter(entry => entry.type === 'blob')
				.map(entry => entry.path),
		getTreeEntryForRevision: async (repoPath, path, rev) => {
			const entries = await this.revision.getTreeForRevision(repoPath, rev);
			return entries.find(entry => entry.path === this.getRelativePath(path, repoPath));
		},
		getTreeForRevision: async (repoPath, rev) => {
			const repository = await this.repository(repoPath);
			const tree = await this.client(repository).then(client =>
				client.getTree(repository, this.resolveRevisionName(repository, rev)),
			);
			return tree.entries.map(entry => ({
				ref: rev,
				oid: entry.sha,
				path: entry.path,
				size: entry.size ?? 0,
				type: entry.type,
			}));
		},
		resolveRevision: async (repoPath, ref, path) => {
			if (ref === deletedOrMissing) return { sha: ref, revision: ref };

			const repository = await this.repository(repoPath);
			const resolved = this.resolveRevisionName(repository, ref);
			try {
				const commit = await this.client(repository).then(client => client.getCommit(repository, resolved));
				return {
					sha: commit.sha,
					revision: ref,
					...(path == null ? undefined : { path: this.getRelativePath(path, repoPath) }),
				};
			} catch (ex) {
				if (GitHubRequestError.is(ex) && ex.status === 404) return { sha: deletedOrMissing, revision: ref };

				throw ex;
			}
		},
	};

	readonly status: GitStatusSubProvider = {
		getStatus: () => Promise.reject(unsupported('working tree status')),
		hasWorkingChanges: () => Promise.reject(unsupported('working tree status')),
		getWorkingChangesState: () => Promise.reject(unsupported('working tree status')),
		hasConflictingFiles: () => Promise.reject(unsupported('working tree status')),
		getConflictingFiles: () => Promise.reject(unsupported('working tree status')),
		getUntrackedFiles: () => Promise.reject(unsupported('working tree status')),
	};

	readonly tags: GitTagsSubProvider = {
		getTag: async (repoPath, name) => {
			const tags = await this.getAllTags(repoPath);
			return tags.find(tag => tag.name === name);
		},
		getTags: async (repoPath, options) => {
			const repository = await this.repository(repoPath);
			const page = getPage(options?.paging);
			const result = await this.client(repository).then(client =>
				client.listTagsPage(repository, { limit: pageSize, page: page }),
			);
			const client = await this.client(repository);
			const values: GitTag[] = [];
			for (const tag of result.values) {
				const ref = await client.getRef(repository, `tags/${tag.name}`);
				let annotated: GitHubAnnotatedTag | undefined;
				if (ref?.type === 'tag') {
					annotated = await client.getAnnotatedTag(repository, ref.sha);
				}
				values.push(
					new GitTag(
						repoPath,
						`refs/tags/${tag.name}`,
						annotated?.targetSha ?? tag.sha,
						annotated?.message ?? '',
						annotated == null ? undefined : new Date(annotated.tagger.date),
						undefined,
						annotated != null,
					),
				);
			}
			return paged(options?.filter == null ? values : values.filter(options.filter), result.nextPage);
		},
		getTagsWithCommit: async (repoPath, sha, options) => {
			if (options?.mode !== 'pointsAt') throw unsupported('tag reachability');

			const tags = await this.getAllTags(repoPath);
			return tags.filter(tag => tag.sha === sha).map(tag => tag.name);
		},
		createTag: () => rejectUnsupported('tag mutations'),
		deleteTag: () => rejectUnsupported('tag mutations'),
	};

	readonly ops: GitOperationsSubProvider = unsupportedSubProvider('git operations');
	readonly patch: GitPatchSubProvider = unsupportedSubProvider('patch operations');
	readonly pausedOps: GitPausedOperationsSubProvider = unsupportedSubProvider('paused operations');
	readonly staging: GitStagingSubProvider = unsupportedSubProvider('staging');
	readonly stash: GitStashSubProvider = unsupportedSubProvider('stash operations');
	readonly worktrees: GitWorktreesSubProvider = unsupportedSubProvider<GitWorktreesSubProvider>(
		'worktree operations',
		{
			getWorktreesDefaultUri: () => {
				throw unsupported('worktree operations');
			},
		},
	);

	constructor(private readonly dependencies: GitHubVirtualGitDataProviderDependencies) {}

	clone(_url: string, _parentPath: string): Promise<string | undefined> {
		return rejectUnsupported('clone');
	}

	getAbsoluteUri(pathOrUri: string | Uri, base: string | Uri): Uri {
		const baseUri = typeof base === 'string' ? parseUri(base, true) : base;
		if (typeof pathOrUri !== 'string') return pathOrUri;
		if (pathOrUri.includes('://')) return parseUri(pathOrUri, true);

		return joinUriPath(baseUri, pathOrUri);
	}

	getRelativePath(pathOrUri: string | Uri, base: string | Uri): string {
		const baseUri = typeof base === 'string' ? parseUri(base, true) : base;
		const path =
			typeof pathOrUri === 'string'
				? pathOrUri.includes('://')
					? parseUri(pathOrUri, true).path
					: pathOrUri
				: pathOrUri.path;
		return path.startsWith(baseUri.path)
			? path.slice(baseUri.path.length).replace(/^\//, '')
			: path.replace(/^\//, '');
	}

	async getVisibility(repoPath: string): Promise<'private' | 'public'> {
		const repository = await this.repository(repoPath);
		const metadata = await this.client(repository).then(client => client.getRepository(repository));
		return metadata.isPrivate ? 'private' : 'public';
	}

	private async repository(repoPath: string): Promise<GitHubVirtualRepository> {
		return this.dependencies.resolveRepository(repoPath);
	}

	private async session(domain: string) {
		const session = await this.dependencies.getSession('github', domain, githubScopes, { silent: true });
		if (session == null) throw new Error('GitHub authentication is required');

		return session;
	}

	private async client(repository: GitHubVirtualRepository): Promise<GitHubClient> {
		const session = await this.session(repository.domain);
		return new GitHubClient(session.accessToken, this.dependencies.request, repository.domain);
	}

	private getLog(
		repoPath: string,
		rev: string | undefined,
		options?: { cursor?: string; limit?: number; path?: string },
	): Promise<GitLog | undefined> {
		return this.getLogCore(repoPath, rev, options);
	}

	private async getLogCore(
		repoPath: string,
		rev: string | undefined,
		options?: { cursor?: string; limit?: number; path?: string },
	): Promise<GitLog> {
		const repository = await this.repository(repoPath);
		const page = getPageFromCursor(options?.cursor);
		const limit = options?.limit === 0 ? pageSize : Math.min(options?.limit ?? pageSize, pageSize);
		const result = await this.client(repository).then(client =>
			client.listCommitsPage(repository, {
				limit: limit,
				page: page,
				ref: this.resolveRevisionName(repository, rev),
				path: options?.path,
			}),
		);
		const commits = new Map(result.values.map(commit => [commit.sha, this.toCommit(repoPath, commit)]));
		const log: GitLog = {
			repoPath: repoPath,
			commits: commits,
			count: commits.size,
			sha: rev,
			limit: limit,
			hasMore: result.nextPage != null,
			startingCursor: options?.cursor,
			endingCursor: result.nextPage == null ? undefined : String(result.nextPage),
			query: limit => this.getLogCore(repoPath, rev, { ...options, limit: limit }),
		};
		if (result.nextPage != null) {
			log.more = limit => this.getLogMore(log, repoPath, rev, options, String(result.nextPage), limit);
		}

		return log;
	}

	private async getLogMore(
		log: GitLog,
		repoPath: string,
		rev: string | undefined,
		options: { cursor?: string; limit?: number; path?: string } | undefined,
		cursor: string,
		limit: number | { until?: string } | undefined,
	): Promise<GitLog> {
		const pageLog = await this.getLogCore(repoPath, rev, {
			...options,
			limit: typeof limit === 'number' ? limit : undefined,
			cursor: cursor,
		});
		const pageCommits = pageLog.pagedCommits?.() ?? pageLog.commits;
		const newCommits = new Map(pageCommits);
		for (const sha of log.commits.keys()) {
			newCommits.delete(sha);
		}

		const commits = new Map([...log.commits, ...newCommits]);
		const merged: GitLog = {
			repoPath: repoPath,
			commits: commits,
			count: commits.size,
			sha: log.sha,
			limit: (log.limit ?? 0) + (pageLog.limit ?? 0),
			startingCursor: [...log.commits.keys()].at(-1),
			endingCursor: pageLog.endingCursor,
			hasMore: pageLog.hasMore,
			pagedCommits: () => newCommits,
			query: log.query,
		};
		if (pageLog.endingCursor != null) {
			merged.more = nextLimit =>
				this.getLogMore(merged, repoPath, rev, options, pageLog.endingCursor!, nextLimit);
		}

		return merged;
	}

	private async getGraph(
		repoPath: string,
		rev: string | undefined,
		options?: { include?: { stats?: boolean }; limit?: number },
	): Promise<GitGraph> {
		const [log, branches, tags, remotes] = await Promise.all([
			this.getLogCore(repoPath, rev, { limit: options?.limit }),
			this.getAllBranches(repoPath),
			this.getAllTags(repoPath),
			this.remotes.getRemotes(repoPath),
		]);
		return this.createGraph(repoPath, rev, log, branches, tags, remotes, options);
	}

	private createGraph(
		repoPath: string,
		rev: string | undefined,
		log: GitLog,
		branches: GitBranch[],
		tags: GitTag[],
		remotes: GitRemote[],
		options?: { include?: { stats?: boolean }; limit?: number },
	): GitGraph {
		const branchTips = groupBySha(branches);
		const tagTips = groupBySha(tags);
		const rows: GitGraphRow[] = [];
		for (const commit of (log.pagedCommits?.() ?? log.commits).values()) {
			const branch = branchTips.get(commit.sha);
			const tag = tagTips.get(commit.sha);
			rows.push({
				sha: commit.sha,
				parents: commit.parents,
				author: commit.author.name,
				email: commit.author.email ?? '',
				date: commit.author.date.getTime(),
				commitDate: commit.committer.date.getTime(),
				message: commit.message ?? commit.summary,
				kind: commit.parents.length > 1 ? 'merge' : 'commit',
				heads: branch?.map(value => ({ name: value.name, isCurrentHead: value.current })),
				tags: tag?.map(value => ({ name: value.name, annotated: value.annotated })),
			});
		}

		return {
			repoPath: repoPath,
			avatars: new Map(),
			ids: new Set(rows.map(row => row.sha)),
			includes: options?.include,
			branches: new Map(branches.map(branch => [branch.name, branch])),
			remotes: new Map(remotes.map(remote => [remote.name, remote])),
			downstreams: new Map(),
			stashes: undefined,
			worktrees: undefined,
			worktreesByBranch: undefined,
			rows: rows,
			paging: { limit: log.limit, startingCursor: log.startingCursor, hasMore: log.hasMore },
			more:
				log.more == null
					? undefined
					: async limit => {
							const next = await log.more?.(limit);
							return next == null
								? undefined
								: this.createGraph(repoPath, rev, next, branches, tags, remotes, {
										...options,
										limit: limit,
									});
						},
		};
	}

	private async getAllBranches(repoPath: string): Promise<GitBranch[]> {
		const repository = await this.repository(repoPath);
		const branches = await this.getAllPages(page =>
			this.client(repository).then(client =>
				client.listBranchesPage(repository, { limit: pageSize, page: page }),
			),
		);
		return branches.map(branch =>
			this.toBranch(repoPath, branch.name, branch.sha, branch.name === repository.revisionName),
		);
	}

	private async getAllTags(repoPath: string): Promise<GitTag[]> {
		const pages: GitTag[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < maxPages; page++) {
			const result = await this.tags.getTags(repoPath, {
				paging: cursor == null ? undefined : { cursor: cursor },
			});
			pages.push(...result.values);
			if (!result.paging?.more) return pages;

			cursor = result.paging.cursor;
		}

		throw new GitHubResponseTooLargeError();
	}

	private async getAllPages<T>(
		getPage: (page: number) => Promise<{ values: readonly T[]; nextPage: number | undefined }>,
	): Promise<T[]> {
		const values: T[] = [];
		let page = 1;
		for (let count = 0; count < maxPages; count++) {
			const result = await getPage(page);
			values.push(...result.values);
			if (result.nextPage == null) return values;

			page = result.nextPage;
		}

		throw new GitHubResponseTooLargeError();
	}

	private toBranch(repoPath: string, name: string, sha: string, current: boolean): GitBranch {
		return new GitBranch(
			repoPath,
			`refs/remotes/origin/${name}`,
			current,
			undefined,
			undefined,
			sha,
			undefined,
			false,
		);
	}

	private toCommit(repoPath: string, commit: GitHubCommit): GitCommit {
		return new GitCommit(
			repoPath,
			commit.sha,
			new GitCommitIdentity(commit.author.name, commit.author.email, new Date(commit.author.date)),
			new GitCommitIdentity(commit.committer.name, commit.committer.email, new Date(commit.committer.date)),
			commit.message.split('\n', 1)[0],
			[...commit.parents],
			commit.message,
			commit.files == null ? undefined : { files: commit.files.map(file => this.toFileChange(repoPath, file)) },
			commit.changes == null || commit.additions == null || commit.deletions == null
				? undefined
				: { files: commit.files?.length ?? 0, additions: commit.additions, deletions: commit.deletions },
		);
	}

	private toFileChange(repoPath: string, file: GitHubCommitFile): GitFileChange {
		const uri = this.getAbsoluteUri(file.path, repoPath);
		return new GitFileChange(
			repoPath,
			file.path,
			toFileStatus(file.status),
			uri,
			file.previousPath,
			file.previousPath == null ? undefined : this.getAbsoluteUri(file.previousPath, repoPath),
			undefined,
			{ additions: file.additions, deletions: file.deletions, changes: file.changes },
		);
	}

	private toGitFile(repoPath: string, file: GitHubCommitFile): GitFile {
		return {
			path: file.path,
			...(file.previousPath == null ? undefined : { originalPath: file.previousPath }),
			status: toFileStatus(file.status),
			repoPath: repoPath,
			stats: { additions: file.additions, deletions: file.deletions, changes: file.changes },
		};
	}

	private remote(repository: GitHubVirtualRepository, repoPath: string): GitRemote<GitHubRemoteProvider> {
		const url = `https://${repository.domain}/${repository.owner}/${repository.name}.git`;
		const provider = new GitHubRemoteProvider(repository.domain, `${repository.owner}/${repository.name}`);
		return new GitRemote(
			repoPath,
			'origin',
			'https',
			repository.domain,
			`${repository.owner}/${repository.name}`,
			[{ type: 'fetch', url: url }],
			provider,
			true,
		);
	}

	private resolveRevisionName(repository: GitHubVirtualRepository, ref: string | undefined): string {
		return ref == null || ref === 'HEAD' ? repository.revision : ref;
	}
}

class GitHubVirtualGraphSession implements GitGraphSession {
	private _current!: GitGraph;
	private _window: readonly GitGraphRow[] = [];

	constructor(
		private readonly provider: GitHubVirtualGitDataProvider,
		readonly repoPath: string,
	) {}

	get current(): GitGraph {
		return this._current;
	}

	get window(): readonly GitGraphRow[] {
		return this._window;
	}

	async initialize(
		options?: { rev?: string; limit?: number; include?: { stats?: boolean } },
		_cancellation?: AbortSignal,
	): Promise<void> {
		this._current = await this.provider.graph.getGraph(this.repoPath, options?.rev, options);
		this._window = this._current.rows;
	}

	async more(limit?: number): Promise<boolean> {
		const next = await this._current.more?.(limit ?? pageSize);
		if (next == null) return false;

		this._current = next;
		this._window = [...this._window, ...next.rows];
		return next.rows.length !== 0;
	}

	async refresh(
		options?: GitGraphSessionRefreshOptions,
		_cancellation?: AbortSignal,
	): Promise<GitGraphSessionRefreshResult> {
		this._current = await this.provider.graph.getGraph(this.repoPath, options?.rev, options);
		this._window = this._current.rows;
		return {
			path: 'full',
			changed: {
				rows: true,
				reachability: false,
				rowsStats: Boolean(options?.include?.stats),
				avatars: false,
				downstreams: false,
			},
		};
	}

	dispose(): void {}
}

function paged<T>(values: NonNullable<T>[], nextPage: number | undefined): PagedResult<T> {
	return nextPage == null
		? { values: values }
		: {
				values: values,
				paging: {
					cursor: String(nextPage),
					more: true,
					page: nextPage - 1,
					pageSize: pageSize,
					nextPage: nextPage,
				},
			};
}

function getPage(paging: PagingOptions | undefined): number {
	return paging?.page ?? getPageFromCursor(paging?.cursor);
}

function getPageFromCursor(cursor: string | undefined): number {
	if (cursor == null) return 1;

	const page = Number(cursor);
	if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid GitHub page cursor');

	return page;
}

function splitRange(range: string): [string, string] {
	const separator = range.includes('...') ? '...' : '..';
	const [base, head] = range.split(separator, 2);
	return [base || 'HEAD', head || 'HEAD'];
}

function shortStat(files: GitFile[]): GitDiffShortStat {
	return files.reduce(
		(stat, file) => ({
			files: stat.files + 1,
			additions: stat.additions + (file.stats?.additions ?? 0),
			deletions: stat.deletions + (file.stats?.deletions ?? 0),
		}),
		{ files: 0, additions: 0, deletions: 0 },
	);
}

function toFileStatus(status: GitHubCommitFile['status']): GitFileIndexStatus {
	switch (status) {
		case 'added':
			return GitFileIndexStatus.Added;
		case 'removed':
			return GitFileIndexStatus.Deleted;
		case 'renamed':
			return GitFileIndexStatus.Renamed;
		case 'copied':
			return GitFileIndexStatus.Copied;
		default:
			return GitFileIndexStatus.Modified;
	}
}

function unsupported(operation: string): GitHubVirtualUnsupportedError {
	return new GitHubVirtualUnsupportedError(operation);
}

function rejectUnsupported<T>(operation: string): Promise<T> {
	return Promise.reject(unsupported(operation));
}

function unsupportedSubProvider<T extends object>(operation: string, methods?: object): T {
	const target = methods ?? Object.create(null);
	return new Proxy(target, {
		get: (value, property, receiver): unknown => {
			const method = Reflect.get(value, property, receiver) as unknown;
			return method ?? (() => rejectUnsupported(operation));
		},
	}) as T;
}

function groupBySha<T extends { sha?: string }>(values: T[]): Map<string, T[]> {
	const grouped = new Map<string, T[]>();
	for (const value of values) {
		if (value.sha == null) continue;

		const group = grouped.get(value.sha);
		if (group == null) {
			grouped.set(value.sha, [value]);
		} else {
			group.push(value);
		}
	}

	return grouped;
}

async function* unsupportedGraphSearch(
	search: GitGraphSearch['query'],
): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
	yield await Promise.reject(unsupported('graph search'));
	return {
		repoPath: '',
		query: search,
		queryFilters: { files: false, refs: false },
		comparisonKey: '',
		results: new Map(),
		hasMore: false,
	};
}

function isReference(value: string): boolean {
	return (
		/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
		!value.endsWith('.') &&
		!value.endsWith('/') &&
		!value.includes('..') &&
		!value.includes('//') &&
		!value.includes('/.')
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value != null;
}
