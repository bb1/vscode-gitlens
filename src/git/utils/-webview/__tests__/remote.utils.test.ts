import * as assert from 'node:assert/strict';
import { AzureDevOpsRemoteProvider } from '@gitlens/git/remotes/azure-devops.js';
import { GitHubRemoteProvider } from '@gitlens/git/remotes/github.js';
import { getHostingProviderDescriptor } from '../remote.utils.js';

suite('getHostingProviderDescriptor', () => {
	test('maps a GitHub remote descriptor without accepting a caller-supplied domain', () => {
		const provider = new GitHubRemoteProvider('github.com', 'gitkraken/vscode-gitlens');

		assert.deepStrictEqual(getHostingProviderDescriptor(provider), {
			id: 'github',
			repository: { domain: 'github.com', owner: 'gitkraken', name: 'vscode-gitlens' },
		});
	});

	test('maps Azure project details from its remote descriptor', () => {
		const provider = new AzureDevOpsRemoteProvider('dev.azure.com', 'gitkraken/gitlens/_git/vscode-gitlens');

		assert.deepStrictEqual(getHostingProviderDescriptor(provider), {
			id: 'azureDevOps',
			repository: {
				domain: 'dev.azure.com',
				owner: 'gitkraken',
				project: 'gitlens',
				name: 'vscode-gitlens',
			},
		});
	});
});
