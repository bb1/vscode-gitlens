import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

suite('Offline runtime boundaries', () => {
	test('does not construct removed product services during activation', async () => {
		const container = await readSource('src/container.ts');
		const extension = await readSource('src/extension.ts');

		for (const source of [container, extension]) {
			assert.doesNotMatch(
				source,
				/new (?:AccountAuthenticationProvider|ServerConnection|SubscriptionService|ProductConfigProvider|OrganizationService|UrlsProvider|AIProviderService|AgentStatusService|GkCliService|GkMcpService)\b/,
			);
		}
	});

	test('keeps local MCP activation without remote CLI registration', async () => {
		const container = await readSource('src/container.ts');
		const nodeProviders = await readSource('src/env/node/providers.ts');
		const browserProviders = await readSource('src/env/browser/providers.ts');

		assert.match(container, /getMcpService\(this\)/);
		assert.match(nodeProviders, /getLocalMcpService/);
		assert.doesNotMatch(nodeProviders, /GkCliService|GkMcpService|getGkCliService|getGkMcpService/);
		assert.doesNotMatch(browserProviders, /GkCliService|GkMcpService|getGkCliService|getGkMcpService/);
	});
});

function readSource(path: string): Promise<string> {
	return readFile(resolve(process.cwd(), path), 'utf8');
}
