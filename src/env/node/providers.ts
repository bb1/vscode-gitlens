import { dirname, resolve } from 'path';
import { workspace } from 'vscode';
import { ClaudeCodeProvider } from '@gitlens/agents/providers/claudeCodeProvider.js';
import { Git } from '@gitlens/git-cli/exec/git.js';
import { findGitPath } from '@gitlens/git-cli/exec/locator.js';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitProvider } from '@gitlens/git/providers/provider.js';
import type { GitResult, GitRunOptions } from '@gitlens/git/run.types.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { normalizePath } from '@gitlens/utils/path.js';
import type { AgentSessionProvider } from '../../agents/provider.js';
import { tryOpenClaudeSession } from '../../agents/utils/-webview/claudeExtension.js';
import type { Container } from '../../container.js';
import type { GlGitProvider } from '../../git/gitProvider.js';
import { configuration } from '../../system/-webview/configuration.js';
import { loadChunk } from '../../system/-webview/loadChunk.js';
import type { TelemetryService } from '../../telemetry/telemetry.js';
import { GlCliGitProvider } from './git/cliGitProvider.js';
import { VslsGitProvider } from './git/vslsGitProvider.js';
import { GkCliService } from './gk/cli/gkCliService.js';
import { runCLICommand } from './gk/cli/utils.js';
import { LocalRepositoryLocationProvider } from './gk/localRepositoryLocationProvider.js';
import { LocalSharedGkStorageLocationProvider } from './gk/localSharedGkStorageLocationProvider.js';
import { LocalGkWorkspacesSharedStorageProvider } from './gk/localWorkspacesSharedStorageProvider.js';
import { getLocalMcpService } from './mcp/localMcpService.js';
import type { LocalMcpService } from './mcp/localMcpService.js';

export type { GkCliService } from './gk/cli/gkCliService.js';
export type GkMcpService = {
	isRegistrationAllowed: boolean;
	isRegistrationCapable: boolean;
	isRegistrationEnabled: boolean;
};
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

export function getGkCliService(container: Container): GkCliService {
	return new GkCliService(container);
}

export function getMcpService(container: Container): LocalMcpService {
	return getLocalMcpService(container);
}

export function getAgentSessionProviders(container: Container): AgentSessionProvider[] {
	return [
		new ClaudeCodeProvider({
			ipc: container.ipc,
			getActivityDecayMs: () =>
				getActivityDecayMs(configuration.get('graph.experimental.visualizations.activityDecay')),
			onSessionStarted: provider =>
				container.telemetry.sendEvent('agents/session/started', { 'agent.provider': provider }),
			onSessionEnded: provider =>
				container.telemetry.sendEvent('agents/session/ended', { 'agent.provider': provider }),
			onPermissionResolved: info =>
				container.telemetry.sendEvent('agents/permission/resolved', {
					'agent.provider': info.provider,
					'permission.tool': info.tool,
					'permission.decision': info.decision,
				}),
			onSyncDiscrepancy: info =>
				container.telemetry.sendEvent('agents/session/syncDiscrepancy', {
					'agent.provider': info.provider,
					'sync.discovered': info.discovered,
					'sync.missing': info.missing,
					'sync.polled': info.polled,
					'sync.tracked': info.tracked,
				}),
			onBranchAgentActivity: cwd => {
				const repo = container.git.getRepository(cwd);
				if (repo != null) {
					queueMicrotask(() => repo.git.branches.onCurrentBranchAgentActivity?.());
				}
			},
			runCLICommand: (args, opts) => runCLICommand(args, opts),
			openSessionInClaudeExtension: async sessionId => {
				// Shared editor → primaryEditor → sidebar fallback chain so the peer-side open
				// honors a specific session through the same rungs the local-window path uses.
				// Throws when all three rungs fail so the IPC handler can report
				// `{ opened: false }` to the initiating window.
				if (!(await tryOpenClaudeSession(sessionId))) {
					throw new Error('Claude Code extension did not respond to any open command');
				}
			},
			resolveGitInfo: async cwd => {
				// Fast path: cwd is in an already-loaded repo — fully synchronous, no shell calls.
				const repo = container.git.getRepository(cwd);
				if (repo != null) {
					return {
						repoRoot: repo.isWorktree && repo.commonPath ? repo.commonPath : repo.path,
						isWorktree: repo.isWorktree,
						worktreePath: repo.path,
					};
				}

				// Cold path: cwd is outside any loaded repo. validateRepo runs ONE combined
				// `git rev-parse` via the package's `config.getRepositoryInfo`, with no
				// repo-registration side effects. Routes through the same provider lookup
				// the rest of the host uses, so safe-path handling is consistent.
				const info = await container.git.validateRepo(cwd);
				if (!info.valid || !info.safe) return undefined;

				const isWorktree = info.commonGitDir != null && info.commonGitDir !== info.gitDir;
				return {
					repoRoot: normalizePath(
						isWorktree && info.commonGitDir ? dirname(resolve(cwd, info.commonGitDir)) : info.repoPath,
					),
					isWorktree: isWorktree,
					worktreePath: normalizePath(info.repoPath),
				};
			},
		}),
	];
}

function getActivityDecayMs(decay: string | undefined): number {
	switch (decay) {
		case '30s':
			return 30 * 1000;
		case '1m':
			return 60 * 1000;
		case '2m':
			return 2 * 60 * 1000;
		case '5m':
			return 5 * 60 * 1000;
		case '10m':
			return 10 * 60 * 1000;
		case '30m':
			return 30 * 60 * 1000;
		default:
			return 5 * 60 * 1000;
	}
}

let _telemetryService: TelemetryService | undefined;
export function getTelementryService(): TelemetryService | undefined {
	return _telemetryService;
}

export function setTelemetryService(service: TelemetryService): void {
	_telemetryService = service;
}
