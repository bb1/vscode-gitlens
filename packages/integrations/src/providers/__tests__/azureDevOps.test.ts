import { strict as assert } from 'node:assert';
import { AzureDevOpsHostingProvider } from '../azureDevOps.js';
import type { HostingRequest } from '../shared.js';

suite('AzureDevOpsHostingProvider', () => {
	test('lists active pull requests with PAT basic authentication and maps them to hosting pull requests', async () => {
		let request: unknown;
		const provider = new AzureDevOpsHostingProvider('secret-azure-token', async (value: HostingRequest) => {
			request = value;
			return {
				status: 200,
				body: {
					value: [
						{
							pullRequestId: 7,
							title: 'Encode project paths',
							status: 'active',
							url: 'https://dev.azure.com/team/project/_apis/git/repositories/gitlens/pullRequests/7',
							_links: {
								web: { href: 'https://dev.azure.com/team/project/_git/gitlens/pullrequest/7' },
							},
						},
					],
				},
			};
		});

		const pullRequests = await provider.getPullRequests({
			owner: 'team name',
			project: 'project name',
			name: 'git lens',
			domain: 'dev.azure.com',
		});

		assert.deepEqual(request, {
			method: 'GET',
			url: 'https://dev.azure.com/team%20name/project%20name/_apis/git/repositories/git%20lens/pullrequests?searchCriteria.status=active&%24top=100&api-version=7.1',
			headers: { Accept: 'application/json', Authorization: 'Basic OnNlY3JldC1henVyZS10b2tlbg==' },
		});
		assert.deepEqual(pullRequests, [
			{
				id: '7',
				number: 7,
				title: 'Encode project paths',
				url: 'https://dev.azure.com/team/project/_git/gitlens/pullrequest/7',
				state: 'open',
			},
		]);
	});

	test('creates a pull request with Azure refs and API version 7.1', async () => {
		let request: { body?: string; url?: string } | undefined;
		const provider = new AzureDevOpsHostingProvider('secret-azure-token', async (value: HostingRequest) => {
			request = value;
			return {
				status: 201,
				body: {
					pullRequestId: 8,
					title: 'Create pull request',
					status: 'active',
					_links: {
						web: { href: 'https://dev.azure.com/team/project/_git/gitlens/pullrequest/8' },
					},
				},
			};
		});

		const pullRequest = await provider.createPullRequest(
			{ owner: 'team', project: 'project', name: 'gitlens', domain: 'dev.azure.com' },
			{ base: 'main', head: 'feature/azure-api', title: 'Create pull request', body: 'Uses REST.' },
		);

		assert.equal(
			request?.url,
			'https://dev.azure.com/team/project/_apis/git/repositories/gitlens/pullrequests?api-version=7.1',
		);
		assert.deepEqual(JSON.parse(request?.body ?? ''), {
			title: 'Create pull request',
			sourceRefName: 'refs/heads/feature/azure-api',
			targetRefName: 'refs/heads/main',
			description: 'Uses REST.',
		});
		assert.deepEqual(pullRequest, {
			id: '8',
			number: 8,
			title: 'Create pull request',
			url: 'https://dev.azure.com/team/project/_git/gitlens/pullrequest/8',
			state: 'open',
		});
	});

	test('gets the pull request associated with a commit using the configured Azure domain', async () => {
		const requests: HostingRequest[] = [];
		const provider = new AzureDevOpsHostingProvider('secret-azure-token', async value => {
			requests.push(value);
			return requests.length === 1
				? { status: 200, body: { results: [{ abcdef1: [{ pullRequestId: 7 }] }] } }
				: {
						status: 200,
						body: {
							pullRequestId: 7,
							title: 'Fix provider wiring',
							status: 'active',
							_links: { web: { href: 'https://dev.azure.com/team/project/_git/gitlens/pullrequest/7' } },
						},
					};
		});

		assert.deepEqual(
			await provider.getPullRequestForCommit(
				{ owner: 'team', project: 'project', name: 'gitlens', domain: 'dev.azure.com' },
				'abcdef1',
			),
			{
				id: '7',
				number: 7,
				title: 'Fix provider wiring',
				url: 'https://dev.azure.com/team/project/_git/gitlens/pullrequest/7',
				state: 'open',
			},
		);
		assert.equal(
			requests[0]?.url,
			'https://dev.azure.com/team/project/_apis/git/repositories/gitlens/pullrequestquery?api-version=7.1',
		);
		assert.deepEqual(JSON.parse(requests[0]?.body ?? ''), { queries: [{ items: ['abcdef1'], type: 'commit' }] });
		assert.equal(
			requests[1]?.url,
			'https://dev.azure.com/team/project/_apis/git/repositories/gitlens/pullrequests/7?api-version=7.1',
		);
	});

	test('gets the authenticated account and avatar URL from connection data', async () => {
		const provider = new AzureDevOpsHostingProvider('secret-azure-token', async () => ({
			status: 200,
			body: {
				authenticatedUser: {
					id: '1',
					providerDisplayName: 'The Octocat',
					imageUrl: 'https://dev.azure.com/team/_apis/GraphProfile/MemberAvatars/1',
				},
			},
		}));

		assert.deepEqual(await provider.getAccount(), {
			id: '1',
			label: 'The Octocat',
			avatarUrl: 'https://dev.azure.com/team/_apis/GraphProfile/MemberAvatars/1',
		});
	});

	test('uses a validated custom domain and does not leak another provider token', async () => {
		let request: unknown;
		const provider = new AzureDevOpsHostingProvider(
			'azure-token',
			async (value: HostingRequest) => {
				request = value;
				return { status: 200, body: { value: [] } };
			},
			'azure.example.test',
		);

		const pullRequests = await provider.getPullRequests({
			owner: 'team name',
			project: 'project name',
			name: 'git lens',
			domain: 'azure.example.test',
		});

		assert.deepEqual(pullRequests, []);
		assert.deepEqual(request, {
			method: 'GET',
			url: 'https://azure.example.test/team%20name/project%20name/_apis/git/repositories/git%20lens/pullrequests?searchCriteria.status=active&%24top=100&api-version=7.1',
			headers: { Accept: 'application/json', Authorization: 'Basic OmF6dXJlLXRva2Vu' },
		});
	});

	test('maps unauthorized and forbidden responses to authentication required', async () => {
		for (const status of [401, 403]) {
			const provider = new AzureDevOpsHostingProvider('secret-azure-token', async () => ({
				status: status,
				body: { message: 'Basic OnNlY3JldC1henVyZS10b2tlbg==' },
			}));

			assert.deepEqual(
				await provider.getPullRequests({
					owner: 'team',
					project: 'project',
					name: 'gitlens',
					domain: 'dev.azure.com',
				}),
				{ authenticationRequired: true },
			);
		}
	});
});
