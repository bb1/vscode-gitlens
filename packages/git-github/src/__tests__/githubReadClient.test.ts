import { strict as assert } from 'node:assert';
import type { GitHubRequest } from '../githubClient.js';
import { GitHubClient, GitHubRequestError, GitHubResponseTooLargeError } from '../githubClient.js';

const repository = { owner: 'octo-cat', name: 'gitlens', domain: 'github.com' };

suite('GitHubClient read primitives', () => {
	test('lists branches and gets a branch with encoded refs', async () => {
		const requests: GitHubRequest[] = [];
		const client = new GitHubClient('secret-token', async request => {
			requests.push(request);
			return {
				status: 200,
				body: request.url.includes('/branches/feature%2Fencoded')
					? { name: 'feature/encoded', protected: false, commit: { sha: 'b'.repeat(40) } }
					: [{ name: 'main', protected: true, commit: { sha: 'a'.repeat(40) } }],
			};
		});

		const branches = await client.listBranches(repository);
		const branch = await client.getBranch(repository, 'feature/encoded');

		assert.deepEqual(branches, [{ name: 'main', sha: 'a'.repeat(40), isProtected: true }]);
		assert.deepEqual(branch, { name: 'feature/encoded', sha: 'b'.repeat(40), isProtected: false });
		assert.deepEqual(
			requests.map(request => request.url),
			[
				'https://api.github.com/repos/octo-cat/gitlens/branches?per_page=100&page=1',
				'https://api.github.com/repos/octo-cat/gitlens/branches/feature%2Fencoded',
			],
		);
	});

	test('gets default branch metadata from repository metadata', async () => {
		const client = new GitHubClient('secret-token', async () => ({
			status: 200,
			body: {
				id: 42,
				owner: { login: 'octo-cat' },
				name: 'gitlens',
				html_url: 'https://github.com/octo-cat/gitlens',
				default_branch: 'main',
				private: false,
			},
		}));

		assert.deepEqual(await client.getDefaultBranch(repository), { name: 'main' });
	});

	test('lists commits across bounded pages with validated ref and content path', async () => {
		const requests: GitHubRequest[] = [];
		const client = new GitHubClient('secret-token', async request => {
			requests.push(request);
			const page = new URL(request.url).searchParams.get('page');
			return {
				status: 200,
				body: page === '1' ? Array.from({ length: 100 }, (_, index) => commit(`${index}`)) : [commit('c')],
			};
		});

		const commits = await client.listCommits(repository, {
			limit: 101,
			ref: 'feature/read-api',
			path: 'src/a b.ts',
		});

		assert.equal(commits.length, 101);
		assert.equal(commits[100].sha, 'c'.repeat(40));
		assert.deepEqual(
			requests.map(request => request.url),
			[
				'https://api.github.com/repos/octo-cat/gitlens/commits?per_page=100&page=1&sha=feature%2Fread-api&path=src%2Fa%20b.ts',
				'https://api.github.com/repos/octo-cat/gitlens/commits?per_page=1&page=2&sha=feature%2Fread-api&path=src%2Fa%20b.ts',
			],
		);
	});

	test('gets a commit and maps changed file patch metadata', async () => {
		let request: GitHubRequest | undefined;
		const client = new GitHubClient('secret-token', async value => {
			request = value;
			return {
				status: 200,
				body: {
					...commit('a'),
					stats: { additions: 2, deletions: 1, total: 3 },
					files: [
						{
							filename: 'src/new.ts',
							previous_filename: 'src/old.ts',
							status: 'renamed',
							additions: 2,
							deletions: 1,
							changes: 3,
							patch: '@@ -1 +1 @@',
						},
					],
				},
			};
		});

		const result = await client.getCommit(repository, 'feature/read-api');

		assert.equal(request?.url, 'https://api.github.com/repos/octo-cat/gitlens/commits/feature%2Fread-api');
		assert.deepEqual(result.files, [
			{
				path: 'src/new.ts',
				previousPath: 'src/old.ts',
				status: 'renamed',
				additions: 2,
				deletions: 1,
				changes: 3,
				patch: '@@ -1 +1 @@',
			},
		]);
	});

	test('compares commits and maps changed files with patches', async () => {
		let request: GitHubRequest | undefined;
		const client = new GitHubClient('secret-token', async value => {
			request = value;
			return {
				status: 200,
				body: {
					status: 'ahead',
					ahead_by: 1,
					behind_by: 0,
					total_commits: 1,
					merge_base_commit: commit('a'),
					commits: [commit('b')],
					files: [
						{
							filename: 'src/index.ts',
							status: 'modified',
							additions: 1,
							deletions: 0,
							changes: 1,
							patch: '@@ -1 +1 @@',
						},
					],
				},
			};
		});

		const comparison = await client.compareCommits(repository, 'main', 'feature/read-api');

		assert.equal(request?.url, 'https://api.github.com/repos/octo-cat/gitlens/compare/main...feature%2Fread-api');
		assert.deepEqual(comparison.files, [
			{
				path: 'src/index.ts',
				status: 'modified',
				additions: 1,
				deletions: 0,
				changes: 1,
				patch: '@@ -1 +1 @@',
			},
		]);
	});

	test('lists refs, tags, and contributors with bounded result counts', async () => {
		const requests: GitHubRequest[] = [];
		const client = new GitHubClient('secret-token', async request => {
			requests.push(request);
			if (request.url.includes('matching-refs')) {
				return {
					status: 200,
					body: [{ ref: 'refs/heads/main', object: { sha: 'a'.repeat(40), type: 'commit' } }],
				};
			}
			if (request.url.includes('/tags?')) {
				return { status: 200, body: [{ name: 'v1.0.0', commit: { sha: 'b'.repeat(40) } }] };
			}

			return {
				status: 200,
				body: [
					{
						login: 'octo-cat',
						avatar_url: 'https://avatars.example/octo-cat',
						html_url: 'https://github.com/octo-cat',
						contributions: 3,
					},
				],
			};
		});

		assert.deepEqual(await client.listRefs(repository), [
			{ name: 'heads/main', sha: 'a'.repeat(40), type: 'commit' },
		]);
		assert.deepEqual(await client.listTags(repository), [{ name: 'v1.0.0', sha: 'b'.repeat(40) }]);
		assert.deepEqual(await client.listContributors(repository), [
			{
				login: 'octo-cat',
				avatarUrl: 'https://avatars.example/octo-cat',
				url: 'https://github.com/octo-cat',
				contributions: 3,
			},
		]);
		assert.equal(
			requests[0].url,
			'https://api.github.com/repos/octo-cat/gitlens/git/matching-refs/?per_page=100&page=1',
		);
	});

	test('gets a complete recursive tree and decodes validated blobs and content', async () => {
		const client = new GitHubClient('secret-token', async request => {
			if (request.url.includes('/git/trees/')) {
				return {
					status: 200,
					body: {
						sha: 'a'.repeat(40),
						truncated: false,
						tree: [{ path: 'src/index.ts', mode: '100644', type: 'blob', sha: 'b'.repeat(40), size: 2 }],
					},
				};
			}
			if (request.url.includes('/git/blobs/')) {
				return { status: 200, body: { sha: 'b'.repeat(40), size: 2, encoding: 'base64', content: 'aGk=' } };
			}

			return {
				status: 200,
				body: {
					type: 'file',
					path: 'src/index.ts',
					sha: 'b'.repeat(40),
					size: 2,
					encoding: 'base64',
					content: 'aGk=',
				},
			};
		});

		assert.deepEqual(await client.getTree(repository, 'main'), {
			sha: 'a'.repeat(40),
			entries: [{ path: 'src/index.ts', mode: '100644', type: 'blob', sha: 'b'.repeat(40), size: 2 }],
		});
		assert.deepEqual([...(await client.getBlob(repository, 'b'.repeat(40))).bytes], [104, 105]);
		assert.deepEqual(await client.getContent(repository, 'src/index.ts', { ref: 'feature/read-api' }), {
			path: 'src/index.ts',
			sha: 'b'.repeat(40),
			bytes: new Uint8Array([104, 105]),
		});
	});

	test('rejects traversal and option-like refs before sending a request', async () => {
		let requestCount = 0;
		const client = new GitHubClient('secret-token', async () => {
			requestCount++;
			return { status: 200, body: [] };
		});

		await assert.rejects(client.listCommits(repository, { ref: '--paginate' }), /Invalid GitHub ref/);
		await assert.rejects(client.listCommits(repository, { ref: 'main..private' }), /Invalid GitHub ref/);
		await assert.rejects(client.getContent(repository, '../.git/config'), /Invalid GitHub content path/);
		await assert.rejects(client.getContent(repository, 'src//index.ts'), /Invalid GitHub content path/);
		assert.equal(requestCount, 0);
	});

	test('rejects non-string repository and ref values before sending a request', async () => {
		let requestCount = 0;
		const client = new GitHubClient('secret-token', async () => {
			requestCount++;
			return { status: 200, body: [] };
		});

		await assert.rejects(
			client.listBranches({ owner: undefined, name: 'gitlens', domain: 'github.com' } as never),
			/Invalid GitHub repository owner/,
		);
		await assert.rejects(
			client.listBranches({ owner: 'octo-cat', name: undefined, domain: 'github.com' } as never),
			/Invalid GitHub repository name/,
		);
		await assert.rejects(client.getCommit(repository, undefined as never), /Invalid GitHub ref/);
		assert.equal(requestCount, 0);
	});

	test('rejects truncated trees, invalid base64, and oversized content without leaking the token', async () => {
		const truncated = new GitHubClient('secret-token', async () => ({
			status: 200,
			body: { sha: 'a'.repeat(40), truncated: true, tree: [] },
		}));
		await assert.rejects(truncated.getTree(repository, 'main'), GitHubResponseTooLargeError);

		const invalidBase64 = new GitHubClient('secret-token', async () => ({
			status: 200,
			body: { sha: 'a'.repeat(40), size: 2, encoding: 'base64', content: 'not base64!' },
		}));
		await assert.rejects(invalidBase64.getBlob(repository, 'a'.repeat(40)), /GitHub response was invalid/);

		const oversized = new GitHubClient('secret-token', async () => ({
			status: 200,
			body: { sha: 'a'.repeat(40), size: 1_048_577, encoding: 'base64', content: '' },
		}));
		await assert.rejects(oversized.getBlob(repository, 'a'.repeat(40)), GitHubResponseTooLargeError);

		const failed = new GitHubClient('secret-token', async () => ({
			status: 401,
			body: { message: 'Bearer secret-token private response details' },
		}));
		await assert.rejects(failed.listBranches(repository), error => {
			assert(GitHubRequestError.is(error));
			assert.equal(error.status, 401);
			assert.equal(error.message.includes('secret-token'), false);
			assert.deepEqual(Object.keys(error), ['status']);
			return true;
		});
	});

	test('continues commit file pages before returning commit details', async () => {
		const requests: GitHubRequest[] = [];
		const client = new GitHubClient('secret-token', async request => {
			requests.push(request);
			if (request.url.endsWith('page=2')) {
				return {
					status: 200,
					body: {
						...commit('a'),
						stats: { additions: 2, deletions: 0, total: 2 },
						files: [commitFile('src/second.ts')],
					},
				};
			}

			return {
				status: 200,
				headers: {
					link: '<https://api.github.com/repos/octo-cat/gitlens/commits/a?page=2>; rel="next"',
				},
				body: {
					...commit('a'),
					stats: { additions: 2, deletions: 0, total: 2 },
					files: [commitFile('src/first.ts')],
				},
			};
		});

		const result = await client.getCommit(repository, 'a'.repeat(40));

		assert.deepEqual(
			result.files?.map(file => file.path),
			['src/first.ts', 'src/second.ts'],
		);
		assert.deepEqual(
			requests.map(request => request.url),
			[
				`https://api.github.com/repos/octo-cat/gitlens/commits/${'a'.repeat(40)}`,
				'https://api.github.com/repos/octo-cat/gitlens/commits/a?page=2',
			],
		);
	});

	test('resolves annotated tag objects to their tagged commit', async () => {
		const client = new GitHubClient('secret-token', async request => ({
			status: 200,
			body: {
				tag: 'v1.0.0',
				sha: 'a'.repeat(40),
				message: 'Release v1.0.0',
				tagger: { name: 'Octo Cat', email: 'octo@example.com', date: '2026-08-14T00:00:00Z' },
				object: { sha: 'b'.repeat(40), type: 'commit' },
			},
		}));

		const result = await client.getAnnotatedTag(repository, 'a'.repeat(40));

		assert.equal(result.targetSha, 'b'.repeat(40));
		assert.deepEqual(result.tagger, { name: 'Octo Cat', email: 'octo@example.com', date: '2026-08-14T00:00:00Z' });
	});

	test('rejects a comparison whose file list reaches GitHubs completeness ceiling', async () => {
		const client = new GitHubClient('secret-token', async () => ({
			status: 200,
			body: {
				status: 'ahead',
				ahead_by: 1,
				behind_by: 0,
				total_commits: 1,
				commits: [commit('a')],
				files: Array.from({ length: 300 }, (_, index) => commitFile(`src/${index}.ts`)),
			},
		}));

		await assert.rejects(
			client.compareCommits(repository, 'main', 'feature/read-api'),
			GitHubResponseTooLargeError,
		);
	});

	test('returns a numbered continuation for a full branch page', async () => {
		const client = new GitHubClient('secret-token', async request => ({
			status: 200,
			body:
				new URL(request.url).searchParams.get('page') === '2'
					? []
					: [{ name: 'main', protected: false, commit: { sha: 'a'.repeat(40) } }],
		}));

		const result = await client.listBranchesPage(repository, { limit: 1, page: 1 });

		assert.deepEqual(result, { values: [{ name: 'main', sha: 'a'.repeat(40), isProtected: false }], nextPage: 2 });
	});

	test('rejects incomplete commit detail and comparison file responses', async () => {
		const client = new GitHubClient('secret-token', async request => ({
			status: 200,
			body: request.url.includes('/compare/')
				? { status: 'identical', ahead_by: 0, behind_by: 0, total_commits: 0, commits: [] }
				: commit('a'),
		}));

		await assert.rejects(client.getCommit(repository, 'a'.repeat(40)), /GitHub response was invalid/);
		await assert.rejects(
			client.compareCommits(repository, 'main', 'feature/read-api'),
			/GitHub response was invalid/,
		);
	});

	test('rejects a comparison that omits commits from the reported total', async () => {
		const client = new GitHubClient('secret-token', async () => ({
			status: 200,
			body: {
				status: 'ahead',
				ahead_by: 2,
				behind_by: 0,
				total_commits: 2,
				commits: [commit('a')],
				files: [],
			},
		}));

		await assert.rejects(
			client.compareCommits(repository, 'main', 'feature/read-api'),
			GitHubResponseTooLargeError,
		);
	});

	test('rejects an untrusted commit-file continuation before sending the token', async () => {
		let requests = 0;
		const client = new GitHubClient('secret-token', async () => {
			requests++;
			return {
				status: 200,
				headers: { link: '<https://attacker.invalid/commits/a?page=2>; rel="next"' },
				body: { ...commit('a'), files: [commitFile('src/index.ts')] },
			};
		});

		await assert.rejects(client.getCommit(repository, 'a'.repeat(40)), /Invalid GitHub pagination link/);
		assert.equal(requests, 1);
	});
});

function commitFile(path: string): Record<string, unknown> {
	return { filename: path, status: 'modified', additions: 1, deletions: 0, changes: 1 };
}

function commit(character: string): Record<string, unknown> {
	const sha = character === 'c' ? character.repeat(40) : character.padStart(40, '0');
	return {
		sha: sha,
		html_url: `https://github.com/octo-cat/gitlens/commit/${sha}`,
		commit: {
			message: `${character} commit`,
			author: { name: 'Octo Cat', email: 'octo@example.com', date: '2026-08-14T00:00:00Z' },
			committer: { name: 'Octo Cat', email: 'octo@example.com', date: '2026-08-14T00:00:00Z' },
		},
		parents: [],
	};
}
