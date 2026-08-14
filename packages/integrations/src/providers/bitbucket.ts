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
	sendRequest,
	validateAccessToken,
	validatePullRequestInput,
	validateRepositoryDomain,
} from './shared.js';

const domain = 'bitbucket.org';
const apiUrl = 'https://api.bitbucket.org/2.0';
const providerName = 'Bitbucket';

export class BitbucketHostingProvider implements HostingProvider {
	readonly id = 'bitbucket' as const;

	private readonly accessToken: string;

	constructor(
		accessToken: string,
		private readonly request: HostingRequestTransport,
	) {
		this.accessToken = validateAccessToken(providerName, accessToken);
	}

	async getAccount(): Promise<HostingResult<HostingAccount>> {
		return this.withAuthentication(async () => {
			const response = await sendRequest(providerName, this.request, {
				method: 'GET',
				url: `${apiUrl}/user`,
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
				url: `${this.repositoryUrl(repository)}/pullrequests?state=OPEN&pagelen=100`,
				headers: this.headers(),
			});

			return getPullRequests(response.body);
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
				url: `${this.repositoryUrl(repository)}/pullrequests`,
				headers: { ...this.headers(), 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: value.title,
					source: { branch: { name: value.head } },
					destination: { branch: { name: value.base } },
					...(value.body == null ? {} : { description: value.body }),
				}),
			});

			return getPullRequest(response.body);
		});
	}

	private headers(): Readonly<Record<string, string>> {
		return { Accept: 'application/json', Authorization: `Bearer ${this.accessToken}` };
	}

	private repositoryUrl(repository: HostingRepositoryDescriptor): string {
		validateRepositoryDomain(providerName, domain, repository.domain);
		if (!isBitbucketName(repository.owner)) {
			throw new Error('Invalid Bitbucket workspace');
		}

		if (!isBitbucketName(repository.name)) {
			throw new Error('Invalid Bitbucket repository name');
		}

		return `${apiUrl}/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
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

function isBitbucketName(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,61}$/.test(value);
}

function getPullRequests(value: unknown): readonly HostingPullRequest[] {
	if (!isRecord(value) || !Array.isArray(value.values)) {
		throw new Error('Bitbucket response was invalid');
	}

	return value.values.map(getPullRequest);
}

function getPullRequest(value: unknown): HostingPullRequest {
	if (!isRecord(value) || !isRecord(value.links) || !isRecord(value.links.html)) {
		throw new Error('Bitbucket response was invalid');
	}

	const url = getSafeUrl(value.links.html.href);
	if (
		!isPositiveInteger(value.id) ||
		typeof value.title !== 'string' ||
		url == null ||
		(value.state !== 'OPEN' &&
			value.state !== 'DECLINED' &&
			value.state !== 'MERGED' &&
			value.state !== 'SUPERSEDED')
	) {
		throw new Error('Bitbucket response was invalid');
	}

	return {
		id: String(value.id),
		number: value.id,
		title: value.title,
		url: url,
		state: value.state === 'OPEN' ? 'open' : value.state === 'MERGED' ? 'merged' : 'closed',
	};
}

function getAccount(value: unknown): HostingAccount {
	if (!isRecord(value) || !isRecord(value.links) || !isRecord(value.links.avatar)) {
		throw new Error('Bitbucket response was invalid');
	}

	const avatarUrl = getSafeUrl(value.links.avatar.href);
	if (typeof value.uuid !== 'string' || value.uuid.length === 0 || typeof value.display_name !== 'string') {
		throw new Error('Bitbucket response was invalid');
	}

	return {
		id: value.uuid,
		label: value.display_name,
		...(avatarUrl == null ? {} : { avatarUrl: avatarUrl }),
	};
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
