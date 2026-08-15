import { env, window } from 'vscode';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import type { Container } from '../container.js';
import { getHostingProviderDescriptor } from '../git/utils/-webview/remote.utils.js';
import { command } from '../system/-webview/command.js';
import { openUrl } from '../system/-webview/vscode/uris.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';

export interface OpenPullRequestOnRemoteCommandArgs {
	clipboard?: boolean;
	ref?: string;
	repoPath?: string;
	pr?: { url: string };
}

@command()
export class OpenPullRequestOnRemoteCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.openPullRequestOnRemote', 'gitlens.copyRemotePullRequestUrl']);
	}

	protected override preExecute(context: CommandContext, args?: OpenPullRequestOnRemoteCommandArgs): Promise<void> {
		if (context.type === 'viewItem' && context.node.is('pullrequest')) {
			args = {
				...args,
				pr: context.node.pullRequest != null ? { url: context.node.pullRequest.url } : undefined,
				clipboard: context.command === 'gitlens.copyRemotePullRequestUrl',
			};
		}

		return this.execute(args);
	}

	async execute(args?: OpenPullRequestOnRemoteCommandArgs): Promise<void> {
		if (args?.pr == null) {
			if (args?.repoPath == null || args?.ref == null) return;

			const remote = await this.container.git
				.getRepositoryService(args.repoPath)
				.remotes.getBestRemoteWithProvider();
			const descriptor = remote?.provider == null ? undefined : getHostingProviderDescriptor(remote.provider);
			if (descriptor == null) return;

			const provider = this.container.hosting.get(descriptor.id, descriptor.repository.domain);
			if (provider?.getPullRequestForCommit == null) return;

			let pr = await provider.getPullRequestForCommit(descriptor.repository, args.ref);
			if (pr != null && 'authenticationRequired' in pr) {
				const connect = { title: `Connect ${getHostingProviderName(descriptor.id)}` };
				if (
					(await window.showInformationMessage(
						`Connect ${getHostingProviderName(descriptor.id)} to open pull requests for this repository.`,
						connect,
					)) !== connect
				) {
					return;
				}

				if ((await this.container.hosting.connect(descriptor.id, descriptor.repository.domain)) == null) return;

				pr = await provider.getPullRequestForCommit(descriptor.repository, args.ref);
				if (pr != null && 'authenticationRequired' in pr) return;
			}

			if (pr == null) {
				void window.showInformationMessage(`No pull request associated with '${shortenRevision(args.ref)}'`);
				return;
			}

			args = { ...args };
			args.pr = pr;
		}

		if (args.clipboard) {
			await env.clipboard.writeText(args.pr.url);
		} else {
			void openUrl(args.pr.url);
		}
	}
}

function getHostingProviderName(provider: 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps'): string {
	switch (provider) {
		case 'github':
			return 'GitHub';
		case 'gitlab':
			return 'GitLab';
		case 'bitbucket':
			return 'Bitbucket';
		case 'azureDevOps':
			return 'Azure DevOps';
	}
}
