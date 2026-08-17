import { strict as assert } from 'node:assert';
import { GitHubRequestError } from '../githubClient.js';
import { GitHubHostingProvider } from '../githubHostingProvider.js';

suite('GitHubHostingProvider', () => {
	test('gets the authenticated account with its HTTPS avatar URL', async () => {
		const provider = new GitHubHostingProvider('secret-token', async request => {
			assert.deepStrictEqual(request, {
				method: 'GET',
				url: 'https://api.github.com/user',
				headers: {
					Accept: 'application/vnd.github+json',
					Authorization: 'Bearer secret-token',
					'X-GitHub-Api-Version': '2022-11-28',
				},
			});
			return {
				status: 200,
				body: { id: 1, login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
			};
		});

		const account = await provider.getAccount();

		assert.deepStrictEqual(account, {
			id: '1',
			label: 'octocat',
			avatarUrl: 'https://avatars.githubusercontent.com/u/1',
		});
	});

	test('gets the pull request associated with a commit', async () => {
		let request: unknown;
		const provider = new GitHubHostingProvider('secret-token', async value => {
			request = value;
			return {
				status: 200,
				body: [
					{
						id: 1,
						number: 7,
						title: 'Fix provider wiring',
						html_url: 'https://github.com/octocat/gitlens/pull/7',
						state: 'open',
						merged_at: null,
					},
				],
			};
		});

		const pullRequest = await provider.getPullRequestForCommit(
			{ owner: 'octocat', name: 'gitlens', domain: 'github.com' },
			'abc123',
		);

		assert.deepStrictEqual(request, {
			method: 'GET',
			url: 'https://api.github.com/repos/octocat/gitlens/commits/abc123/pulls',
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: 'Bearer secret-token',
				'X-GitHub-Api-Version': '2022-11-28',
			},
		});
		assert.deepStrictEqual(pullRequest, {
			id: '1',
			number: 7,
			title: 'Fix provider wiring',
			url: 'https://github.com/octocat/gitlens/pull/7',
			state: 'open',
		});
	});

	test('maps open pull requests to the hosting contract', async () => {
		const provider = new GitHubHostingProvider('secret-token', async () => ({
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
		}));

		const pullRequests = await provider.getPullRequests({
			owner: 'octo-cat',
			name: 'gitlens',
			domain: 'github.com',
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

	test('maps created pull requests to the hosting contract', async () => {
		const provider = new GitHubHostingProvider('secret-token', async () => ({
			status: 201,
			body: {
				id: 8,
				number: 4,
				title: 'Add GitHub hosting',
				html_url: 'https://github.com/octo-cat/gitlens/pull/4',
				state: 'open',
				merged_at: null,
			},
		}));

		const pullRequest = await provider.createPullRequest(
			{ owner: 'octo-cat', name: 'gitlens', domain: 'github.com' },
			{ base: 'main', head: 'feature/github-api', title: 'Add GitHub hosting' },
		);

		assert.deepEqual(pullRequest, {
			id: '8',
			number: 4,
			title: 'Add GitHub hosting',
			url: 'https://github.com/octo-cat/gitlens/pull/4',
			state: 'open',
		});
	});

	test('maps an unauthorized GitHub response to an authentication-required result', async () => {
		const provider = new GitHubHostingProvider('secret-token', async () => ({
			status: 401,
			body: { message: 'Bearer secret-token private response details' },
		}));

		const result = await provider.getPullRequests({
			owner: 'octo-cat',
			name: 'gitlens',
			domain: 'github.com',
		});

		assert.deepEqual(result, { authenticationRequired: true });
	});

	test('preserves sanitized errors for GitHub responses other than unauthorized', async () => {
		const provider = new GitHubHostingProvider('secret-token', async () => ({
			status: 403,
			body: { message: 'Bearer secret-token private response details' },
		}));

		await assert.rejects(
			provider.getPullRequests({ owner: 'octo-cat', name: 'gitlens', domain: 'github.com' }),
			error => {
				assert(GitHubRequestError.is(error));
				assert.equal(error.status, 403);
				assert.equal(error.message, 'GitHub request failed');
				assert.equal(error.message.includes('secret-token'), false);
				assert.deepEqual(Object.keys(error), ['status']);
				return true;
			},
		);
	});
});
