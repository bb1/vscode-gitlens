import { strict as assert } from 'node:assert';
import { AzureDevOpsHostingProvider } from '../azureDevOps.js';
import { BitbucketHostingProvider } from '../bitbucket.js';
import { GitLabHostingProvider } from '../gitlab.js';
import type { HostingRequest, HostingRequestTransport, HostingResponse } from '../shared.js';

suite('hosting provider access tokens', () => {
	test('trims surrounding whitespace before sending authentication headers', async () => {
		const cases: readonly {
			name: string;
			create: (request: HostingRequestTransport) => {
				getAccount(): Promise<unknown>;
			};
			response: HostingResponse;
			expectedHeaders: Readonly<Record<string, string>>;
		}[] = [
			{
				name: 'GitLab',
				create: request => new GitLabHostingProvider(' \tgitlab-token\n ', request),
				response: { status: 200, body: { id: 1, username: 'octocat' } },
				expectedHeaders: { Accept: 'application/json', 'PRIVATE-TOKEN': 'gitlab-token' },
			},
			{
				name: 'Bitbucket',
				create: request => new BitbucketHostingProvider(' \tbitbucket-token\n ', request),
				response: {
					status: 200,
					body: {
						uuid: '{1}',
						display_name: 'The Octocat',
						links: { avatar: { href: 'https://bitbucket.org/account/octocat/avatar/32/' } },
					},
				},
				expectedHeaders: { Accept: 'application/json', Authorization: 'Bearer bitbucket-token' },
			},
			{
				name: 'Azure DevOps',
				create: request => new AzureDevOpsHostingProvider(' \tazure-token\n ', request),
				response: {
					status: 200,
					body: { authenticatedUser: { id: '1', providerDisplayName: 'The Octocat' } },
				},
				expectedHeaders: { Accept: 'application/json', Authorization: 'Basic OmF6dXJlLXRva2Vu' },
			},
		];

		for (const { name, create, response, expectedHeaders } of cases) {
			let request: HostingRequest | undefined;
			const provider = create(async value => {
				request = value;
				return response;
			});

			await provider.getAccount();

			assert.deepEqual(request?.headers, expectedHeaders, name);
		}
	});
});
