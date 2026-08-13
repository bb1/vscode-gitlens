import type { HostingProviderId, HostingResult } from '@gitlens/hosting-integrations/models.js';
import type { HostingProvider } from '@gitlens/hosting-integrations/provider.js';
import type { HostingAuthenticationService, HostingSession } from './models.js';

export type HostingProviderRegistration = {
	id: HostingProviderId;
	domain: string;
	scopes: readonly string[];
	create(session: HostingSession): HostingProvider;
};

export class HostingIntegrationService {
	readonly #providers = new Map<string, HostingProviderRegistration>();

	constructor(private readonly authenticationService: HostingAuthenticationService) {}

	register(provider: HostingProviderRegistration): void {
		this.#providers.set(getProviderKey(provider.id, provider.domain), provider);
	}

	get(provider: HostingProviderId, domain: string): HostingProvider | undefined {
		const registration = this.#providers.get(getProviderKey(provider, domain));
		if (registration == null) return undefined;

		return {
			id: registration.id,
			getPullRequests: repository => this.withProvider(registration, p => p.getPullRequests(repository)),
			createPullRequest: (repository, input) =>
				this.withProvider(registration, p => p.createPullRequest(repository, input)),
		};
	}

	private async withProvider<T>(
		registration: HostingProviderRegistration,
		operation: (provider: HostingProvider) => Promise<HostingResult<T>>,
	): Promise<HostingResult<T>> {
		const session = await this.authenticationService.getSession(registration.id, registration.scopes, {
			silent: true,
		});
		if (session == null) return { authenticationRequired: true };

		return operation(registration.create(session));
	}
}

function getProviderKey(provider: HostingProviderId, domain: string): string {
	return `${provider}:${domain.toLowerCase()}`;
}
