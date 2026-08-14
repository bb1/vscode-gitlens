import * as assert from 'node:assert/strict';
import { GitHubRemoteProvider } from '@gitlens/git/remotes/github.js';
import type { Container } from '../../container.js';
import { ConnectRemoteProviderCommand, DisconnectRemoteProviderCommand } from '../remoteProviders.js';

suite('ConnectRemoteProviderCommand', () => {
	test('connects the selected remote provider without reading a GitKraken account', async () => {
		const connections: unknown[][] = [];
		const container = {
			git: {
				getRepositoryService: () => ({
					remotes: {
						getRemotesWithProviders: async () => [
							{
								name: 'origin',
								provider: new GitHubRemoteProvider('github.com', 'gitkraken/vscode-gitlens'),
							},
						],
						setRemoteAsDefault: async () => {},
					},
				}),
			},
			hosting: {
				connect: async (...args: unknown[]) => {
					connections.push(args);
					return { provider: 'github', accessToken: 'token', accountLabel: 'octocat' };
				},
			},
		} as unknown as Container;

		const result = await createConnectCommand(container).execute({
			repoPath: '/repo',
			remote: 'origin',
		});

		assert.strictEqual(result, true);
		assert.deepStrictEqual(connections, [['github', 'github.com']]);
	});

	test('disconnects the selected remote provider without reading a GitKraken account', async () => {
		const disconnections: unknown[][] = [];
		const container = {
			git: {
				getRepositoryService: () => ({
					remotes: {
						getRemotesWithProviders: async () => [
							{
								name: 'origin',
								provider: new GitHubRemoteProvider('github.com', 'gitkraken/vscode-gitlens'),
							},
						],
					},
				}),
			},
			hosting: {
				disconnect: async (...args: unknown[]) => {
					disconnections.push(args);
				},
			},
		} as unknown as Container;

		await createDisconnectCommand(container).execute({ repoPath: '/repo', remote: 'origin' });

		assert.deepStrictEqual(disconnections, [['github', 'github.com']]);
	});
});

function createConnectCommand(container: Container): ConnectRemoteProviderCommand {
	return Object.assign(Object.create(ConnectRemoteProviderCommand.prototype), {
		container: container,
	}) as ConnectRemoteProviderCommand;
}

function createDisconnectCommand(container: Container): DisconnectRemoteProviderCommand {
	return Object.assign(Object.create(DisconnectRemoteProviderCommand.prototype), {
		container: container,
	}) as DisconnectRemoteProviderCommand;
}
