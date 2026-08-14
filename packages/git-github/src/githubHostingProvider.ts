import type {
	CreatePullRequestInput,
	HostingPullRequest,
	HostingRepositoryDescriptor,
	HostingResult,
} from '@gitlens/hosting-integrations/models.js';
import type { HostingProvider } from '@gitlens/hosting-integrations/provider.js';
import type { GitHubRequestTransport } from './githubClient.js';
import { GitHubClient, GitHubRequestError } from './githubClient.js';

export class GitHubHostingProvider implements HostingProvider {
	readonly id = 'github' as const;

	private readonly client: GitHubClient;

	constructor(accessToken: string, request: GitHubRequestTransport) {
		this.client = new GitHubClient(accessToken, request);
	}

	async getPullRequests(
		repository: HostingRepositoryDescriptor,
	): Promise<HostingResult<readonly HostingPullRequest[]>> {
		try {
			return await this.client.getPullRequests(repository);
		} catch (ex) {
			if (GitHubRequestError.is(ex) && ex.status === 401) {
				return { authenticationRequired: true };
			}

			throw ex;
		}
	}

	async createPullRequest(
		repository: HostingRepositoryDescriptor,
		input: CreatePullRequestInput,
	): Promise<HostingResult<HostingPullRequest>> {
		try {
			return await this.client.createPullRequest(repository, input);
		} catch (ex) {
			if (GitHubRequestError.is(ex) && ex.status === 401) {
				return { authenticationRequired: true };
			}

			throw ex;
		}
	}
}
