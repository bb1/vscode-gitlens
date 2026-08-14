import type { Uri } from 'vscode';
import { extensions } from 'vscode';
import { decodeRemoteHubAuthority } from '@gitlens/git/utils/uriAuthority.js';

export type GitHubAuthorityMetadata = {
	v: 1;
	ref?: { type: number; id: string };
};

export type GitHubRemoteHubMetadata = {
	provider: { id: string; domain?: string };
	repo: { owner: string; name: string; domain?: string };
	getRevision(): Promise<{ name: string; revision: string }>;
};

export type GitHubRemoteHub = {
	getMetadata(uri: Uri): Promise<GitHubRemoteHubMetadata | undefined>;
	getVirtualWorkspaceUri(uri: Uri): Uri | undefined;
};

export type GitHubVirtualRepository = {
	domain: string;
	owner: string;
	name: string;
	revision: string;
	revisionName: string;
};

export class GitHubVirtualRepositoryError extends Error {
	static is(error: unknown): error is GitHubVirtualRepositoryError {
		return (
			error instanceof GitHubVirtualRepositoryError ||
			(isRecord(error) && error.kind === 'gitlens.github-virtual-repository-error')
		);
	}

	constructor() {
		super('Invalid GitHub virtual repository metadata');
		Object.defineProperty(this, 'kind', { value: 'gitlens.github-virtual-repository-error' });
	}
}

export async function getGitHubRemoteHub(): Promise<GitHubRemoteHub> {
	const extension =
		extensions.getExtension<GitHubRemoteHub>('ms-vscode.remote-repositories') ??
		extensions.getExtension<GitHubRemoteHub>('GitHub.remotehub');
	if (extension == null) {
		throw new GitHubVirtualRepositoryError();
	}

	return extension.isActive ? extension.exports : await extension.activate();
}

export async function getGitHubVirtualRepository(
	remoteHub: GitHubRemoteHub,
	uri: Uri,
): Promise<GitHubVirtualRepository> {
	const authority = decodeRemoteHubAuthority<GitHubAuthorityMetadata>(uri.authority);
	if (
		authority.scheme !== 'github' ||
		(uri.authority.includes('+') && authority.metadata?.v !== 1) ||
		(authority.metadata != null && authority.metadata.v !== 1)
	) {
		throw new GitHubVirtualRepositoryError();
	}

	const metadata = await remoteHub.getMetadata(uri);
	if (metadata?.provider.id !== 'github') {
		throw new GitHubVirtualRepositoryError();
	}

	const domain = metadata.provider.domain ?? metadata.repo.domain ?? 'github.com';
	if (
		metadata.provider.domain != null &&
		metadata.repo.domain != null &&
		metadata.provider.domain.toLowerCase() !== metadata.repo.domain.toLowerCase()
	) {
		throw new GitHubVirtualRepositoryError();
	}

	if (!isDomain(domain) || !isOwner(metadata.repo.owner) || !isRepositoryName(metadata.repo.name)) {
		throw new GitHubVirtualRepositoryError();
	}

	const revision = await metadata.getRevision();
	if (!isReference(revision.name) || !isObjectId(revision.revision)) {
		throw new GitHubVirtualRepositoryError();
	}

	return {
		domain: domain.toLowerCase(),
		owner: metadata.repo.owner,
		name: metadata.repo.name,
		revision: revision.revision,
		revisionName: revision.name,
	};
}

function isDomain(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value === value.trim() &&
		/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(value)
	);
}

function isOwner(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value) && !value.endsWith('-');
}

function isRepositoryName(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) && !value.endsWith('.');
}

function isReference(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
		!value.endsWith('.') &&
		!value.endsWith('.lock') &&
		!value.endsWith('/') &&
		!value.includes('..') &&
		!value.includes('//') &&
		!value.includes('/.')
	);
}

function isObjectId(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value != null;
}
