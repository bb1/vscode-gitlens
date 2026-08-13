export type HostingProviderId = 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps';

export type HostingRepositoryDescriptor = {
	owner: string;
	name: string;
	domain: string;
};

export type HostingPullRequest = {
	id: string;
	number: number;
	title: string;
	url: string;
	state: 'open' | 'closed' | 'merged';
};

export type CreatePullRequestInput = {
	base: string;
	head: string;
	title: string;
	body?: string;
};

export type HostingAuthenticationRequired = { authenticationRequired: true };

export type HostingResult<T> = T | HostingAuthenticationRequired;
