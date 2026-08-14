import * as assert from 'node:assert/strict';
import { GitHubRemoteProvider } from '@gitlens/git/remotes/github.js';
import { fetchAvatarImageAsDataUri, getAvatarUri, resetAvatarCache } from '../avatars.js';
import { Container } from '../container.js';

suite('avatars', () => {
	const containerInstanceDescriptor = Object.getOwnPropertyDescriptor(Container, 'instance')!;

	teardown(() => {
		Object.defineProperty(Container, 'instance', containerInstanceDescriptor);
		setContainer({ get: () => undefined });
		resetAvatarCache('all');
		Object.defineProperty(Container, 'instance', containerInstanceDescriptor);
	});

	test('uses and caches the connected provider account avatar', async () => {
		let accountRequests = 0;
		setContainer({
			get: () => ({
				getAccount: async () => {
					accountRequests++;
					return {
						id: '1',
						label: 'octocat',
						avatarUrl: 'https://avatars.githubusercontent.com/u/1',
					};
				},
			}),
		});

		const avatar = await getAvatarUri('author@example.com', { ref: 'abc123', repoPath: '/repo' });
		const cachedAvatar = await getAvatarUri('author@example.com', { ref: 'abc123', repoPath: '/repo' });

		assert.strictEqual(avatar.toString(), 'https://avatars.githubusercontent.com/u/1');
		assert.strictEqual(cachedAvatar.toString(), 'https://avatars.githubusercontent.com/u/1');
		assert.strictEqual(accountRequests, 1);
	});

	test('uses a generated local avatar when no provider account is available', async () => {
		setContainer({ get: () => undefined });

		const avatar = await getAvatarUri('author@example.com', { ref: 'abc123', repoPath: '/repo' });

		assert.strictEqual(avatar.scheme, 'data');
		assert.ok(decodeURIComponent(avatar.toString()).startsWith('data:image/svg+xml;base64,'));
	});

	test('does not fetch an avatar URL that was not returned by a provider', async () => {
		assert.strictEqual(await fetchAvatarImageAsDataUri('https://example.com/avatar.png'), undefined);
	});
});

function setContainer(hosting: { get(): unknown }): void {
	Object.defineProperty(Container, 'instance', {
		configurable: true,
		get: () => ({
			git: {
				getRepositoryService: () => ({
					remotes: {
						getBestRemoteWithProvider: async () => ({
							provider: new GitHubRemoteProvider('github.com', 'gitkraken/vscode-gitlens'),
						}),
					},
				}),
			},
			hosting: hosting,
			storage: {
				delete: async () => {},
				get: () => undefined,
				store: async () => {},
			},
		}),
	});
}
