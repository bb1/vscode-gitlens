export type GitHubBranch = {
	name: string;
	sha: string;
	isProtected: boolean;
};

export type GitHubCommitSignature = {
	name: string;
	email: string;
	date: string;
};

export type GitHubCommitFileStatus = 'added' | 'changed' | 'copied' | 'modified' | 'removed' | 'renamed' | 'unchanged';

export type GitHubCommitFile = {
	path: string;
	previousPath?: string;
	status: GitHubCommitFileStatus;
	additions: number;
	deletions: number;
	changes: number;
	patch?: string;
};

export type GitHubCommit = {
	sha: string;
	url: string;
	message: string;
	author: GitHubCommitSignature;
	committer: GitHubCommitSignature;
	parents: readonly string[];
	additions?: number;
	deletions?: number;
	changes?: number;
	files?: readonly GitHubCommitFile[];
};

export type GitHubComparison = {
	status: 'ahead' | 'behind' | 'diverged' | 'identical';
	aheadBy: number;
	behindBy: number;
	totalCommits: number;
	mergeBaseSha?: string;
	commits: readonly GitHubCommit[];
	files: readonly GitHubCommitFile[];
};

export type GitHubRef = {
	name: string;
	sha: string;
	type: 'blob' | 'commit' | 'tag' | 'tree';
};

export type GitHubTag = {
	name: string;
	sha: string;
};

export type GitHubTreeEntry = {
	path: string;
	mode: string;
	type: 'blob' | 'commit' | 'tree';
	sha: string;
	size?: number;
};

export type GitHubTree = {
	sha: string;
	entries: readonly GitHubTreeEntry[];
};

export type GitHubBlob = {
	sha: string;
	bytes: Uint8Array;
};

export type GitHubContent = {
	path: string;
	sha: string;
	bytes: Uint8Array;
};

export type GitHubContributor = {
	login?: string;
	avatarUrl?: string;
	url?: string;
	contributions: number;
};

export type GitHubListOptions = {
	limit?: number;
};

export type GitHubListCommitsOptions = GitHubListOptions & {
	ref?: string;
	path?: string;
};

export type GitHubContentOptions = {
	ref?: string;
};
