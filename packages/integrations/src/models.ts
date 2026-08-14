export type HostingProviderId = 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps';

export type HostingRepositoryDescriptor = {
	owner: string;
	/** Azure DevOps project; unused by the other hosts. */
	project?: string;
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

export type HostingAccount = {
	id: string;
	label: string;
	avatarUrl?: string;
};

export type HostingAuthenticationRequired = { authenticationRequired: true };

export type HostingResult<T> = T | HostingAuthenticationRequired;
