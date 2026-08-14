import type { Cache } from '@gitlens/git/cache.js';
import type { GitProvider } from '@gitlens/git/providers/provider.js';
import type { GitResult, GitRunOptions } from '@gitlens/git/run.types.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { Container } from '../../container.js';
import type { GlGitProvider } from '../../git/gitProvider.js';
import { getGitHubVirtualGitProvider } from '../../hosting/githubVirtualGitProviderRegistration.js';
import type { TelemetryService } from '../../telemetry/telemetry.js';

export function git(
	_container: Container,
	_options: GitRunOptions,
	..._args: any[]
): Promise<GitResult<string | Buffer>> {
	// No git CLI exists in this environment, so nothing ran. Reporting a clean empty exit would tell callers
	// the command succeeded and found nothing — say it never started instead.
	return Promise.resolve({
		stdout: '',
		completion: {
			status: 'failed',
			reason: 'unstarted',
			error: new Error('git is unavailable in this environment'),
		},
	});
}

export function getSupportedGitProviders(
	container: Container,
	_cache: Cache,
	register: (provider: GitProvider, canHandle: (repoPath: string) => boolean) => UnifiedDisposable,
): Promise<GlGitProvider[]> {
	return getGitHubVirtualGitProvider(container, register, {
		enabled: true,
	}).then(provider => (provider == null ? [] : [provider]));
}

export function getSharedGKStorageLocationProvider(_container: Container): undefined {
	return undefined;
}

export function getSupportedRepositoryLocationProvider(_container: Container, _sharedStorage: unknown): undefined {
	return undefined;
}

export function getSupportedWorkspacesStorageProvider(_container: Container, _sharedStorage: unknown): undefined {
	return undefined;
}

export type LocalMcpService = never;

export function getMcpService(_container: Container | undefined): undefined {
	return undefined;
}

let _telemetryService: TelemetryService | undefined;
export function getTelementryService(): TelemetryService | undefined {
	return _telemetryService;
}

export function setTelemetryService(service: TelemetryService): void {
	_telemetryService = service;
}
