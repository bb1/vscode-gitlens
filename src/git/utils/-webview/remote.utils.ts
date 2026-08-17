import type { Uri } from 'vscode';
import { env } from 'vscode';
import type { URI } from 'vscode-uri';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { ParsedRemoteFileUri, RemoteProvider, RemoteProviderId } from '@gitlens/git/models/remoteProvider.js';
import type { CreatePullRequestRemoteResource, RemoteResource } from '@gitlens/git/models/remoteResource.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { ensureArray } from '@gitlens/utils/array.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { Container } from '../../../container.js';
import { openUrl } from '../../../system/-webview/vscode/uris.js';
import type { GlRepository } from '../../models/repository.js';

export function getHostingProviderDescriptor(provider: RemoteProvider):
	| {
			id: 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps';
			repository: { domain: string; owner: string; name: string; project?: string };
	  }
	| undefined {
	const owner = provider.owner;
	const name = provider.repoName;
	if (owner == null || name == null) return undefined;

	switch (provider.id) {
		case 'github':
			return { id: 'github', repository: { domain: provider.domain, owner: owner, name: name } };
		case 'gitlab':
			return { id: 'gitlab', repository: { domain: provider.domain, owner: owner, name: name } };
		case 'bitbucket':
			return { id: 'bitbucket', repository: { domain: provider.domain, owner: owner, name: name } };
		case 'azure-devops': {
			const segments = provider.path.split('/');
			const project = segments.at(-3);
			const repositoryName = segments.at(-1);
			if (project == null || project === '_git' || repositoryName == null) return undefined;

			return {
				id: 'azureDevOps',
				repository: { domain: provider.domain, owner: owner, project: project, name: repositoryName },
			};
		}
		default:
			return undefined;
	}
}

export interface LocalInfoFromRemoteUriResult {
	uri: Uri;

	repoPath: string;
	rev: string | undefined;

	startLine?: number;
	endLine?: number;
}

/** Whether this remote can use a direct hosting provider. */
export function remoteSupportsIntegration(remote: GitRemote): remote is GitRemote<RemoteProvider> {
	return remote.provider != null && getHostingProviderDescriptor(remote.provider) != null;
}

/** Sets this remote as the default for the repository. Replaces `GitRemote.setAsDefault()`. */
export async function setRemoteAsDefault(remote: GitRemote, value: boolean = true): Promise<void> {
	await Container.instance.git.getRepositoryService(remote.repoPath).remotes.setRemoteAsDefault(remote.name, value);
}

/**
 * Finds the best remote that has a supported direct hosting provider.
 */
export async function getBestRemoteWithIntegration(
	repoPath: string,
	options?: {
		filter?: (remote: GitRemote<RemoteProvider>) => boolean;
	},
	cancellation?: AbortSignal,
): Promise<GitRemote<RemoteProvider> | undefined> {
	const remotes = await Container.instance.git
		.getRepositoryService(repoPath)
		.remotes.getBestRemotesWithProviders(cancellation);

	for (const r of remotes) {
		if (!remoteSupportsIntegration(r)) continue;
		if (options?.filter?.(r) === false) continue;

		return r;
	}

	return undefined;
}

export function getRemoteProviderUrl(
	provider: RemoteProvider,
	resource: RemoteResource,
): Promise<string | undefined> | string | undefined {
	return provider.url(resource);
}

export async function copyRemoteProviderUrl(
	provider: RemoteProvider,
	resource: RemoteResource | RemoteResource[],
): Promise<void> {
	const urls = await getUrlsFromResources(provider, resource);
	if (!urls.length) return;

	await env.clipboard.writeText(urls.join('\n'));
}

export async function openRemoteProviderUrl(
	provider: RemoteProvider,
	resource: RemoteResource | RemoteResource[],
): Promise<boolean | undefined> {
	const urls = await getUrlsFromResources(provider, resource);
	if (!urls.length) return false;

	const results = await Promise.allSettled(urls.map(openUrl));
	return results.every(r => getSettledValue(r) === true);
}

async function getUrlsFromResources(
	provider: RemoteProvider,
	resource: RemoteResource | RemoteResource[],
): Promise<string[]> {
	const urlPromises: Promise<string | undefined>[] = [];

	for (const r of ensureArray(resource)) {
		urlPromises.push(Promise.resolve(provider.url(r)));
	}

	const urls: string[] = (await Promise.allSettled(urlPromises)).map(r => getSettledValue(r)).filter(r => r != null);
	return urls;
}

/**
 * Shared resolver that uses a provider's `parseRemoteFileUri()` to parse the URL,
 * then resolves candidates against the local repository.
 * Replaces 8 near-identical `getLocalInfoFromRemoteUri()` implementations in extension providers.
 */
export async function resolveLocalInfoFromRemoteUri(
	provider: { parseRemoteFileUri?(uri: URI): ParsedRemoteFileUri | undefined },
	repo: GlRepository,
	uri: Uri,
): Promise<LocalInfoFromRemoteUriResult | undefined> {
	const parsed = provider.parseRemoteFileUri?.(uri);
	if (parsed == null) return undefined;

	let fallback: LocalInfoFromRemoteUriResult | undefined;

	for (const candidate of parsed.candidates) {
		switch (candidate.type) {
			case 'sha': {
				const resolved = await repo.git.getAbsoluteOrBestRevisionUri(candidate.filePath, candidate.rev);
				if (resolved != null) {
					return {
						uri: resolved,
						repoPath: repo.path,
						rev: candidate.rev,
						startLine: parsed.startLine,
						endLine: parsed.endLine,
					};
				}
				break;
			}
			case 'shortSha': {
				const resolved = await repo.git.getAbsoluteOrBestRevisionUri(candidate.filePath, candidate.rev);
				if (resolved != null) {
					fallback = {
						uri: resolved,
						repoPath: repo.path,
						rev: candidate.rev,
						startLine: parsed.startLine,
						endLine: parsed.endLine,
					};
				}
				break;
			}
			case 'branches': {
				const { values: branches } = await repo.git.branches.getBranches({
					filter: b => b.remote && candidate.possibleBranches.has(b.nameWithoutRemote),
				});
				for (const branch of branches) {
					const filePath = candidate.possibleBranches.get(branch.nameWithoutRemote);
					if (filePath == null) continue;

					const resolved = await repo.git.getAbsoluteOrBestRevisionUri(filePath, branch.nameWithoutRemote);
					if (resolved != null) {
						return {
							uri: resolved,
							repoPath: repo.path,
							rev: branch.nameWithoutRemote,
							startLine: parsed.startLine,
							endLine: parsed.endLine,
						};
					}
				}
				break;
			}
			case 'tags': {
				const { values: tags } = await repo.git.tags.getTags({
					filter: t => candidate.possibleTags.has(t.name),
				});
				for (const tag of tags) {
					const filePath = candidate.possibleTags.get(tag.name);
					if (filePath == null) continue;

					const resolved = await repo.git.getAbsoluteOrBestRevisionUri(filePath, tag.name);
					if (resolved != null) {
						return {
							uri: resolved,
							repoPath: repo.path,
							rev: tag.name,
							startLine: parsed.startLine,
							endLine: parsed.endLine,
						};
					}
				}
				break;
			}
			case 'pathOnly': {
				const resolved = await repo.git.getAbsoluteOrBestRevisionUri(candidate.filePath, undefined);
				if (resolved != null) {
					return {
						uri: resolved,
						repoPath: repo.path,
						rev: undefined,
						startLine: parsed.startLine,
						endLine: parsed.endLine,
					};
				}
				break;
			}
		}
	}

	return fallback;
}

/**
 * Checks whether the integration for the given remote provider is connected,
 * which is required for constructing cross-fork pull request URLs.
 * Consolidates identical implementations from Azure DevOps, GitLab, and Bitbucket Server.
 */
export async function isRemoteProviderReadyForCrossForkPullRequestUrls(providerId: RemoteProviderId): Promise<boolean> {
	return (
		providerId === 'github' ||
		providerId === 'gitlab' ||
		providerId === 'bitbucket' ||
		providerId === 'azure-devops'
	);
}

/**
 * Sorts remotes by local remote-name priority.
 */
export async function sortRemotes(
	container: Container,
	remotes: GitRemote<RemoteProvider>[],
	cancellation?: AbortSignal,
): Promise<GitRemote<RemoteProvider>[]> {
	const defaultRemote = remotes.find(r => r.default)?.name;
	const currentBranchRemote = (await container.git.getRepository(remotes[0].repoPath)?.git.branches.getBranch())
		?.remoteName;

	const weighted: [number, GitRemote<RemoteProvider>][] = [];
	for (const remote of remotes) {
		let weight;
		switch (remote.name) {
			case defaultRemote:
				weight = 1000;
				break;
			case currentBranchRemote:
				weight = 6;
				break;
			case 'upstream':
				weight = 5;
				break;
			case 'origin':
				weight = 4;
				break;
			default:
				weight = 0;
		}

		weighted.push([weight, remote]);
	}

	weighted.sort(([aw, ar], [bw, br]) => (bw === 0 && aw === 0 ? ar.name.localeCompare(br.name) : bw - aw));
	return weighted.map(wr => wr[1]);
}
