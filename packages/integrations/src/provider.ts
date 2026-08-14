import type {
	CreatePullRequestInput,
	HostingAccount,
	HostingProviderId,
	HostingPullRequest,
	HostingRepositoryDescriptor,
	HostingResult,
} from './models.js';

export type HostingProvider = {
	id: HostingProviderId;
	getAccount?(): Promise<HostingResult<HostingAccount>>;
	getPullRequestForCommit?(
		repository: HostingRepositoryDescriptor,
		commit: string,
	): Promise<HostingResult<HostingPullRequest | undefined>>;
	getPullRequests(repository: HostingRepositoryDescriptor): Promise<HostingResult<readonly HostingPullRequest[]>>;
	createPullRequest(
		repository: HostingRepositoryDescriptor,
		input: CreatePullRequestInput,
	): Promise<HostingResult<HostingPullRequest>>;
};
