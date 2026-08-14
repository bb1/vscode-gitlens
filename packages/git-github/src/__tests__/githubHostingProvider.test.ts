import { strict as assert } from 'node:assert';
import { GitHubRequestError } from '../githubClient.js';
import { GitHubHostingProvider } from '../githubHostingProvider.js';

suite('GitHubHostingProvider', () => {
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
