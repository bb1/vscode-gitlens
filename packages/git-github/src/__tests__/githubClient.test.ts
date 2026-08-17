import { strict as assert } from 'node:assert';
import type { GitHubRequest } from '../githubClient.js';
import { GitHubClient, GitHubRequestError } from '../githubClient.js';

suite('GitHubClient', () => {
	test('gets repository metadata with a GitHub REST request', async () => {
		let request: GitHubRequest | undefined;
		const client = new GitHubClient('secret-token', async value => {
			request = value;
			return {
				status: 200,
				body: {
					id: 42,
					node_id: 'R_kgDOGitLens',
					name: 'gitlens',
					full_name: 'octo-cat/gitlens',
					private: true,
					html_url: 'https://github.com/octo-cat/gitlens',
					default_branch: 'main',
					fork: false,
					description: 'Git supercharged',
					owner: { login: 'octo-cat' },
				},
			};
		});

		const repository = await client.getRepository({
			owner: 'octo-cat',
			name: 'gitlens',
			domain: 'GITHUB.COM',
		});

		assert.deepEqual(request, {
			method: 'GET',
			url: 'https://api.github.com/repos/octo-cat/gitlens',
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: 'Bearer secret-token',
				'X-GitHub-Api-Version': '2022-11-28',
			},
		});
		assert.deepEqual(repository, {
			id: '42',
			owner: 'octo-cat',
			name: 'gitlens',
			url: 'https://github.com/octo-cat/gitlens',
			defaultBranch: 'main',
			isPrivate: true,
		});
	});

	test('lists open pull requests with a bounded page size', async () => {
		let request: GitHubRequest | undefined;
		const client = new GitHubClient('secret-token', async value => {
			request = value;
			return {
				status: 200,
				body: [
					{
						id: 7,
						number: 3,
						title: 'Fix encoded branch names',
						html_url: 'https://github.com/octo-cat/gitlens/pull/3',
						state: 'open',
						merged_at: null,
					},
				],
			};
		});

		const pullRequests = await client.getPullRequests(
			{ owner: 'octo-cat', name: 'gitlens', domain: 'GitHub.Example.Test' },
			200,
		);

		assert.deepEqual(request, {
			method: 'GET',
			url: 'https://github.example.test/api/v3/repos/octo-cat/gitlens/pulls?state=open&per_page=100',
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: 'Bearer secret-token',
				'X-GitHub-Api-Version': '2022-11-28',
			},
		});
		assert.deepEqual(pullRequests, [
			{
				id: '7',
				number: 3,
				title: 'Fix encoded branch names',
				url: 'https://github.com/octo-cat/gitlens/pull/3',
				state: 'open',
			},
		]);
	});

	test('creates a pull request with an encoded JSON body', async () => {
		let request: GitHubRequest | undefined;
		const client = new GitHubClient('secret-token', async value => {
			request = value;
			return {
				status: 201,
				body: {
					id: 8,
					number: 4,
					title: 'Add GitHub hosting',
					html_url: 'https://github.com/octo-cat/gitlens/pull/4',
					state: 'open',
					merged_at: null,
				},
			};
		});

		const pullRequest = await client.createPullRequest(
			{ owner: 'octo-cat', name: 'gitlens', domain: 'github.com' },
			{ base: 'main', head: 'feature/github-api', title: 'Add GitHub hosting', body: 'Uses REST.' },
		);

		assert.deepEqual(
			{ ...request, body: undefined },
			{
				method: 'POST',
				url: 'https://api.github.com/repos/octo-cat/gitlens/pulls',
				headers: {
					Accept: 'application/vnd.github+json',
					Authorization: 'Bearer secret-token',
					'Content-Type': 'application/json',
					'X-GitHub-Api-Version': '2022-11-28',
				},
				body: undefined,
			},
		);
		assert.deepEqual(JSON.parse(request?.body ?? ''), {
			base: 'main',
			head: 'feature/github-api',
			title: 'Add GitHub hosting',
			body: 'Uses REST.',
		});
		assert.deepEqual(pullRequest, {
			id: '8',
			number: 4,
			title: 'Add GitHub hosting',
			url: 'https://github.com/octo-cat/gitlens/pull/4',
			state: 'open',
		});
	});

	test('rejects an invalid repository owner before sending a request', async () => {
		const client = new GitHubClient('secret-token', async () => {
			throw new Error('transport should not be called');
		});

		await assert.rejects(
			client.getRepository({ owner: '../private', name: 'gitlens', domain: 'github.com' }),
			/Invalid GitHub repository owner/,
		);
	});

	test('rejects invalid base and head branches before sending a request', async () => {
		const client = new GitHubClient('secret-token', async () => {
			throw new Error('transport should not be called');
		});

		await assert.rejects(
			client.createPullRequest(
				{ owner: 'octo-cat', name: 'gitlens', domain: 'github.com' },
				{ base: 'main..private', head: 'octo-cat:feature/github-api', title: 'Add GitHub hosting' },
			),
			/Invalid GitHub base branch/,
		);
		await assert.rejects(
			client.createPullRequest(
				{ owner: 'octo-cat', name: 'gitlens', domain: 'github.com' },
				{ base: 'main', head: 'octo cat:feature/github-api', title: 'Add GitHub hosting' },
			),
			/Invalid GitHub head branch/,
		);
	});

	test('redacts tokens and response bodies from request errors', async () => {
		const client = new GitHubClient('secret-token', async () => {
			throw new Error('401 Authorization: Bearer secret-token: private response details');
		});

		await assert.rejects(
			client.getRepository({ owner: 'octo-cat', name: 'gitlens', domain: 'github.com' }),
			error => {
				assert(error instanceof Error);
				assert.equal(error.message, 'GitHub request failed');
				assert.equal(error.message.includes('secret-token'), false);
				assert.equal(error.message.includes('private response details'), false);
				assert.equal((error.cause as Error | undefined)?.message, 'GitHub transport failed');
				return true;
			},
		);
	});

	test('returns a status-only error for failed GitHub responses', async () => {
		const client = new GitHubClient('secret-token', async () => ({
			status: 401,
			body: { message: 'Bearer secret-token private response details' },
		}));

		await assert.rejects(
			client.getRepository({ owner: 'octo-cat', name: 'gitlens', domain: 'github.com' }),
			error => {
				assert(GitHubRequestError.is(error));
				assert.equal(error.message, 'GitHub request failed');
				assert.equal(error.status, 401);
				assert.deepEqual(Object.keys(error), ['status']);
				assert.equal(error.message.includes('secret-token'), false);
				assert.equal(error.message.includes('private response details'), false);
				return true;
			},
		);
	});

	test('recognizes reconstructed request errors only with its discriminant and a finite status', () => {
		assert.equal(GitHubRequestError.is({ kind: 'gitlens.github-request-error', status: 401 }), true);
		assert.equal(GitHubRequestError.is({ status: 401 }), false);
		assert.equal(
			GitHubRequestError.is({ kind: 'gitlens.github-request-error', status: Number.POSITIVE_INFINITY }),
			false,
		);
	});

	test('rejects domains that are not hostnames before sending a request', async () => {
		let requestCount = 0;
		const client = new GitHubClient('secret-token', async () => {
			requestCount++;
			return { status: 200, body: {} };
		});

		for (const domain of [
			'https://github.example.test',
			'github.example.test/api/v3',
			'user@github.example.test',
			'github.example.test:8443',
		]) {
			await assert.rejects(
				client.getRepository({ owner: 'octo-cat', name: 'gitlens', domain: domain }),
				/Invalid GitHub domain/,
			);
		}

		assert.equal(requestCount, 0);
	});

	test('rejects an empty access token without exposing it', () => {
		assert.throws(
			() => new GitHubClient('  ', async () => ({ status: 200, body: {} })),
			/Invalid GitHub access token/,
		);
	});
});
