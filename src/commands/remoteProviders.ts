import type { GitCommit } from '@gitlens/git/models/commit.js';
import { GitRemote } from '@gitlens/git/models/remote.js';
import { first } from '@gitlens/utils/iterable.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import type { GlRepository } from '../git/models/repository.js';
import { getHostingProviderDescriptor } from '../git/utils/-webview/remote.utils.js';
import { showRepositoryPicker } from '../quickpicks/repositoryPicker.js';
import { command } from '../system/-webview/command.js';
import { createMarkdownCommandLink } from '../system/commands.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';
import { isCommandContextViewNodeHasRemote } from './commandContext.utils.js';

export interface ConnectRemoteProviderCommandArgs {
	remote: string;
	repoPath: string;
	source?: Source;
}

@command()
export class ConnectRemoteProviderCommand extends GlCommandBase {
	static createMarkdownCommandLink(args: ConnectRemoteProviderCommandArgs): string;
	static createMarkdownCommandLink(remote: GitRemote, source: Source): string;
	static createMarkdownCommandLink(
		argsOrRemote: ConnectRemoteProviderCommandArgs | GitRemote,
		source?: Source,
	): string {
		let args: ConnectRemoteProviderCommandArgs | GitCommit;
		if (GitRemote.is(argsOrRemote)) {
			args = {
				remote: argsOrRemote.name,
				repoPath: argsOrRemote.repoPath,
				source: source,
			};
		} else {
			args = argsOrRemote;
		}

		return createMarkdownCommandLink<ConnectRemoteProviderCommandArgs>('gitlens.connectRemoteProvider', args);
	}

	constructor(private readonly container: Container) {
		super(['gitlens.connectRemoteProvider', 'gitlens.connectRemoteProvider:views']);
	}

	protected override preExecute(context: CommandContext, args?: ConnectRemoteProviderCommandArgs): Promise<any> {
		if (isCommandContextViewNodeHasRemote(context)) {
			args = { ...args, remote: context.node.remote.name, repoPath: context.node.remote.repoPath };
		}

		return this.execute(args);
	}

	async execute(args?: ConnectRemoteProviderCommandArgs): Promise<any> {
		let remote: GitRemote | undefined;
		let remotes: GitRemote[] | undefined;
		let repoPath;
		if (args?.repoPath == null) {
			const repos = new Map<GlRepository, GitRemote>();

			for (const repo of this.container.git.openRepositories) {
				const remote = await this.container.git
					.getRepositoryService(repo.path)
					.remotes.getBestRemoteWithProvider();
				if (remote?.provider != null) {
					repos.set(repo, remote);
				}
			}

			if (repos.size === 0) return false;

			if (repos.size === 1) {
				let repo;
				[repo, remote] = first(repos)!;
				repoPath = repo.path;
			} else {
				const pick = await showRepositoryPicker(
					this.container,
					undefined,
					'Choose which repository to connect to the remote provider',
					[...repos.keys()],
				);
				if (pick == null) return undefined;

				repoPath = pick.path;
				remote = repos.get(pick)!;
			}
		} else if (args?.remote == null) {
			repoPath = args.repoPath;

			remote = await this.container.git.getRepositoryService(repoPath).remotes.getBestRemoteWithProvider();
			if (remote == null) return false;
		} else {
			repoPath = args.repoPath;

			remotes = await this.container.git.getRepositoryService(repoPath).remotes.getRemotesWithProviders();
			remote = remotes.find(r => r.name === args.remote);
			if (remote?.provider == null) return false;
		}

		if (remote?.provider == null) return false;

		const descriptor = getHostingProviderDescriptor(remote.provider);
		if (descriptor == null) return false;

		const connected = (await this.container.hosting.connect(descriptor.id, descriptor.repository.domain)) != null;

		if (connected) {
			const knownRemotes =
				remotes ?? (await this.container.git.getRepositoryService(repoPath).remotes.getRemotesWithProviders());
			if (!knownRemotes.some((r: GitRemote) => r.default)) {
				await this.container.git
					.getRepositoryService(remote.repoPath)
					.remotes.setRemoteAsDefault(remote.name, true);
			}
		}
		return connected;
	}
}

export interface DisconnectRemoteProviderCommandArgs {
	remote: string;
	repoPath: string;
}

@command()
export class DisconnectRemoteProviderCommand extends GlCommandBase {
	static createMarkdownCommandLink(args: DisconnectRemoteProviderCommandArgs): string;
	static createMarkdownCommandLink(remote: GitRemote): string;
	static createMarkdownCommandLink(argsOrRemote: DisconnectRemoteProviderCommandArgs | GitRemote): string {
		let args: DisconnectRemoteProviderCommandArgs | GitCommit;
		if (GitRemote.is(argsOrRemote)) {
			args = {
				remote: argsOrRemote.name,
				repoPath: argsOrRemote.repoPath,
			};
		} else {
			args = argsOrRemote;
		}

		return createMarkdownCommandLink<DisconnectRemoteProviderCommandArgs>('gitlens.disconnectRemoteProvider', args);
	}

	constructor(private readonly container: Container) {
		super(['gitlens.disconnectRemoteProvider', 'gitlens.disconnectRemoteProvider:views']);
	}

	protected override preExecute(context: CommandContext, args?: DisconnectRemoteProviderCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasRemote(context)) {
			args = { ...args, remote: context.node.remote.name, repoPath: context.node.remote.repoPath };
		}

		return this.execute(args);
	}

	async execute(args?: DisconnectRemoteProviderCommandArgs): Promise<void> {
		if (args?.repoPath == null || args.remote == null) return;

		const remote = (
			await this.container.git.getRepositoryService(args.repoPath).remotes.getRemotesWithProviders()
		).find(r => r.name === args.remote);
		if (remote?.provider == null) return;

		const descriptor = getHostingProviderDescriptor(remote.provider);
		if (descriptor == null) return;

		await this.container.hosting.disconnect(descriptor.id, descriptor.repository.domain);
	}
}
