import * as assert from 'node:assert/strict';
import { AzureDevOpsRemoteProvider } from '@gitlens/git/remotes/azure-devops.js';
import { GitHubRemoteProvider } from '@gitlens/git/remotes/github.js';
import { getHostingProviderDescriptor } from '../remote.utils.js';

suite('getHostingProviderDescriptor', () => {
	test('maps a GitHub remote descriptor without accepting a caller-supplied domain', () => {
		const provider = new GitHubRemoteProvider('github.com', 'example-org/example-repo');

		assert.deepStrictEqual(getHostingProviderDescriptor(provider), {
			id: 'github',
			repository: { domain: 'github.com', owner: 'example-org', name: 'example-repo' },
		});
	});

	test('maps Azure project details from its remote descriptor', () => {
		const provider = new AzureDevOpsRemoteProvider('dev.azure.com', 'example-org/example/_git/example-repo');

		assert.deepStrictEqual(getHostingProviderDescriptor(provider), {
			id: 'azureDevOps',
			repository: {
				domain: 'dev.azure.com',
				owner: 'example-org',
				project: 'example',
				name: 'example-repo',
			},
		});
	});
});
