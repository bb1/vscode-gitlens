import * as assert from 'node:assert/strict';
import * as sinon from 'sinon';
import { env, ExtensionMode, Uri, window } from 'vscode';
import type { Container } from '../../container.js';
import { configuration } from '../../system/-webview/configuration.js';
import { setUrlOpeningExtensionMode } from '../../system/-webview/vscode/uris.js';
import { ExternalDiffCommand } from '../externalDiff.js';

suite('ExternalDiffCommand', () => {
	let sandbox: sinon.SinonSandbox;
	let openExternal: sinon.SinonStub;

	setup(() => {
		sandbox = sinon.createSandbox();
		openExternal = sandbox.stub(env, 'openExternal').resolves(true);
		sandbox.stub(configuration, 'get').returns(null as never);
		sandbox.stub(window, 'showWarningMessage').resolves('View Git Docs' as never);
	});

	teardown(() => {
		sandbox.restore();
		setUrlOpeningExtensionMode(ExtensionMode.Production);
	});

	test('does not open Git docs in extension test mode', async () => {
		setUrlOpeningExtensionMode(ExtensionMode.Test);

		await createCommand().execute({
			files: [{ uri: Uri.parse('file:///test'), staged: false }],
		});

		assert.strictEqual(openExternal.called, false);
	});
});

function createCommand(): ExternalDiffCommand {
	const container = {
		git: {
			getOrAddRepository: async () => ({
				git: {
					diff: { getDiffTool: async () => undefined },
				},
			}),
		},
	} as unknown as Container;

	return Object.assign(Object.create(ExternalDiffCommand.prototype), {
		container: container,
	}) as ExternalDiffCommand;
}
