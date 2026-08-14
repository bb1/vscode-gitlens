import { GitHubHostingProvider } from '@gitlens/hosting-github/githubHostingProvider.js';
import { AzureDevOpsHostingProvider } from '@gitlens/hosting-integrations/providers/azureDevOps.js';
import { BitbucketHostingProvider } from '@gitlens/hosting-integrations/providers/bitbucket.js';
import { GitLabHostingProvider } from '@gitlens/hosting-integrations/providers/gitlab.js';
import type { HostingRequest, HostingRequestTransport } from '@gitlens/hosting-integrations/providers/shared.js';
import type { HostingIntegrationService } from './hostingIntegrationService.js';

export function createHostingRequestTransport(
	fetch: (url: string, init: RequestInit) => Promise<Response>,
): HostingRequestTransport {
	return async ({ method, url, headers, body }: HostingRequest) => {
		const response = await fetch(url, { method: method, headers: headers, body: body });
		const payload: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
		return { status: response.status, body: payload };
	};
}

export function registerHostingProviders(service: HostingIntegrationService, request: HostingRequestTransport): void {
	service.register({
		id: 'github',
		domain: 'github.com',
		scopes: ['repo'],
		create: (session, domain) => new GitHubHostingProvider(session.accessToken, request, domain),
	});
	service.register({
		id: 'gitlab',
		domain: 'gitlab.com',
		scopes: ['api'],
		create: (session, domain) => new GitLabHostingProvider(session.accessToken, request, domain),
	});
	service.register({
		id: 'bitbucket',
		domain: 'bitbucket.org',
		scopes: ['repository'],
		create: session => new BitbucketHostingProvider(session.accessToken, request),
	});
	service.register({
		id: 'azureDevOps',
		domain: 'dev.azure.com',
		scopes: ['vso.code'],
		create: (session, domain) => new AzureDevOpsHostingProvider(session.accessToken, request, domain),
	});
}
