import type { WorkspaceFolder } from 'vscode';
import { workspace } from 'vscode';
import type { GitProvider } from '@gitlens/git/providers/provider.js';
import type { GitHubRequestTransport } from '@gitlens/hosting-github/githubClient.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { Schemes } from '../constants.js';
import type { Container } from '../container.js';
import { getGitHubRemoteHub, getGitHubVirtualWorkspace, isGitHubRemoteHubUri } from './githubRemoteHub.js';
import type { GitHubRemoteHubProvider } from './githubRemoteHub.js';
import { GitHubVirtualGitProvider } from './githubVirtualGitProvider.js';

export async function getGitHubVirtualGitProvider(
	container: Container,
	register: (provider: GitProvider, canHandle: (repoPath: string) => boolean) => UnifiedDisposable,
	options: {
		enabled: boolean;
		workspaceFolders?: readonly WorkspaceFolder[];
		getRemoteHub?: GitHubRemoteHubProvider;
		request?: GitHubRequestTransport;
	},
): Promise<GitHubVirtualGitProvider | undefined> {
	if (!options.enabled) return undefined;

	const candidates = (options.workspaceFolders ?? workspace.workspaceFolders)?.filter(
		folder => folder.uri.scheme === Schemes.Virtual && isGitHubRemoteHubUri(folder.uri),
	);
	if (candidates == null || candidates.length === 0) return undefined;

	const remoteHub = await (options.getRemoteHub ?? getGitHubRemoteHub)();
	for (const folder of candidates) {
		if ((await getGitHubVirtualWorkspace(remoteHub, folder.uri)) != null) {
			return new GitHubVirtualGitProvider(container, register, options.request, () => Promise.resolve(remoteHub));
		}
	}

	return undefined;
}
