import * as assert from 'node:assert';
import { HostingAuthenticationService } from '../authenticationService.js';

type HostingAuthenticationServiceDependencies = ConstructorParameters<typeof HostingAuthenticationService>[0];

function createService(dependencies: Partial<HostingAuthenticationServiceDependencies>): HostingAuthenticationService {
	return new HostingAuthenticationService({
		deleteSecret: async () => {},
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

		const session = await service.getSession('github', 'github.com', ['repo'], { silent: true });

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

		const session = await service.getSession('github', 'github.com', ['repo'], { interactive: true });

		assert.deepStrictEqual(session, {
			provider: 'github',
			accessToken: 'github-token',
			accountLabel: 'octocat',
		});
		assert.strictEqual(promptShown, false);
	});

	test('offers a GitHub PAT only after interactive VS Code authentication returns no session', async () => {
		let promptShown = false;
		const service = createService({
			showInputBox: async () => {
				promptShown = true;
				return 'github-pat';
			},
		});

		const session = await service.getSession('github', 'github.com', ['repo'], { interactive: true });

		assert.deepStrictEqual(session, {
			provider: 'github',
			accessToken: 'github-pat',
			accountLabel: 'GitHub',
		});
		assert.strictEqual(promptShown, true);
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

		const session = await service.getSession('github', 'github.com', ['repo'], { silent: true });

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

		const session = await service.getSession('github', 'github.com', ['repo'], { interactive: true });

		assert.deepStrictEqual(inputOptions, {
			title: 'Connect GitHub',
			prompt: 'Enter a GitHub personal access token',
			password: true,
		});
		assert.deepStrictEqual(stored, [['gitlens.hosting.auth:github:github.com', 'github-pat']]);
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

		const session = await service.getSession('github', 'github.com', ['repo'], { interactive: true });

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

		const session = await service.getSession('github', 'github.com', ['repo'], { interactive: true });

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
			service.getSession('github', 'github.com', ['repo'], { interactive: true }),
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
				assert.strictEqual(key, 'gitlens.hosting.auth:gitlab:gitlab.com');
				return 'gitlab-pat';
			},
			showInputBox: async () => {
				promptShown = true;
				return undefined;
			},
		});

		const session = await service.getSession('gitlab', 'gitlab.com', ['api'], { silent: true });

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

		const session = await service.getSession('gitlab', 'gitlab.com', ['api'], { interactive: true });

		assert.deepStrictEqual(inputOptions, {
			title: 'Connect GitLab',
			prompt: 'Enter a GitLab personal access token',
			password: true,
		});
		assert.deepStrictEqual(stored, [['gitlens.hosting.auth:gitlab:gitlab.com', 'gitlab-pat']]);
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

		const session = await service.getSession('gitlab', 'gitlab.com', ['api'], { silent: true });

		assert.strictEqual(session, undefined);
		assert.strictEqual(promptShown, false);
	});

	test('keeps GitHub Enterprise PATs separate by normalized domain', async () => {
		const secrets = new Map<string, string>();
		const inputs = ['github-one-token', 'github-two-token'];
		const service = createService({
			getSecret: async key => secrets.get(key),
			showInputBox: async () => inputs.shift(),
			storeSecret: async (key, value) => {
				secrets.set(key, value);
			},
		});
		const getSession = service.getSession.bind(service);

		const first = await getSession('github', 'GitHub.One.Example.Test', ['repo'], { interactive: true });
		const second = await getSession('github', 'github.two.example.test', ['repo'], { interactive: true });

		assert.strictEqual(first?.accessToken, 'github-one-token');
		assert.strictEqual(second?.accessToken, 'github-two-token');
		assert.deepStrictEqual(
			[...secrets],
			[
				['gitlens.hosting.auth:github:github.one.example.test', 'github-one-token'],
				['gitlens.hosting.auth:github:github.two.example.test', 'github-two-token'],
			],
		);
	});

	test('keeps self-managed GitLab PATs separate by normalized domain', async () => {
		const secrets = new Map<string, string>();
		const inputs = ['gitlab-one-token', 'gitlab-two-token'];
		const service = createService({
			getSecret: async key => secrets.get(key),
			showInputBox: async () => inputs.shift(),
			storeSecret: async (key, value) => {
				secrets.set(key, value);
			},
		});
		const getSession = service.getSession.bind(service);

		const first = await getSession('gitlab', 'GitLab.One.Example.Test', ['api'], { interactive: true });
		const second = await getSession('gitlab', 'gitlab.two.example.test', ['api'], { interactive: true });

		assert.strictEqual(first?.accessToken, 'gitlab-one-token');
		assert.strictEqual(second?.accessToken, 'gitlab-two-token');
		assert.deepStrictEqual(
			[...secrets],
			[
				['gitlens.hosting.auth:gitlab:gitlab.one.example.test', 'gitlab-one-token'],
				['gitlens.hosting.auth:gitlab:gitlab.two.example.test', 'gitlab-two-token'],
			],
		);
	});

	test('rejects an invalid domain before reading a PAT secret', async () => {
		let secretsRead = 0;
		const service = createService({
			getSecret: async () => {
				secretsRead++;
				return undefined;
			},
		});
		const getSession = service.getSession.bind(service);

		await assert.rejects(getSession('gitlab', 'https://gitlab.example.test', ['api'], { silent: true }));

		assert.strictEqual(secretsRead, 0);
	});
});
