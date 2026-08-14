import type { HostingRepositoryDescriptor } from '@gitlens/hosting-integrations/models.js';

export type GitHubRequest = {
	method: 'GET' | 'POST';
	url: string;
	headers: Readonly<Record<string, string>>;
	body?: string;
};

export type GitHubResponse = {
	status: number;
	body: unknown;
};

export type GitHubRequestTransport = (request: GitHubRequest) => Promise<GitHubResponse>;

export type GitHubRepositoryReference = HostingRepositoryDescriptor;

export type GitHubRepository = {
	id: string;
	owner: string;
	name: string;
	url: string;
	defaultBranch: string;
	isPrivate: boolean;
};

export type GitHubPullRequest = {
	id: string;
	number: number;
	title: string;
	url: string;
	state: 'open' | 'closed' | 'merged';
};

export type CreateGitHubPullRequestInput = {
	base: string;
	head: string;
	title: string;
	body?: string;
};

const apiUrl = 'https://api.github.com';
const apiVersion = '2022-11-28';
const githubRequestErrorKind = 'gitlens.github-request-error';

export class GitHubRequestError extends Error {
	static is(error: unknown): error is GitHubRequestError {
		return (
			error instanceof GitHubRequestError ||
			(isRecord(error) &&
				error.kind === githubRequestErrorKind &&
				typeof error.status === 'number' &&
				Number.isFinite(error.status))
		);
	}

	constructor(readonly status: number) {
		super('GitHub request failed');
		Object.defineProperty(this, 'kind', { value: githubRequestErrorKind });
	}
}

export class GitHubClient {
	constructor(
		private readonly accessToken: string,
		private readonly request: GitHubRequestTransport,
	) {
		if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
			throw new Error('Invalid GitHub access token');
		}
	}

	async getRepository(repository: GitHubRepositoryReference): Promise<GitHubRepository> {
		const response = await this.send({
			method: 'GET',
			url: this.repositoryUrl(repository),
			headers: this.headers(),
		});

		return getRepository(response.body);
	}

	async getPullRequests(repository: GitHubRepositoryReference, perPage = 100): Promise<readonly GitHubPullRequest[]> {
		if (!Number.isSafeInteger(perPage) || perPage < 1) {
			throw new Error('Invalid GitHub pull request page size');
		}

		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/pulls?state=open&per_page=${Math.min(perPage, 100)}`,
			headers: this.headers(),
		});

		return getPullRequests(response.body);
	}

	async createPullRequest(
		repository: GitHubRepositoryReference,
		input: CreateGitHubPullRequestInput,
	): Promise<GitHubPullRequest> {
		const body = validatePullRequestInput(input);
		const response = await this.send({
			method: 'POST',
			url: `${this.repositoryUrl(repository)}/pulls`,
			headers: { ...this.headers(), 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		return getPullRequest(response.body);
	}

	private headers(): Readonly<Record<string, string>> {
		return {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${this.accessToken}`,
			'X-GitHub-Api-Version': apiVersion,
		};
	}

	private repositoryUrl(repository: GitHubRepositoryReference): string {
		validateRepository(repository);

		return `${getApiUrl(repository.domain)}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
	}

	private async send(request: GitHubRequest): Promise<GitHubResponse> {
		const response = await this.request(request).then(
			response => response,
			() => undefined,
		);
		if (response == null) {
			throw new Error('GitHub request failed', { cause: new Error('GitHub transport failed') });
		}

		if (response.status < 200 || response.status >= 300) {
			throw new GitHubRequestError(response.status);
		}

		return response;
	}
}

function getApiUrl(domain: string): string {
	const normalizedDomain = normalizeDomain(domain);
	return normalizedDomain === 'github.com' ? apiUrl : `https://${normalizedDomain}/api/v3`;
}

function normalizeDomain(domain: string): string {
	if (typeof domain !== 'string' || domain !== domain.trim()) {
		throw new Error('Invalid GitHub domain');
	}

	const normalizedDomain = domain.toLowerCase();
	if (
		!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
			normalizedDomain,
		)
	) {
		throw new Error('Invalid GitHub domain');
	}

	try {
		if (new URL(`https://${domain}`).hostname !== normalizedDomain) {
			throw new Error('Invalid GitHub domain');
		}
	} catch {
		throw new Error('Invalid GitHub domain');
	}

	return normalizedDomain;
}

function validateRepository(repository: GitHubRepositoryReference): void {
	if (!isGitHubOwner(repository.owner)) {
		throw new Error('Invalid GitHub repository owner');
	}

	if (!isGitHubRepositoryName(repository.name)) {
		throw new Error('Invalid GitHub repository name');
	}
}

function validatePullRequestInput(input: CreateGitHubPullRequestInput): CreateGitHubPullRequestInput {
	if (!isGitReference(input.base)) {
		throw new Error('Invalid GitHub base branch');
	}

	if (!isGitHubHead(input.head)) {
		throw new Error('Invalid GitHub head branch');
	}

	if (input.title.length === 0 || hasControlCharacter(input.title)) {
		throw new Error('Invalid GitHub pull request title');
	}

	if (input.body?.includes('\0') === true) {
		throw new Error('Invalid GitHub pull request body');
	}

	return input;
}

function isGitHubOwner(value: string): boolean {
	return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value) && !value.endsWith('-');
}

function isGitHubRepositoryName(value: string): boolean {
	return /^[A-Za-z0-9_.-]{1,100}$/.test(value) && !value.endsWith('.');
}

function isGitHubHead(value: string): boolean {
	const separator = value.indexOf(':');
	if (separator < 0) {
		return isGitReference(value);
	}

	return (
		separator === value.lastIndexOf(':') &&
		isGitHubOwner(value.slice(0, separator)) &&
		isGitReference(value.slice(separator + 1))
	);
}

function isGitReference(value: string): boolean {
	return (
		/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
		!value.endsWith('.') &&
		!value.endsWith('/') &&
		!value.includes('..') &&
		!value.includes('//') &&
		!value.includes('/.')
	);
}

function hasControlCharacter(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) {
			return true;
		}
	}

	return false;
}

function getRepository(value: unknown): GitHubRepository {
	if (!isRecord(value) || !isRecord(value.owner)) {
		throw new Error('GitHub response was invalid');
	}

	if (
		typeof value.id !== 'number' ||
		typeof value.owner.login !== 'string' ||
		typeof value.name !== 'string' ||
		typeof value.html_url !== 'string' ||
		typeof value.default_branch !== 'string' ||
		typeof value.private !== 'boolean'
	) {
		throw new Error('GitHub response was invalid');
	}

	return {
		id: String(value.id),
		owner: value.owner.login,
		name: value.name,
		url: value.html_url,
		defaultBranch: value.default_branch,
		isPrivate: value.private,
	};
}

function getPullRequests(value: unknown): readonly GitHubPullRequest[] {
	if (!Array.isArray(value)) {
		throw new Error('GitHub response was invalid');
	}

	return value.map(getPullRequest);
}

function getPullRequest(value: unknown): GitHubPullRequest {
	if (!isRecord(value)) {
		throw new Error('GitHub response was invalid');
	}

	if (
		typeof value.id !== 'number' ||
		typeof value.number !== 'number' ||
		typeof value.title !== 'string' ||
		typeof value.html_url !== 'string' ||
		(value.state !== 'open' && value.state !== 'closed') ||
		(value.merged_at != null && typeof value.merged_at !== 'string')
	) {
		throw new Error('GitHub response was invalid');
	}

	return {
		id: String(value.id),
		number: value.number,
		title: value.title,
		url: value.html_url,
		state: value.merged_at == null ? value.state : 'merged',
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value != null;
}
