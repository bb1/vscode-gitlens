import { workspace } from 'vscode';
import { Git } from '@gitlens/git-cli/exec/git.js';
import { findGitPath } from '@gitlens/git-cli/exec/locator.js';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitProvider } from '@gitlens/git/providers/provider.js';
import type { GitResult, GitRunOptions } from '@gitlens/git/run.types.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { Container } from '../../container.js';
import type { GlGitProvider } from '../../git/gitProvider.js';
import { configuration } from '../../system/-webview/configuration.js';
import { loadChunk } from '../../system/-webview/loadChunk.js';
import type { TelemetryService } from '../../telemetry/telemetry.js';
import { GlCliGitProvider } from './git/cliGitProvider.js';
import { VslsGitProvider } from './git/vslsGitProvider.js';
import { LocalRepositoryLocationProvider } from './gk/localRepositoryLocationProvider.js';
import { LocalSharedGkStorageLocationProvider } from './gk/localSharedGkStorageLocationProvider.js';
import { LocalGkWorkspacesSharedStorageProvider } from './gk/localWorkspacesSharedStorageProvider.js';
import { getLocalMcpService } from './mcp/localMcpService.js';
import type { LocalMcpService } from './mcp/localMcpService.js';

export type { LocalMcpService } from './mcp/localMcpService.js';

// Lightweight Git instance for VSLS host — only used for Live Share command proxying.
// The primary Git execution path is inside CliGitProvider (created by LocalGitProvider).
let vslsGitInstance: Git | undefined;
function ensureVslsGit() {
	if (vslsGitInstance == null) {
		const locator = () => findGitPath(configuration.getCore('git.path'));
		vslsGitInstance = new Git(locator, {
			isTrusted: () => workspace.isTrusted,
		});
	}
	return vslsGitInstance;
}

export function git(
	_container: Container,
	options: GitRunOptions,
	...args: any[]
): Promise<GitResult<string | Buffer>> {
	return ensureVslsGit().run(options, ...args);
}

export async function getSupportedGitProviders(
	container: Container,
	cache: Cache,
	register: (provider: GitProvider, canHandle: (repoPath: string) => boolean) => UnifiedDisposable,
): Promise<GlGitProvider[]> {
	const providers: GlGitProvider[] = [
		new GlCliGitProvider(container, cache, register),
		new VslsGitProvider(container, cache, register),
	];

	if (configuration.get('virtualRepositories.enabled')) {
		const { getGitHubVirtualGitProvider } = await loadChunk(
			() => import(/* webpackChunkName: "hosting" */ '../../hosting/githubVirtualGitProviderRegistration.js'),
		);
		const provider = await getGitHubVirtualGitProvider(container, register, {
			enabled: true,
		});
		if (provider != null) {
			providers.push(provider);
		}
	}

	return providers;
}

export function getSharedGKStorageLocationProvider(
	container: Container,
): InstanceType<typeof LocalSharedGkStorageLocationProvider> {
	return new LocalSharedGkStorageLocationProvider(container);
}

export function getSupportedRepositoryLocationProvider(
	container: Container,
	sharedStorage: ConstructorParameters<typeof LocalRepositoryLocationProvider>[1],
): LocalRepositoryLocationProvider {
	return new LocalRepositoryLocationProvider(container, sharedStorage);
}

export function getSupportedWorkspacesStorageProvider(
	container: Container,
	sharedStorage: ConstructorParameters<typeof LocalGkWorkspacesSharedStorageProvider>[1],
): LocalGkWorkspacesSharedStorageProvider {
	return new LocalGkWorkspacesSharedStorageProvider(container, sharedStorage);
}

export function getMcpService(container: Container): LocalMcpService {
	return getLocalMcpService(container);
}

let _telemetryService: TelemetryService | undefined;
export function getTelementryService(): TelemetryService | undefined {
	return _telemetryService;
}

export function setTelemetryService(service: TelemetryService): void {
	_telemetryService = service;
}
