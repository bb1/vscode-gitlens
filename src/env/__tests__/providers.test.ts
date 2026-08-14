import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as sinon from 'sinon';
import { getSupportedGitProviders as getNodeSupportedGitProviders } from '../../env/node/providers.js';
import { configuration } from '../../system/-webview/configuration.js';

suite('GitHub virtual provider registration', () => {
	test('uses the cleanroom provider in browser without Plus source', async () => {
		const source = await readSource('src/env/browser/providers.ts');

		assert.match(source, /githubVirtualGitProvider/);
		assert.doesNotMatch(source, /\/plus\//);
	});

	test('does not load the cleanroom provider when virtual repositories are disabled in Node', async () => {
		const source = await readSource('src/env/node/providers.ts');
		const disabledGate = source.indexOf("if (configuration.get('virtualRepositories.enabled'))");
		const cleanroomProvider = source.indexOf('githubVirtualGitProvider');

		assert.ok(disabledGate >= 0);
		assert.ok(cleanroomProvider > disabledGate);
		assert.doesNotMatch(
			source.slice(disabledGate, source.indexOf('\n\treturn providers;', disabledGate)),
			/\/plus\//,
		);

		const get = sinon.stub(configuration, 'get');
		get.withArgs('virtualRepositories.enabled').returns(false);
		try {
			const providers = await getNodeSupportedGitProviders(undefined as never, undefined as never, () => ({
				dispose: () => {},
				[Symbol.dispose]: () => {},
			}));

			assert.equal(providers.length, 2);
			providers.forEach(provider => provider.dispose());
		} finally {
			get.restore();
		}
	});
});

function readSource(path: string): Promise<string> {
	return readFile(resolve(process.cwd(), path), 'utf8');
}
