import * as assert from 'node:assert/strict';
import { HostingIntegrationService } from '../hostingIntegrationService.js';

suite('HostingIntegrationService', () => {
	test('returns registered provider metadata without requesting authentication', () => {
		let authenticationRequests = 0;
		const service = new HostingIntegrationService({
			getSession: async () => {
				authenticationRequests++;
				return undefined;
			},
		});

		service.register({
			id: 'github',
			domain: 'github.com',
			scopes: ['repo'],
			create: () => {
				throw new Error('Provider must not be created while reading metadata');
			},
		});

		const provider = service.get('github', 'github.com');

		assert.strictEqual(provider?.id, 'github');
		assert.strictEqual(authenticationRequests, 0);
	});

	test('silently authenticates pull request reads before returning authenticationRequired', async () => {
		const authenticationRequests: unknown[][] = [];
		const service = new HostingIntegrationService({
			getSession: async (...args) => {
				authenticationRequests.push(args);
				return undefined;
			},
		});

		service.register({
			id: 'github',
			domain: 'github.com',
			scopes: ['repo'],
			create: () => {
				throw new Error('Provider must not be created without a session');
			},
		});

		const provider = service.get('github', 'github.com');
		assert.ok(provider);

		const result = await provider.getPullRequests({
			owner: 'gitkraken',
			name: 'vscode-gitlens',
			domain: 'github.com',
		});

		assert.deepStrictEqual(authenticationRequests, [['github', ['repo'], { silent: true }]]);
		assert.deepStrictEqual(result, { authenticationRequired: true });
	});
});
