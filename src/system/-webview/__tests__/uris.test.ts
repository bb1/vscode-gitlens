import * as assert from 'node:assert/strict';
import * as sinon from 'sinon';
import { env, ExtensionMode } from 'vscode';
import * as uris from '../vscode/uris.js';

suite('openUrl', () => {
	let openExternal: sinon.SinonStub;

	setup(() => {
		openExternal = sinon.stub(env, 'openExternal').resolves(true);
	});

	teardown(() => {
		openExternal.restore();
		uris.setUrlOpeningExtensionMode(ExtensionMode.Production);
	});

	test('blocks a dynamic issue URL without opening an external browser in extension test mode', async () => {
		uris.setUrlOpeningExtensionMode(ExtensionMode.Test);

		const opened = await uris.openUrl('https://github.example.test/org/repo/issues/123');

		assert.strictEqual(opened, false);
		assert.strictEqual(openExternal.called, false);
	});

	test('delegates a user URL to VS Code outside extension test mode', async () => {
		uris.setUrlOpeningExtensionMode(ExtensionMode.Production);

		const opened = await uris.openUrl('https://github.example.test/org/repo/issues/123');

		assert.strictEqual(opened, true);
		assert.deepStrictEqual(openExternal.args, [['https://github.example.test/org/repo/issues/123']]);
	});
});
