import type { SecretKeys } from '../constants.storage.js';
import type { HostingAuthenticationMode, HostingProviderId, HostingSession } from './models.js';

type AuthenticationSession = {
	accessToken: string;
	account: { label: string };
};

type AuthenticationSessionOptions = { silent: true } | { createIfNone: true };

export type HostingAuthenticationServiceDependencies = {
	getAuthenticationSession(
		provider: 'github',
		scopes: readonly string[],
		options: AuthenticationSessionOptions,
	): PromiseLike<AuthenticationSession | undefined>;
	getSecret(key: SecretKeys): PromiseLike<string | undefined>;
	showInputBox(options: { password: boolean; prompt: string; title: string }): PromiseLike<string | undefined>;
	storeSecret(key: SecretKeys, value: string): PromiseLike<void>;
};

const providerLabels: Record<HostingProviderId, string> = {
	github: 'GitHub',
	gitlab: 'GitLab',
	bitbucket: 'Bitbucket',
	azureDevOps: 'Azure DevOps',
};

export class HostingAuthenticationService {
	constructor(private readonly dependencies: HostingAuthenticationServiceDependencies) {}

	async getSession(
		provider: HostingProviderId,
		scopes: readonly string[],
		mode: HostingAuthenticationMode,
	): Promise<HostingSession | undefined> {
		if (provider !== 'github') {
			return this.getTokenSession(provider, mode);
		}

		try {
			const session = await this.dependencies.getAuthenticationSession(
				'github',
				scopes,
				'silent' in mode ? { silent: true } : { createIfNone: true },
			);
			if (session != null) {
				return { provider: provider, accessToken: session.accessToken, accountLabel: session.account.label };
			}

			return undefined;
		} catch (ex) {
			if (!isAuthenticationProviderUnavailable(ex)) throw ex;
		}

		return this.getTokenSession(provider, mode);
	}

	private async getTokenSession(
		provider: HostingProviderId,
		mode: HostingAuthenticationMode,
	): Promise<HostingSession | undefined> {
		const key = `gitlens.hosting.auth:${provider}` as const;
		const token = await this.dependencies.getSecret(key);
		if (token != null) {
			return { provider: provider, accessToken: token, accountLabel: providerLabels[provider] };
		}

		if ('silent' in mode) return undefined;

		const label = providerLabels[provider];
		const accessToken = await this.dependencies.showInputBox({
			title: `Connect ${label}`,
			prompt: `Enter a ${label} personal access token`,
			password: true,
		});
		if (accessToken == null) return undefined;

		await this.dependencies.storeSecret(key, accessToken);

		return { provider: provider, accessToken: accessToken, accountLabel: label };
	}
}

function isAuthenticationProviderUnavailable(ex: unknown): boolean {
	return (
		ex === 'Timed out waiting for authentication provider to register' ||
		(ex instanceof Error && ex.message === 'Timed out waiting for authentication provider to register')
	);
}
