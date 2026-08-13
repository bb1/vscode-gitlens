import * as assert from 'node:assert';
import { HostingAuthenticationService } from '../authenticationService.js';

type HostingAuthenticationServiceDependencies = ConstructorParameters<typeof HostingAuthenticationService>[0];

function createService(dependencies: Partial<HostingAuthenticationServiceDependencies>): HostingAuthenticationService {
	return new HostingAuthenticationService({
		getAuthenticationSession: async () => undefined,
		getSecret: async () => undefined,
		showInputBox: async () => undefined,
		storeSecret: async () => {},
		...dependencies,
	});
}

suite('HostingAuthenticationService', () => {
	test('returns an existing silent GitHub session without opening a PAT input', async () => {
		let promptShown = false;
		const service = createService({
			getAuthenticationSession: async (provider: string, scopes: readonly string[], options: unknown) => {
				assert.strictEqual(provider, 'github');
				assert.deepStrictEqual(scopes, ['repo']);
				assert.deepStrictEqual(options, { silent: true });
				return { accessToken: 'github-token', account: { label: 'octocat' } };
			},
			showInputBox: async () => {
				promptShown = true;
				return undefined;
			},
		});

		const session = await service.getSession('github', ['repo'], { silent: true });

		assert.deepStrictEqual(session, {
			provider: 'github',
			accessToken: 'github-token',
			accountLabel: 'octocat',
		});
		assert.strictEqual(promptShown, false);
	});

	test('uses VS Code interactive authentication for GitHub before a PAT', async () => {
		let promptShown = false;
		const service = createService({
			getAuthenticationSession: async (provider: string, scopes: readonly string[], options: unknown) => {
				assert.strictEqual(provider, 'github');
				assert.deepStrictEqual(scopes, ['repo']);
				assert.deepStrictEqual(options, { createIfNone: true });
				return { accessToken: 'github-token', account: { label: 'octocat' } };
			},
			showInputBox: async () => {
				promptShown = true;
				return undefined;
			},
		});

		const session = await service.getSession('github', ['repo'], { interactive: true });

		assert.deepStrictEqual(session, {
			provider: 'github',
			accessToken: 'github-token',
			accountLabel: 'octocat',
		});
		assert.strictEqual(promptShown, false);
	});

	test('does not use a stored GitHub PAT when VS Code has no silent session', async () => {
		let promptShown = false;
		const service = createService({
			getSecret: async () => 'github-pat',
			showInputBox: async () => {
				promptShown = true;
				return 'github-pat';
			},
		});

		const session = await service.getSession('github', ['repo'], { silent: true });

		assert.strictEqual(session, undefined);
		assert.strictEqual(promptShown, false);
	});

	test('stores a GitHub PAT when the GitHub provider is unavailable', async () => {
		const stored: [string, string][] = [];
		let inputOptions: unknown;
		const service = createService({
			getAuthenticationSession: async () => {
				throw new Error('Timed out waiting for authentication provider to register');
			},
			showInputBox: async options => {
				inputOptions = options;
				return 'github-pat';
			},
			storeSecret: async (key: string, value: string) => {
				stored.push([key, value]);
			},
		});

		const session = await service.getSession('github', ['repo'], { interactive: true });

		assert.deepStrictEqual(inputOptions, {
			title: 'Connect GitHub',
			prompt: 'Enter a GitHub personal access token',
			password: true,
		});
		assert.deepStrictEqual(stored, [['gitlens.hosting.auth:github', 'github-pat']]);
		assert.deepStrictEqual(session, {
			provider: 'github',
			accessToken: 'github-pat',
			accountLabel: 'GitHub',
		});
	});

	test('uses a GitHub PAT when VS Code reports the unavailable provider as a string', async () => {
		let promptShown = false;
		const unavailableProviderError: unknown = 'Timed out waiting for authentication provider to register';
		const service = createService({
			getAuthenticationSession: () =>
				new Promise((_, reject: (reason: unknown) => void) => {
					// oxlint-disable-next-line typescript/prefer-promise-reject-errors -- VS Code reports this failure as a string
					reject(unavailableProviderError);
				}),
			showInputBox: async () => {
				promptShown = true;
				return undefined;
			},
		});

		const session = await service.getSession('github', ['repo'], { interactive: true });

		assert.strictEqual(session, undefined);
		assert.strictEqual(promptShown, true);
	});

	test('does not store a GitHub PAT when its input is cancelled', async () => {
		let storeCount = 0;
		const service = createService({
			getAuthenticationSession: async () => {
				throw new Error('Timed out waiting for authentication provider to register');
			},
			storeSecret: async () => {
				storeCount++;
			},
		});

		const session = await service.getSession('github', ['repo'], { interactive: true });

		assert.strictEqual(session, undefined);
		assert.strictEqual(storeCount, 0);
	});

	test('does not replace GitHub consent denial with a PAT prompt', async () => {
		let promptShown = false;
		const service = createService({
			getAuthenticationSession: async () => {
				throw new Error('User cancelled authentication');
			},
			showInputBox: async () => {
				promptShown = true;
				return 'github-pat';
			},
		});

		await assert.rejects(
			service.getSession('github', ['repo'], { interactive: true }),
			/User cancelled authentication/,
		);

		assert.strictEqual(promptShown, false);
	});

	test('returns a stored provider-specific PAT for GitLab without prompting', async () => {
		let promptShown = false;
		const service = createService({
			getAuthenticationSession: async () => {
				throw new Error('GitLab must not use VS Code authentication');
			},
			getSecret: async key => {
				assert.strictEqual(key, 'gitlens.hosting.auth:gitlab');
				return 'gitlab-pat';
			},
			showInputBox: async () => {
				promptShown = true;
				return undefined;
			},
		});

		const session = await service.getSession('gitlab', ['api'], { silent: true });

		assert.deepStrictEqual(session, {
			provider: 'gitlab',
			accessToken: 'gitlab-pat',
			accountLabel: 'GitLab',
		});
		assert.strictEqual(promptShown, false);
	});

	test('stores a provider-specific PAT for GitLab only in interactive mode', async () => {
		const stored: [string, string][] = [];
		let inputOptions: unknown;
		const service = createService({
			showInputBox: async options => {
				inputOptions = options;
				return 'gitlab-pat';
			},
			storeSecret: async (key: string, value: string) => {
				stored.push([key, value]);
			},
		});

		const session = await service.getSession('gitlab', ['api'], { interactive: true });

		assert.deepStrictEqual(inputOptions, {
			title: 'Connect GitLab',
			prompt: 'Enter a GitLab personal access token',
			password: true,
		});
		assert.deepStrictEqual(stored, [['gitlens.hosting.auth:gitlab', 'gitlab-pat']]);
		assert.deepStrictEqual(session, {
			provider: 'gitlab',
			accessToken: 'gitlab-pat',
			accountLabel: 'GitLab',
		});
	});

	test('does not prompt for an unstored GitLab PAT in silent mode', async () => {
		let promptShown = false;
		const service = createService({
			showInputBox: async () => {
				promptShown = true;
				return 'gitlab-pat';
			},
		});

		const session = await service.getSession('gitlab', ['api'], { silent: true });

		assert.strictEqual(session, undefined);
		assert.strictEqual(promptShown, false);
	});
});
