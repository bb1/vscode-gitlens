export type HostingProviderId = 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps';

export type HostingSession = {
	provider: HostingProviderId;
	accessToken: string;
	accountLabel: string;
};

export type HostingAuthenticationMode = { silent: true } | { interactive: true };

export type HostingAuthenticationService = {
	getSession(
		provider: HostingProviderId,
		scopes: readonly string[],
		mode: HostingAuthenticationMode,
	): Promise<HostingSession | undefined>;
};
