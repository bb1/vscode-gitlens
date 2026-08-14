import { strict as assert } from 'node:assert';
import { Uri } from 'vscode';
import type { GitHubRequest, GitHubRequestTransport } from '@gitlens/hosting-github/githubClient.js';
import { encodeUtf8Hex } from '@gitlens/utils/hex.js';
import { getGitHubVirtualRepository } from '../githubRemoteHub.js';
import type { GitHubRemoteHub } from '../githubRemoteHub.js';
import { GitHubVirtualGitDataProvider, GitHubVirtualUnsupportedError } from '../githubVirtualGitDataProvider.js';
import { createGitHubRequestTransport } from '../githubVirtualGitProvider.js';

const sha = 'a'.repeat(40);
const parentSha = 'b'.repeat(40);
const blobSha = 'c'.repeat(40);

suite('GitHubVirtualGitDataProvider', () => {
	test('uses GitHub.com only as the trusted default for bare mounted GitHub authorities', async () => {
		const remoteHub: GitHubRemoteHub = {
			getMetadata: async () => ({
				provider: { id: 'github' },
				repo: { owner: 'octo-cat', name: 'gitlens' },
				getRevision: async () => ({ name: 'main', revision: sha }),
			}),
			getVirtualWorkspaceUri: value => value,
		};

		const repository = await getGitHubVirtualRepository(
			remoteHub,
			Uri.parse('vscode-vfs://github/octo-cat/gitlens'),
		);

		assert.equal(repository.domain, 'github.com');
	});

	test('rejects mismatched provider and repository domains before requesting GitHub', async () => {
		const remoteHub: GitHubRemoteHub = {
			getMetadata: async () => ({
				provider: { id: 'github', domain: 'github.example.com' },
				repo: { owner: 'octo-cat', name: 'gitlens', domain: 'github.invalid' },
				getRevision: async () => ({ name: 'main', revision: sha }),
			}),
			getVirtualWorkspaceUri: value => value,
		};

		await assert.rejects(
			getGitHubVirtualRepository(remoteHub, Uri.parse('vscode-vfs://github/octo-cat/gitlens')),
			/Invalid GitHub virtual repository metadata/,
		);
	});

	test('rejects malformed encoded RemoteHub authorities', async () => {
		const remoteHub: GitHubRemoteHub = {
			getMetadata: async () => ({
				provider: { id: 'github', domain: 'github.com' },
				repo: { owner: 'octo-cat', name: 'gitlens', domain: 'github.com' },
				getRevision: async () => ({ name: 'main', revision: sha }),
			}),
			getVirtualWorkspaceUri: value => value,
		};

		await assert.rejects(
			getGitHubVirtualRepository(remoteHub, Uri.parse('vscode-vfs://github+not-hex/octo-cat/gitlens')),
			/Invalid GitHub virtual repository metadata/,
		);
	});

	test('preserves GitHub pagination links from the HTTP response', async () => {
		const transport = createGitHubRequestTransport(
			async () =>
				new Response('[]', {
					status: 200,
					headers: { link: '<https://api.github.com/repos/octo-cat/gitlens/commits/a?page=2>; rel="next"' },
				}),
		);

		const response = await transport({ method: 'GET', url: 'https://api.github.com', headers: {} });

		assert.equal(
			response.headers?.link,
			'<https://api.github.com/repos/octo-cat/gitlens/commits/a?page=2>; rel="next"',
		);
	});

	test('serves complete revision content and trees from the validated virtual repository identity', async () => {
		const requests: GitHubRequest[] = [];
		const { provider, repoPath } = createProvider(async request => {
			requests.push(request);
			if (request.url.includes('/contents/')) {
				return {
					status: 200,
					body: {
						type: 'file',
						path: 'src/index.ts',
						sha: blobSha,
						size: 2,
						encoding: 'base64',
						content: 'aGk=',
					},
				};
			}

			return {
				status: 200,
				body: {
					sha: sha,
					truncated: false,
					tree: [{ path: 'src/index.ts', mode: '100644', type: 'blob', sha: blobSha, size: 2 }],
				},
			};
		});

		assert.deepEqual(
			await provider.revision.getRevisionContent(repoPath, 'src/index.ts', sha),
			new Uint8Array([104, 105]),
		);
		assert.deepEqual(await provider.revision.getTreeForRevision(repoPath, sha), [
			{ ref: sha, oid: blobSha, path: 'src/index.ts', size: 2, type: 'blob' },
		]);
		assert.equal(
			requests.every(request => request.url.includes('/repos/octo-cat/gitlens/')),
			true,
		);
	});

	test('renders gitlinks as factual subproject commit content', async () => {
		const gitlinkSha = 'd'.repeat(40);
		const { provider, repoPath } = createProvider(async request => {
			if (request.url.includes('/contents/')) {
				return { status: 200, body: { type: 'submodule', path: 'modules/core', sha: gitlinkSha } };
			}

			return {
				status: 200,
				body: {
					sha: sha,
					truncated: false,
					tree: [{ path: 'modules/core', mode: '160000', type: 'commit', sha: gitlinkSha }],
				},
			};
		});

		assert.deepEqual(
			await provider.revision.getRevisionContent(repoPath, 'modules/core', sha),
			new TextEncoder().encode(`Subproject commit ${gitlinkSha}\n`),
		);
	});

	test('returns paged history, graph rows, and comparison files only from complete GitHub responses', async () => {
		const { provider, repoPath } = createProvider(async request => {
			if (request.url.includes('/compare/')) {
				return {
					status: 200,
					body: {
						status: 'ahead',
						ahead_by: 1,
						behind_by: 0,
						total_commits: 1,
						commits: [commit(sha, parentSha)],
						files: [file('src/index.ts')],
					},
				};
			}
			if (request.url.includes('/branches')) {
				return { status: 200, body: [{ name: 'main', protected: false, commit: { sha: sha } }] };
			}
			if (request.url.includes('/tags')) {
				return { status: 200, body: [] };
			}
			if (request.url.includes('matching-refs')) {
				return { status: 200, body: [] };
			}
			return { status: 200, body: [commit(sha, parentSha)] };
		});

		const log = await provider.commits.getLog(repoPath, 'main', { limit: 1 });
		const graph = await provider.graph.getGraph(repoPath, 'main', { limit: 1 });
		const files = await provider.diff.getDiffStatus(repoPath, 'main', 'feature/read-api');

		assert.equal(log?.commits.get(sha)?.parents[0], parentSha);
		assert.equal(log?.hasMore, true);
		assert.deepEqual(
			graph.rows.map(row => row.sha),
			[sha],
		);
		assert.deepEqual(files, [
			{
				path: 'src/index.ts',
				status: 'M',
				repoPath: repoPath,
				stats: { additions: 1, deletions: 0, changes: 1 },
			},
		]);
	});

	test('rejects two-dot comparisons before requesting GitHub', async () => {
		let requests = 0;
		const { provider, repoPath } = createProvider(async () => {
			requests++;
			return { status: 200, body: {} };
		});

		await assert.rejects(
			provider.diff.getDiffStatus(repoPath, 'main..feature/read-api'),
			GitHubVirtualUnsupportedError,
		);
		assert.equal(requests, 0);
	});

	test('splits triple-dot comparisons before requesting GitHub', async () => {
		const requests: GitHubRequest[] = [];
		const { provider, repoPath } = createProvider(async request => {
			requests.push(request);
			return {
				status: 200,
				body: {
					status: 'ahead',
					ahead_by: 1,
					behind_by: 0,
					total_commits: 1,
					commits: [commit(sha, parentSha)],
					files: [file('src/index.ts')],
				},
			};
		});

		await provider.diff.getDiffStatus(repoPath, 'main...feature/read-api');

		assert.equal(requests[0]?.url.includes('/compare/main...feature%2Fread-api'), true);
	});

	test('continues graph sessions from the prior history cursor', async () => {
		const firstSha = 'e'.repeat(40);
		const secondSha = 'f'.repeat(40);
		const requests: GitHubRequest[] = [];
		const { provider, repoPath } = createProvider(async request => {
			requests.push(request);
			if (request.url.includes('/commits?')) {
				return {
					status: 200,
					body:
						new URL(request.url).searchParams.get('page') === '2'
							? [commit(secondSha, firstSha)]
							: Array.from({ length: 100 }, (_, index) =>
									commit((index + 1).toString(16).padStart(40, '0'), parentSha),
								),
				};
			}
			if (request.url.includes('/branches')) return { status: 200, body: [] };
			if (request.url.includes('/tags')) return { status: 200, body: [] };
			if (request.url.includes('matching-refs')) return { status: 200, body: [] };

			throw new Error(`Unexpected request: ${request.url}`);
		});

		const session = await provider.graph.openGraphSession(repoPath, { limit: 100 });
		assert.equal(await session.more(100), true);

		assert.equal(session.window.at(-1)?.sha, secondSha);
		assert.equal(
			requests.some(request => request.url.includes('page=2')),
			true,
		);
	});

	test('accumulates paged history while exposing only the new page to graph consumers', async () => {
		const firstSha = 'c'.repeat(40);
		const secondSha = 'd'.repeat(40);
		const { provider, repoPath } = createProvider(async request => ({
			status: 200,
			body:
				new URL(request.url).searchParams.get('page') === '2'
					? [commit(secondSha, firstSha)]
					: [
							commit(firstSha, parentSha),
							...Array.from({ length: 99 }, (_, index) =>
								commit((index + 3).toString(16).padStart(40, '0'), parentSha),
							),
						],
		}));

		const first = await provider.commits.getLog(repoPath, 'main', { limit: 100 });
		const more = await first?.more?.(100);

		assert.equal(more?.commits.has(firstSha), true);
		assert.equal(more?.commits.has(secondSha), true);
		assert.equal(more?.count, 101);
		assert.deepEqual([...(more?.pagedCommits?.().keys() ?? [])], [secondSha]);
	});

	test('pages tag lookup and retains the requested history path', async () => {
		const requests: GitHubRequest[] = [];
		const { provider, repoPath } = createProvider(async request => {
			requests.push(request);
			if (request.url.includes('/tags?')) {
				return {
					status: 200,
					body:
						new URL(request.url).searchParams.get('page') === '2'
							? [{ name: 'v2.0.0', commit: { sha: sha } }]
							: Array.from({ length: 100 }, (_, index) => ({
									name: `v1.${index}.0`,
									commit: { sha: sha },
								})),
				};
			}
			if (request.url.includes('matching-refs')) {
				return { status: 200, body: [] };
			}

			return { status: 200, body: [commit(sha, parentSha)] };
		});

		const [tag, log] = await Promise.all([
			provider.tags.getTag(repoPath, 'v2.0.0'),
			provider.commits.getLogForPath(repoPath, 'src/index.ts', 'main', { limit: 1 }),
		]);

		assert.equal(tag?.name, 'v2.0.0');
		assert.equal(log?.commits.has(sha), true);
		assert.equal(
			requests.some(request => request.url.includes('path=src%2Findex.ts')),
			true,
		);
	});

	test('filters commit-for-file history by its requested path', async () => {
		const requests: GitHubRequest[] = [];
		const { provider, repoPath } = createProvider(async request => {
			requests.push(request);
			return { status: 200, body: [commit(sha, parentSha)] };
		});

		const result = await provider.commits.getCommitForFile(repoPath, 'src/index.ts', 'main');

		assert.equal(result?.sha, sha);
		assert.equal(requests[0]?.url.includes('path=src%2Findex.ts'), true);
	});

	test('normalizes a zero history limit to one bounded API page', async () => {
		const requests: GitHubRequest[] = [];
		const { provider, repoPath } = createProvider(async request => {
			requests.push(request);
			return { status: 200, body: [] };
		});

		await provider.commits.getLog(repoPath, 'main', { limit: 0 });

		assert.equal(requests[0]?.url.includes('per_page=100'), true);
	});

	test('maps branches, annotated tags, refs, remotes, and contributors from read APIs', async () => {
		const { provider, repoPath } = createProvider(async request => {
			if (request.url.includes('/branches')) {
				return { status: 200, body: [{ name: 'main', protected: false, commit: { sha: sha } }] };
			}
			if (request.url.includes('/git/tags/')) {
				return {
					status: 200,
					body: {
						tag: 'v1.0.0',
						sha: parentSha,
						message: 'Release',
						tagger: { name: 'Octo Cat', email: 'octo@example.com', date: '2026-08-14T00:00:00Z' },
						object: { sha: sha, type: 'commit' },
					},
				};
			}
			if (request.url.includes('/tags?')) {
				return { status: 200, body: [{ name: 'v1.0.0', commit: { sha: sha } }] };
			}
			if (request.url.includes('matching-refs/tags/')) {
				return { status: 200, body: [{ ref: 'refs/tags/v1.0.0', object: { sha: parentSha, type: 'tag' } }] };
			}
			if (request.url.includes('matching-refs')) {
				return { status: 200, body: [{ ref: 'refs/heads/main', object: { sha: sha, type: 'commit' } }] };
			}
			return {
				status: 200,
				body: [{ login: 'octo-cat', contributions: 3, html_url: 'https://github.com/octo-cat' }],
			};
		});

		const [branches, tags, tips, remotes, contributors] = await Promise.all([
			provider.branches.getBranches(repoPath),
			provider.tags.getTags(repoPath),
			provider.refs.getRefTips(repoPath, { include: ['heads'] }),
			provider.remotes.getRemotes(repoPath),
			provider.contributors.getContributorsLite(repoPath),
		]);

		assert.equal(branches.values[0].name, 'origin/main');
		assert.equal(branches.values[0].remote, true);
		assert.deepEqual(
			tags.values.map(tag => ({ name: tag.name, sha: tag.sha, annotated: tag.annotated })),
			[{ name: 'v1.0.0', sha: sha, annotated: true }],
		);
		assert.deepEqual(tips, [{ type: 'branch', name: 'main', fullName: 'refs/heads/main', sha: sha }]);
		assert.equal(remotes[0].url, 'https://github.com/octo-cat/gitlens.git');
		assert.equal(contributors[0].username, 'octo-cat');
	});

	test('rejects working-tree and mutation operations before issuing a request', async () => {
		let requests = 0;
		const { provider, repoPath } = createProvider(async () => {
			requests++;
			return { status: 200, body: {} };
		});

		await assert.rejects(provider.status.getWorkingChangesState(repoPath), GitHubVirtualUnsupportedError);
		await assert.rejects(
			provider.refs.updateReference(repoPath, 'refs/heads/main', sha),
			GitHubVirtualUnsupportedError,
		);
		await assert.rejects(provider.staging?.stageFile(repoPath, 'src/index.ts'), GitHubVirtualUnsupportedError);
		await assert.rejects(
			provider.clone?.('https://github.com/octo-cat/gitlens.git', '/tmp'),
			GitHubVirtualUnsupportedError,
		);
		assert.throws(() => provider.worktrees?.getWorktreesDefaultUri(repoPath), GitHubVirtualUnsupportedError);
		await assert.rejects(
			provider.worktrees?.createWorktree(repoPath, '/tmp/worktree'),
			GitHubVirtualUnsupportedError,
		);
		await assert.rejects(
			provider.contributors.getContributorsLite(repoPath, 'feature/read-api'),
			GitHubVirtualUnsupportedError,
		);
		assert.equal(requests, 0);
	});
});

function createProvider(transport: GitHubRequestTransport): {
	provider: GitHubVirtualGitDataProvider;
	repoPath: string;
} {
	const uri = Uri.parse(`vscode-vfs://github+${encodeUtf8Hex(JSON.stringify({ v: 1 }))}/octo-cat/gitlens`);
	const remoteHub: GitHubRemoteHub = {
		getMetadata: async () => ({
			provider: { id: 'github', domain: 'github.com' },
			repo: { owner: 'octo-cat', name: 'gitlens', domain: 'github.com' },
			getRevision: async () => ({ name: 'main', revision: sha }),
		}),
		getVirtualWorkspaceUri: value => value,
	};
	const repoPath = uri.toString();
	return {
		provider: new GitHubVirtualGitDataProvider({
			getSession: async () => ({ provider: 'github', accessToken: 'secret-token', accountLabel: 'octo-cat' }),
			request: transport,
			resolveRepository: value => getGitHubVirtualRepository(remoteHub, Uri.parse(value)),
		}),
		repoPath: repoPath,
	};
}

function commit(commitSha: string, parent: string): Record<string, unknown> {
	return {
		sha: commitSha,
		html_url: `https://github.com/octo-cat/gitlens/commit/${commitSha}`,
		commit: {
			message: 'Test commit',
			author: { name: 'Octo Cat', email: 'octo@example.com', date: '2026-08-14T00:00:00Z' },
			committer: { name: 'Octo Cat', email: 'octo@example.com', date: '2026-08-14T00:00:00Z' },
		},
		parents: [{ sha: parent }],
	};
}

function file(path: string): Record<string, unknown> {
	return { filename: path, status: 'modified', additions: 1, deletions: 0, changes: 1 };
}
