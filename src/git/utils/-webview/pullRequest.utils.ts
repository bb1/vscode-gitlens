import { Uri, window } from 'vscode';
import type { PullRequest, PullRequestComparisonRefs } from '@gitlens/git/models/pullRequest.js';
import type { LeftRightCommitCountResult } from '@gitlens/git/providers/commits.js';
import {
	getComparisonRefsForPullRequest,
	getRepositoryIdentityForPullRequest,
} from '@gitlens/git/utils/pullRequest.utils.js';
import { gitSuffixRegex } from '@gitlens/git/utils/remote.utils.js';
import { createRevisionRange } from '@gitlens/git/utils/revision.utils.js';
import { Schemes } from '../../../constants.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../models/repository.js';

export async function ensurePullRequestRefs(
	pr: PullRequest,
	repo: GlRepository,
	options?: { silent?: true; promptMessage?: never } | { silent?: never; promptMessage?: string },
	refs?: PullRequestComparisonRefs,
): Promise<LeftRightCommitCountResult | undefined> {
	if (pr.refs == null) return undefined;

	refs ??= getComparisonRefsForPullRequest(repo.path, pr.refs);
	const range = createRevisionRange(refs.base.ref, refs.head.ref, '...');

	let counts = await repo.git.commits.getLeftRightCommitCount(range);
	if (counts == null) {
		if (await ensurePullRequestRemote(pr, repo, options)) {
			counts = await repo.git.commits.getLeftRightCommitCount(range);
		}
	}

	return counts;
}

export async function ensurePullRequestRemote(
	pr: PullRequest,
	repo: GlRepository,
	options?: { silent?: true; promptMessage?: never } | { silent?: never; promptMessage?: string },
): Promise<boolean> {
	const identity = getRepositoryIdentityForPullRequest(pr);
	if (identity.remote.url == null) return false;

	const prRemoteUrl = identity.remote.url.replace(gitSuffixRegex, '');

	let found = false;
	for (const remote of await repo.git.remotes.getRemotes()) {
		if (remote.matches(prRemoteUrl)) {
			found = true;
			break;
		}
	}

	if (found) return true;

	const confirm = { title: 'Add Remote' };
	const cancel = { title: 'Cancel', isCloseAffordance: true };
	if (!options?.silent) {
		const result = await window.showInformationMessage(
			`${
				options?.promptMessage ?? `Unable to find a remote for PR #${pr.id}.`
			}\nWould you like to add a remote for '${identity.provider.repoDomain}?`,
			{ modal: true },
			confirm,
			cancel,
		);

		if (result === confirm) {
			await repo.git.remotes.addRemoteWithResult?.(identity.provider.repoDomain, identity.remote.url, {
				fetch: true,
			});
			return true;
		}
	}

	return false;
}

export async function getOpenedPullRequestRepo(
	container: Container,
	pr: PullRequest,
	repoPath?: string,
): Promise<GlRepository | undefined> {
	if (repoPath) return container.git.getRepository(repoPath);

	const repo = await getOrOpenPullRequestRepository(container, pr, { promptIfNeeded: true });
	return repo;
}

export async function getOrOpenPullRequestRepository(
	container: Container,
	pr: PullRequest,
	options?: { promptIfNeeded?: boolean; skipVirtual?: boolean },
): Promise<GlRepository | undefined> {
	const identity = getRepositoryIdentityForPullRequest(pr);
	let repo = await getRepositoryForRemoteUrl(container, identity.remote.url);

	if (repo == null && !options?.skipVirtual) {
		const virtualUri = getVirtualUriForPullRequest(pr);
		if (virtualUri != null) {
			repo = await container.git.getOrAddRepository(virtualUri, { opened: false, detectNested: false });
		}
	}

	if (repo == null) {
		const baseIdentity = getRepositoryIdentityForPullRequest(pr, false);
		repo = await getRepositoryForRemoteUrl(container, baseIdentity.remote.url);
	}

	return repo;
}

async function getRepositoryForRemoteUrl(
	container: Container,
	remoteUrl: string | undefined,
): Promise<GlRepository | undefined> {
	if (remoteUrl == null) return undefined;

	for (const repo of container.git.repositories) {
		if ((await repo.git.remotes.getRemotes({ filter: remote => remote.matches(remoteUrl) })).length !== 0) {
			return repo;
		}
	}

	return undefined;
}

export function getVirtualUriForPullRequest(pr: PullRequest): Uri | undefined {
	if (pr.provider.id !== 'github') return undefined;

	const uri = Uri.parse(pr.refs?.base?.url ?? pr.url);
	return uri.with({ scheme: Schemes.Virtual, authority: 'github', path: uri.path });
}
