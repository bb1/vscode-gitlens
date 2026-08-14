import { strict as assert } from 'node:assert';
import { BitbucketHostingProvider } from '../bitbucket.js';
import type { HostingRequest } from '../shared.js';

suite('BitbucketHostingProvider', () => {
	test('lists open pull requests with a bearer token and maps them to hosting pull requests', async () => {
		let request: unknown;
		const provider = new BitbucketHostingProvider('secret-bitbucket-token', async (value: HostingRequest) => {
			request = value;
			return {
				status: 200,
				body: {
					values: [
						{
							id: 7,
							title: 'Encode repository paths',
							state: 'OPEN',
							links: { html: { href: 'https://bitbucket.org/team/gitlens/pull-requests/7' } },
						},
					],
				},
			};
		});

		const pullRequests = await provider.getPullRequests({
			owner: 'team',
			name: 'gitlens',
			domain: 'bitbucket.org',
		});

		assert.deepEqual(request, {
			method: 'GET',
			url: 'https://api.bitbucket.org/2.0/repositories/team/gitlens/pullrequests?state=OPEN&pagelen=100',
			headers: { Accept: 'application/json', Authorization: 'Bearer secret-bitbucket-token' },
		});
		assert.deepEqual(pullRequests, [
			{
				id: '7',
				number: 7,
				title: 'Encode repository paths',
				url: 'https://bitbucket.org/team/gitlens/pull-requests/7',
				state: 'open',
			},
		]);
	});

	test('creates a pull request with Bitbucket source and destination branches', async () => {
		let request: { body?: string } | undefined;
		const provider = new BitbucketHostingProvider('secret-bitbucket-token', async (value: HostingRequest) => {
			request = value;
			return {
				status: 201,
				body: {
					id: 8,
					title: 'Create pull request',
					state: 'OPEN',
					links: { html: { href: 'https://bitbucket.org/team/gitlens/pull-requests/8' } },
				},
			};
		});

		const pullRequest = await provider.createPullRequest(
			{ owner: 'team', name: 'gitlens', domain: 'bitbucket.org' },
			{ base: 'main', head: 'feature/bitbucket-api', title: 'Create pull request', body: 'Uses REST.' },
		);

		assert.deepEqual(JSON.parse(request?.body ?? ''), {
			title: 'Create pull request',
			source: { branch: { name: 'feature/bitbucket-api' } },
			destination: { branch: { name: 'main' } },
			description: 'Uses REST.',
		});
		assert.deepEqual(pullRequest, {
			id: '8',
			number: 8,
			title: 'Create pull request',
			url: 'https://bitbucket.org/team/gitlens/pull-requests/8',
			state: 'open',
		});
	});

	test('gets the authenticated account and avatar URL', async () => {
		const provider = new BitbucketHostingProvider('secret-bitbucket-token', async () => ({
			status: 200,
			body: {
				uuid: '{1}',
				display_name: 'The Octocat',
				links: { avatar: { href: 'https://bitbucket.org/account/octocat/avatar/32/' } },
			},
		}));

		assert.deepEqual(await provider.getAccount(), {
			id: '{1}',
			label: 'The Octocat',
			avatarUrl: 'https://bitbucket.org/account/octocat/avatar/32/',
		});
	});

	test('does not accept a custom Bitbucket domain or leak another provider token', async () => {
		let requestCount = 0;
		const provider = new BitbucketHostingProvider('bitbucket-token', async (request: HostingRequest) => {
			requestCount++;
			assert.deepEqual(request.headers, { Accept: 'application/json', Authorization: 'Bearer bitbucket-token' });
			return { status: 200, body: { values: [] } };
		});

		await assert.rejects(
			provider.getPullRequests({ owner: 'team', name: 'gitlens', domain: 'bitbucket.example.test' }),
			/Invalid Bitbucket repository domain/,
		);
		assert.equal(requestCount, 0);
		assert.deepEqual(
			await provider.getPullRequests({ owner: 'team', name: 'gitlens', domain: 'bitbucket.org' }),
			[],
		);
	});

	test('maps unauthorized and forbidden responses to authentication required', async () => {
		for (const status of [401, 403]) {
			const provider = new BitbucketHostingProvider('secret-bitbucket-token', async () => ({
				status: status,
				body: { error: { message: 'Bearer secret-bitbucket-token' } },
			}));

			assert.deepEqual(
				await provider.getPullRequests({ owner: 'team', name: 'gitlens', domain: 'bitbucket.org' }),
				{ authenticationRequired: true },
			);
		}
	});
});
