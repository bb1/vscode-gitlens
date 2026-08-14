import { strict as assert } from 'node:assert';
import { GitLabHostingProvider } from '../gitlab.js';
import { HostingRequestError } from '../shared.js';
import type { HostingRequest } from '../shared.js';

suite('GitLabHostingProvider', () => {
	test('lists open merge requests with a GitLab token and maps them to hosting pull requests', async () => {
		let request: unknown;
		const provider = new GitLabHostingProvider('secret-gitlab-token', async (value: HostingRequest) => {
			request = value;
			return {
				status: 200,
				body: [
					{
						id: 42,
						iid: 7,
						title: 'Encode project paths',
						web_url: 'https://gitlab.com/team/git.lens/-/merge_requests/7',
						state: 'opened',
						merged_at: null,
					},
				],
			};
		});

		const pullRequests = await provider.getPullRequests({
			owner: 'team',
			name: 'git.lens',
			domain: 'gitlab.com',
		});

		assert.deepEqual(request, {
			method: 'GET',
			url: 'https://gitlab.com/api/v4/projects/team%2Fgit.lens/merge_requests?state=opened&per_page=100',
			headers: { Accept: 'application/json', 'PRIVATE-TOKEN': 'secret-gitlab-token' },
		});
		assert.deepEqual(pullRequests, [
			{
				id: '42',
				number: 7,
				title: 'Encode project paths',
				url: 'https://gitlab.com/team/git.lens/-/merge_requests/7',
				state: 'open',
			},
		]);
	});

	test('creates a merge request with validated JSON fields', async () => {
		let request: { body?: string } | undefined;
		const provider = new GitLabHostingProvider('secret-gitlab-token', async (value: HostingRequest) => {
			request = value;
			return {
				status: 201,
				body: {
					id: 43,
					iid: 8,
					title: 'Create merge request',
					web_url: 'https://gitlab.com/team/gitlens/-/merge_requests/8',
					state: 'opened',
					merged_at: null,
				},
			};
		});

		const pullRequest = await provider.createPullRequest(
			{ owner: 'team', name: 'gitlens', domain: 'gitlab.com' },
			{ base: 'main', head: 'feature/gitlab-api', title: 'Create merge request', body: 'Uses REST.' },
		);

		assert.deepEqual(JSON.parse(request?.body ?? ''), {
			target_branch: 'main',
			source_branch: 'feature/gitlab-api',
			title: 'Create merge request',
			description: 'Uses REST.',
		});
		assert.deepEqual(pullRequest, {
			id: '43',
			number: 8,
			title: 'Create merge request',
			url: 'https://gitlab.com/team/gitlens/-/merge_requests/8',
			state: 'open',
		});
	});

	test('gets the authenticated account and avatar URL', async () => {
		let request: unknown;
		const provider = new GitLabHostingProvider('secret-gitlab-token', async (value: HostingRequest) => {
			request = value;
			return {
				status: 200,
				body: {
					id: 1,
					username: 'octocat',
					name: 'The Octocat',
					avatar_url: 'https://gitlab.com/uploads/-/system/user/avatar/1/avatar.png',
				},
			};
		});

		const account = await provider.getAccount();

		assert.deepEqual(request, {
			method: 'GET',
			url: 'https://gitlab.com/api/v4/user',
			headers: { Accept: 'application/json', 'PRIVATE-TOKEN': 'secret-gitlab-token' },
		});
		assert.deepEqual(account, {
			id: '1',
			label: 'The Octocat',
			avatarUrl: 'https://gitlab.com/uploads/-/system/user/avatar/1/avatar.png',
		});
	});

	test('maps unauthorized and forbidden responses to authentication required', async () => {
		for (const status of [401, 403]) {
			const provider = new GitLabHostingProvider('secret-gitlab-token', async () => ({
				status: status,
				body: { message: 'PRIVATE-TOKEN secret-gitlab-token' },
			}));

			assert.deepEqual(await provider.getPullRequests({ owner: 'team', name: 'gitlens', domain: 'gitlab.com' }), {
				authenticationRequired: true,
			});
		}
	});

	test('uses a validated custom domain and keeps its token in the GitLab header', async () => {
		let request: unknown;
		const provider = new GitLabHostingProvider(
			'gitlab-token',
			async (value: HostingRequest) => {
				request = value;
				return { status: 200, body: [] };
			},
			'gitlab.example.test',
		);

		assert.deepEqual(
			await provider.getPullRequests({
				owner: 'group/subgroup',
				name: 'gitlens',
				domain: 'gitlab.example.test',
			}),
			[],
		);
		assert.deepEqual(request, {
			method: 'GET',
			url: 'https://gitlab.example.test/api/v4/projects/group%2Fsubgroup%2Fgitlens/merge_requests?state=opened&per_page=100',
			headers: { Accept: 'application/json', 'PRIVATE-TOKEN': 'gitlab-token' },
		});
	});

	test('rejects invalid repository and pull request input before transport', async () => {
		let requestCount = 0;
		const provider = new GitLabHostingProvider('secret-gitlab-token', async () => {
			requestCount++;
			return { status: 200, body: [] };
		});

		await assert.rejects(
			provider.getPullRequests({ owner: '../private', name: 'gitlens', domain: 'gitlab.com' }),
			/Invalid GitLab repository owner/,
		);
		await assert.rejects(
			provider.createPullRequest(
				{ owner: 'team', name: 'gitlens', domain: 'gitlab.com' },
				{ base: 'main..private', head: 'feature/gitlab-api', title: 'Create merge request' },
			),
			/Invalid GitLab base branch/,
		);
		assert.equal(requestCount, 0);
	});

	test('exposes only a status for non-authentication failures', async () => {
		const provider = new GitLabHostingProvider('secret-gitlab-token', async () => ({
			status: 500,
			body: { message: 'PRIVATE-TOKEN secret-gitlab-token private response details' },
		}));

		await assert.rejects(
			provider.getPullRequests({ owner: 'team', name: 'gitlens', domain: 'gitlab.com' }),
			error => {
				assert(HostingRequestError.is(error));
				assert.equal(error.status, 500);
				assert.equal(error.message, 'GitLab request failed');
				assert.deepEqual(Object.keys(error), ['status']);
				assert.equal(error.message.includes('secret-gitlab-token'), false);
				assert.equal(error.message.includes('private response details'), false);
				return true;
			},
		);
	});
});
