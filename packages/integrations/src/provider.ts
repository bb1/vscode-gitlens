import type {
	CreatePullRequestInput,
	HostingProviderId,
	HostingPullRequest,
	HostingRepositoryDescriptor,
	HostingResult,
} from './models.js';

export type HostingProvider = {
	id: HostingProviderId;
	getPullRequests(repository: HostingRepositoryDescriptor): Promise<HostingResult<readonly HostingPullRequest[]>>;
	createPullRequest(
		repository: HostingRepositoryDescriptor,
		input: CreatePullRequestInput,
	): Promise<HostingResult<HostingPullRequest>>;
};
