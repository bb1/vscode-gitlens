import * as assert from 'node:assert/strict';
import { HostingIntegrationService } from '../hostingIntegrationService.js';
import { registerHostingProviders } from '../registerHostingProviders.js';

suite('registerHostingProviders', () => {
	test('registers each direct provider with the injected request transport', async () => {
		const requests: string[] = [];
		const service = new HostingIntegrationService({
			deleteSession: async () => {},
			getSession: async provider => ({ provider: provider, accessToken: 'token', accountLabel: provider }),
		});
		registerHostingProviders(service, async request => {
			requests.push(request.url);
			return {
				status: 200,
				body: request.url.startsWith('https://api.bitbucket.org/')
					? { values: [] }
					: request.url.startsWith('https://dev.azure.com/')
						? { value: [] }
						: [],
			};
		});

		const github = service.get('github', 'github.com');
		const gitlab = service.get('gitlab', 'gitlab.com');
		const bitbucket = service.get('bitbucket', 'bitbucket.org');
		const azure = service.get('azureDevOps', 'dev.azure.com');
		assert.ok(github && gitlab && bitbucket && azure);

		await Promise.all([
			github.getPullRequests({ domain: 'github.com', owner: 'octocat', name: 'gitlens' }),
			gitlab.getPullRequests({ domain: 'gitlab.com', owner: 'octocat', name: 'gitlens' }),
			bitbucket.getPullRequests({ domain: 'bitbucket.org', owner: 'octocat', name: 'gitlens' }),
			azure.getPullRequests({ domain: 'dev.azure.com', owner: 'octocat', project: 'gitlens', name: 'gitlens' }),
		]);

		assert.deepStrictEqual(requests, [
			'https://api.github.com/repos/octocat/gitlens/pulls?state=open&per_page=100',
			'https://gitlab.com/api/v4/projects/octocat%2Fgitlens/merge_requests?state=opened&per_page=100',
			'https://api.bitbucket.org/2.0/repositories/octocat/gitlens/pullrequests?state=OPEN&pagelen=100',
			'https://dev.azure.com/octocat/gitlens/_apis/git/repositories/gitlens/pullrequests?searchCriteria.status=active&%24top=100&api-version=7.1',
		]);
	});

	test('registers provider hosting without a product account', () => {
		const service = new HostingIntegrationService({
			deleteSession: async () => {},
			getSession: async () => undefined,
		});

		registerHostingProviders(service, async () => ({ status: 200, body: [] }));

		assert.ok(service.get('github', 'github.com'));
	});
});
