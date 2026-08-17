import type { HostingProviderId, HostingResult } from '@gitlens/hosting-integrations/models.js';
import type { HostingProvider } from '@gitlens/hosting-integrations/provider.js';
import { normalizeHostname } from '@gitlens/hosting-integrations/providers/shared.js';
import type { HostingAuthenticationService, HostingSession } from './models.js';

export type HostingProviderRegistration = {
	id: HostingProviderId;
	domain: string;
	scopes: readonly string[];
	create(session: HostingSession, domain: string): HostingProvider;
};

export class HostingIntegrationService {
	readonly #providers = new Map<string, HostingProviderRegistration>();

	constructor(private readonly authenticationService: HostingAuthenticationService) {}

	register(provider: HostingProviderRegistration): void {
		const domain = normalizeHostname(provider.id, provider.domain);
		this.#providers.set(getProviderKey(provider.id, domain), { ...provider, domain: domain });
	}

	get(provider: HostingProviderId, domain: string): HostingProvider | undefined {
		const registration = this.getRegistration(provider, domain);
		if (registration == null) return undefined;

		return {
			id: registration.id,
			getAccount: () =>
				this.withProvider(registration, p => {
					if (p.getAccount == null) throw new Error(`${p.id} does not support account lookup`);

					return p.getAccount();
				}),
			getPullRequestForCommit: (repository, commit) =>
				this.withProvider(registration, p => {
					if (p.getPullRequestForCommit == null) {
						throw new Error(`${p.id} does not support pull request lookup`);
					}

					return p.getPullRequestForCommit(repository, commit);
				}),
			getPullRequests: repository => this.withProvider(registration, p => p.getPullRequests(repository)),
			createPullRequest: (repository, input) =>
				this.withProvider(registration, p => p.createPullRequest(repository, input)),
		};
	}

	async connect(provider: HostingProviderId, domain: string): Promise<HostingSession | undefined> {
		const registration = this.getRegistration(provider, domain);
		if (registration == null) return undefined;

		return this.authenticationService.getSession(registration.id, registration.domain, registration.scopes, {
			interactive: true,
		});
	}

	async disconnect(provider: HostingProviderId, domain: string): Promise<void> {
		const registration = this.getRegistration(provider, domain);
		if (registration == null) return;

		await this.authenticationService.deleteSession(registration.id, registration.domain);
	}

	private async withProvider<T>(
		registration: HostingProviderRegistration,
		operation: (provider: HostingProvider) => Promise<HostingResult<T>>,
	): Promise<HostingResult<T>> {
		const session = await this.authenticationService.getSession(
			registration.id,
			registration.domain,
			registration.scopes,
			{ silent: true },
		);
		if (session == null) return { authenticationRequired: true };

		return operation(registration.create(session, registration.domain));
	}

	private getRegistration(provider: HostingProviderId, domain: string): HostingProviderRegistration | undefined {
		const normalizedDomain = normalizeHostname(provider, domain);
		const key = getProviderKey(provider, normalizedDomain);
		let registration = this.#providers.get(key);
		if (registration != null) return registration;

		if (provider !== 'github' && provider !== 'gitlab') return undefined;

		const defaultRegistration = this.#providers.get(getProviderKey(provider, getDefaultDomain(provider)));
		if (defaultRegistration == null) return undefined;

		registration = { ...defaultRegistration, domain: normalizedDomain };
		this.#providers.set(key, registration);
		return registration;
	}
}

function getProviderKey(provider: HostingProviderId, domain: string): string {
	return `${provider}:${domain}`;
}

function getDefaultDomain(provider: 'github' | 'gitlab'): string {
	return provider === 'github' ? 'github.com' : 'gitlab.com';
}
