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

const defaultDomain = 'dev.azure.com';
const providerName = 'Azure DevOps';

export class AzureDevOpsHostingProvider implements HostingProvider {
	readonly id = 'azureDevOps' as const;

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
				url: `${this.baseUrl()}/_apis/connectionData?api-version=7.1`,
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
				url: `${this.repositoryUrl(repository)}/pullrequests?searchCriteria.status=active&%24top=100&api-version=7.1`,
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
			const value = validateCommit(commit);
			const response = await sendRequest(providerName, this.request, {
				method: 'POST',
				url: `${this.repositoryUrl(repository)}/pullrequestquery?api-version=7.1`,
				headers: { ...this.headers(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ queries: [{ items: [value], type: 'commit' }] }),
			});
			const id = getPullRequestId(response.body, value);
			if (id == null) return undefined;

			const pullRequest = await sendRequest(providerName, this.request, {
				method: 'GET',
				url: `${this.repositoryUrl(repository)}/pullrequests/${id}?api-version=7.1`,
				headers: this.headers(),
			});

			return getPullRequest(pullRequest.body);
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
				url: `${this.repositoryUrl(repository)}/pullrequests?api-version=7.1`,
				headers: { ...this.headers(), 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: value.title,
					sourceRefName: `refs/heads/${value.head}`,
					targetRefName: `refs/heads/${value.base}`,
					...(value.body == null ? {} : { description: value.body }),
				}),
			});

			return getPullRequest(response.body);
		});
	}

	private headers(): Readonly<Record<string, string>> {
		return { Accept: 'application/json', Authorization: `Basic ${base64(`:${this.accessToken}`)}` };
	}

	private baseUrl(): string {
		return `https://${this.domain}`;
	}

	private repositoryUrl(repository: HostingRepositoryDescriptor): string {
		validateRepositoryDomain(providerName, this.domain, repository.domain);
		if (!isAzurePathSegment(repository.owner)) {
			throw new Error('Invalid Azure DevOps organization');
		}

		if (!isAzurePathSegment(repository.project)) {
			throw new Error('Invalid Azure DevOps project');
		}

		if (!isAzurePathSegment(repository.name)) {
			throw new Error('Invalid Azure DevOps repository name');
		}

		return `${this.baseUrl()}/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.project)}/_apis/git/repositories/${encodeURIComponent(repository.name)}`;
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

function isAzurePathSegment(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= 255 &&
		!/[\\/?#]/.test(value) &&
		!hasControlCharacter(value)
	);
}

function validateCommit(value: string): string {
	if (!/^[0-9a-f]{7,64}$/i.test(value)) {
		throw new Error('Invalid Azure DevOps commit');
	}

	return value;
}

function getPullRequestId(value: unknown, commit: string): number | undefined {
	if (!isRecord(value) || !Array.isArray(value.results) || !isRecord(value.results[0])) return undefined;

	const pullRequests = value.results[0][commit];
	if (!Array.isArray(pullRequests) || !isRecord(pullRequests[0])) return undefined;

	const id = pullRequests[0].pullRequestId;
	return isPositiveInteger(id) ? id : undefined;
}

function getPullRequests(value: unknown): readonly HostingPullRequest[] {
	if (!isRecord(value) || !Array.isArray(value.value)) {
		throw new Error('Azure DevOps response was invalid');
	}

	return value.value.map(getPullRequest);
}

function getPullRequest(value: unknown): HostingPullRequest {
	if (!isRecord(value) || !isRecord(value._links) || !isRecord(value._links.web)) {
		throw new Error('Azure DevOps response was invalid');
	}

	const url = getSafeUrl(value._links.web.href);
	if (
		!isPositiveInteger(value.pullRequestId) ||
		typeof value.title !== 'string' ||
		url == null ||
		(value.status !== 'active' && value.status !== 'completed' && value.status !== 'abandoned')
	) {
		throw new Error('Azure DevOps response was invalid');
	}

	return {
		id: String(value.pullRequestId),
		number: value.pullRequestId,
		title: value.title,
		url: url,
		state: value.status === 'active' ? 'open' : value.status === 'completed' ? 'merged' : 'closed',
	};
}

function getAccount(value: unknown): HostingAccount {
	if (!isRecord(value) || !isRecord(value.authenticatedUser)) {
		throw new Error('Azure DevOps response was invalid');
	}

	const user = value.authenticatedUser;
	const avatarUrl = getSafeUrl(user.imageUrl);
	if (typeof user.id !== 'string' || user.id.length === 0 || typeof user.providerDisplayName !== 'string') {
		throw new Error('Azure DevOps response was invalid');
	}

	return {
		id: user.id,
		label: user.providerDisplayName,
		...(avatarUrl == null ? {} : { avatarUrl: avatarUrl }),
	};
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

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function base64(value: string): string {
	return globalThis.btoa(value);
}
