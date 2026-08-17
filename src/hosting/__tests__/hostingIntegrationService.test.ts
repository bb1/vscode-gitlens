import * as assert from 'node:assert/strict';
import { HostingAuthenticationService } from '../authenticationService.js';
import { HostingIntegrationService } from '../hostingIntegrationService.js';

suite('HostingIntegrationService', () => {
	test('returns registered provider metadata without requesting authentication', () => {
		let authenticationRequests = 0;
		const service = new HostingIntegrationService({
			deleteSession: async () => {},
			getSession: async () => {
				authenticationRequests++;
				return undefined;
			},
		});

		service.register({
			id: 'github',
			domain: 'github.com',
			scopes: ['repo'],
			create: () => {
				throw new Error('Provider must not be created while reading metadata');
			},
		});

		const provider = service.get('github', 'github.com');

		assert.strictEqual(provider?.id, 'github');
		assert.strictEqual(authenticationRequests, 0);
	});

	test('silently authenticates pull request reads before returning authenticationRequired', async () => {
		const authenticationRequests: unknown[][] = [];
		const service = new HostingIntegrationService({
			deleteSession: async () => {},
			getSession: async (...args) => {
				authenticationRequests.push(args);
				return undefined;
			},
		});

		service.register({
			id: 'github',
			domain: 'github.com',
			scopes: ['repo'],
			create: () => {
				throw new Error('Provider must not be created without a session');
			},
		});

		const provider = service.get('github', 'github.com');
		assert.ok(provider);

		const result = await provider.getPullRequests({
			owner: 'example-org',
			name: 'vscode-gitlens',
			domain: 'github.com',
		});

		assert.deepStrictEqual(authenticationRequests, [['github', 'github.com', ['repo'], { silent: true }]]);
		assert.deepStrictEqual(result, { authenticationRequired: true });
	});

	test('uses an interactive session only when explicitly connecting', async () => {
		const authenticationRequests: unknown[][] = [];
		const service = new HostingIntegrationService({
			deleteSession: async () => {},
			getSession: async (...args) => {
				authenticationRequests.push(args);
				return { provider: 'github', accessToken: 'token', accountLabel: 'octocat' };
			},
		});

		service.register({
			id: 'github',
			domain: 'github.com',
			scopes: ['repo'],
			create: () => ({
				id: 'github',
				getPullRequests: async () => [],
				createPullRequest: async () => ({
					id: '1',
					number: 1,
					title: 'title',
					url: 'https://github.com/pr/1',
					state: 'open',
				}),
			}),
		});

		const result = await service.connect('github', 'github.com');

		assert.deepStrictEqual(authenticationRequests, [['github', 'github.com', ['repo'], { interactive: true }]]);
		assert.deepStrictEqual(result, { provider: 'github', accessToken: 'token', accountLabel: 'octocat' });
	});

	test('deletes only the selected provider session when disconnecting', async () => {
		const deleted: unknown[][] = [];
		const service = new HostingIntegrationService({
			deleteSession: async (...args) => {
				deleted.push(args);
			},
			getSession: async () => undefined,
		});
		service.register({
			id: 'github',
			domain: 'github.com',
			scopes: ['repo'],
			create: () => {
				throw new Error('Provider must not be created while disconnecting');
			},
		});

		await service.disconnect('github', 'github.com');

		assert.deepStrictEqual(deleted, [['github', 'github.com']]);
	});

	test('silently gets an account through the registered provider', async () => {
		const service = new HostingIntegrationService({
			deleteSession: async () => {},
			getSession: async () => ({ provider: 'github', accessToken: 'token', accountLabel: 'octocat' }),
		});

		service.register({
			id: 'github',
			domain: 'github.com',
			scopes: ['repo'],
			create: () => ({
				id: 'github',
				getAccount: async () => ({
					id: '1',
					label: 'octocat',
					avatarUrl: 'https://avatars.githubusercontent.com/u/1',
				}),
				getPullRequests: async () => [],
				createPullRequest: async () => ({
					id: '1',
					number: 1,
					title: 'title',
					url: 'https://github.com/pr/1',
					state: 'open',
				}),
			}),
		});

		const provider = service.get('github', 'github.com');
		assert.ok(provider?.getAccount);

		const result = await provider.getAccount();

		assert.deepStrictEqual(result, {
			id: '1',
			label: 'octocat',
			avatarUrl: 'https://avatars.githubusercontent.com/u/1',
		});
	});

	test('keeps GitHub Enterprise and self-managed GitLab credentials scoped to their registered domains', async () => {
		const secrets = new Map<string, string>();
		const inputs = ['github-one-token', 'github-two-token', 'gitlab-one-token', 'gitlab-two-token'];
		const authentication = new HostingAuthenticationService({
			deleteSecret: async () => {},
			getAuthenticationSession: async () => {
				throw new Error('GitHub Enterprise must not use the github.com VS Code session');
			},
			getSecret: async key => secrets.get(key),
			showInputBox: async () => inputs.shift(),
			storeSecret: async (key, value) => {
				secrets.set(key, value);
			},
		});
		const service = new HostingIntegrationService(authentication);
		const accessTokens: string[] = [];
		for (const [id, domain, scopes] of [
			['github', 'github.com', ['repo']],
			['gitlab', 'gitlab.com', ['api']],
		] as const) {
			service.register({
				id: id,
				domain: domain,
				scopes: scopes,
				create: session => ({
					id: id,
					getPullRequests: async () => {
						accessTokens.push(session.accessToken);
						return [];
					},
					createPullRequest: async () => ({
						id: '1',
						number: 1,
						title: 'title',
						url: 'https://example.test/pull/1',
						state: 'open',
					}),
				}),
			});
		}

		await service.connect('github', 'Ghe.One.Example.Test');
		await service.connect('github', 'ghe.two.example.test');
		await service.connect('gitlab', 'GitLab.One.Example.Test');
		await service.connect('gitlab', 'gitlab.two.example.test');

		const githubOne = service.get('github', 'ghe.one.example.test');
		const githubTwo = service.get('github', 'ghe.two.example.test');
		const gitlabOne = service.get('gitlab', 'gitlab.one.example.test');
		const gitlabTwo = service.get('gitlab', 'gitlab.two.example.test');
		assert.ok(githubOne && githubTwo && gitlabOne && gitlabTwo);

		await Promise.all([
			githubOne.getPullRequests({ domain: 'ghe.one.example.test', owner: 'owner', name: 'repo' }),
			githubTwo.getPullRequests({ domain: 'ghe.two.example.test', owner: 'owner', name: 'repo' }),
			gitlabOne.getPullRequests({ domain: 'gitlab.one.example.test', owner: 'owner', name: 'repo' }),
			gitlabTwo.getPullRequests({ domain: 'gitlab.two.example.test', owner: 'owner', name: 'repo' }),
		]);

		assert.deepStrictEqual(accessTokens, [
			'github-one-token',
			'github-two-token',
			'gitlab-one-token',
			'gitlab-two-token',
		]);
		assert.deepStrictEqual(
			[...secrets],
			[
				['gitlens.hosting.auth:github:ghe.one.example.test', 'github-one-token'],
				['gitlens.hosting.auth:github:ghe.two.example.test', 'github-two-token'],
				['gitlens.hosting.auth:gitlab:gitlab.one.example.test', 'gitlab-one-token'],
				['gitlens.hosting.auth:gitlab:gitlab.two.example.test', 'gitlab-two-token'],
			],
		);
	});
});
