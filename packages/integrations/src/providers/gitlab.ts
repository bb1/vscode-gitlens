import type {
	CreatePullRequestInput,
	HostingAccount,
	HostingPullRequest,
	HostingRepositoryDescriptor,
	HostingResult,
} from '../models.js';
import type { HostingProvider } from '../provider.js';
import type { HostingRequestTransport } from './shared.js';
import {
	getSafeUrl,
	HostingRequestError,
	isRecord,
	normalizeHostname,
	sendRequest,
	validateAccessToken,
	validatePullRequestInput,
	validateRepositoryDomain,
} from './shared.js';

const defaultDomain = 'gitlab.com';
const providerName = 'GitLab';

export class GitLabHostingProvider implements HostingProvider {
	readonly id = 'gitlab' as const;

	private readonly accessToken: string;
	private readonly domain: string;

	constructor(
		accessToken: string,
		private readonly request: HostingRequestTransport,
		domain = defaultDomain,
	) {
		this.accessToken = validateAccessToken(providerName, accessToken);
		this.domain = normalizeHostname(providerName, domain);
	}

	async getAccount(): Promise<HostingResult<HostingAccount>> {
		return this.withAuthentication(async () => {
			const response = await sendRequest(providerName, this.request, {
				method: 'GET',
				url: `${this.apiUrl()}/user`,
				headers: this.headers(),
			});

			return getAccount(response.body);
		});
	}

	async getPullRequests(
		repository: HostingRepositoryDescriptor,
	): Promise<HostingResult<readonly HostingPullRequest[]>> {
		return this.withAuthentication(async () => {
			const response = await sendRequest(providerName, this.request, {
				method: 'GET',
				url: `${this.projectUrl(repository)}/merge_requests?state=opened&per_page=100`,
				headers: this.headers(),
			});

			return getPullRequests(response.body);
		});
	}

	async getPullRequestForCommit(
		repository: HostingRepositoryDescriptor,
		commit: string,
	): Promise<HostingResult<HostingPullRequest | undefined>> {
		return this.withAuthentication(async () => {
			const response = await sendRequest(providerName, this.request, {
				method: 'GET',
				url: `${this.projectUrl(repository)}/repository/commits/${encodeURIComponent(validateCommit(commit))}/merge_requests`,
				headers: this.headers(),
			});

			return getPullRequests(response.body)[0];
		});
	}

	async createPullRequest(
		repository: HostingRepositoryDescriptor,
		input: CreatePullRequestInput,
	): Promise<HostingResult<HostingPullRequest>> {
		return this.withAuthentication(async () => {
			const value = validatePullRequestInput(providerName, input);
			const response = await sendRequest(providerName, this.request, {
				method: 'POST',
				url: `${this.projectUrl(repository)}/merge_requests`,
				headers: { ...this.headers(), 'Content-Type': 'application/json' },
				body: JSON.stringify({
					target_branch: value.base,
					source_branch: value.head,
					title: value.title,
					...(value.body == null ? {} : { description: value.body }),
				}),
			});

			return getPullRequest(response.body);
		});
	}

	private headers(): Readonly<Record<string, string>> {
		return { Accept: 'application/json', 'PRIVATE-TOKEN': this.accessToken };
	}

	private apiUrl(): string {
		return `https://${this.domain}/api/v4`;
	}

	private projectUrl(repository: HostingRepositoryDescriptor): string {
		validateRepositoryDomain(providerName, this.domain, repository.domain);
		if (!isGitLabPath(repository.owner)) {
			throw new Error('Invalid GitLab repository owner');
		}

		if (!isGitLabPathSegment(repository.name)) {
			throw new Error('Invalid GitLab repository name');
		}

		return `${this.apiUrl()}/projects/${encodeURIComponent(`${repository.owner}/${repository.name}`)}`;
	}

	private async withAuthentication<T>(operation: () => Promise<T>): Promise<HostingResult<T>> {
		try {
			return await operation();
		} catch (ex) {
			if (HostingRequestError.is(ex) && (ex.status === 401 || ex.status === 403)) {
				return { authenticationRequired: true };
			}

			throw ex;
		}
	}
}

function isGitLabPath(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 255) return false;

	return value.split('/').every(isGitLabPathSegment);
}

function isGitLabPathSegment(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(value) && value !== '.' && value !== '..';
}

function validateCommit(value: string): string {
	if (!/^[0-9a-f]{7,64}$/i.test(value)) {
		throw new Error('Invalid GitLab commit');
	}

	return value;
}

function getPullRequests(value: unknown): readonly HostingPullRequest[] {
	if (!Array.isArray(value)) {
		throw new Error('GitLab response was invalid');
	}

	return value.map(getPullRequest);
}

function getPullRequest(value: unknown): HostingPullRequest {
	if (!isRecord(value)) {
		throw new Error('GitLab response was invalid');
	}

	const id = getId(value.id);
	const url = getSafeUrl(value.web_url);
	if (
		id == null ||
		!isPositiveInteger(value.iid) ||
		typeof value.title !== 'string' ||
		url == null ||
		(value.state !== 'opened' && value.state !== 'closed' && value.state !== 'merged' && value.state !== 'locked')
	) {
		throw new Error('GitLab response was invalid');
	}

	return {
		id: id,
		number: value.iid,
		title: value.title,
		url: url,
		state: value.state === 'opened' ? 'open' : value.state === 'merged' ? 'merged' : 'closed',
	};
}

function getAccount(value: unknown): HostingAccount {
	if (!isRecord(value)) {
		throw new Error('GitLab response was invalid');
	}

	const id = getId(value.id);
	const label = typeof value.name === 'string' && value.name.length > 0 ? value.name : value.username;
	if (id == null || typeof label !== 'string' || label.length === 0) {
		throw new Error('GitLab response was invalid');
	}

	const avatarUrl = getSafeUrl(value.avatar_url);
	return { id: id, label: label, ...(avatarUrl == null ? {} : { avatarUrl: avatarUrl }) };
}

function getId(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0
		? value
		: typeof value === 'number' && Number.isSafeInteger(value)
			? String(value)
			: undefined;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
