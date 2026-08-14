export type HostingProviderId = 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps';

export type HostingSession = {
	provider: HostingProviderId;
	accessToken: string;
	accountLabel: string;
};

export type HostingAuthenticationMode = { silent: true } | { interactive: true };

export type HostingAuthenticationService = {
	deleteSession(provider: HostingProviderId, domain: string): Promise<void>;
	getSession(
		provider: HostingProviderId,
		domain: string,
		scopes: readonly string[],
		mode: HostingAuthenticationMode,
	): Promise<HostingSession | undefined>;
};
