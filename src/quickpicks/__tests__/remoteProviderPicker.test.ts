import * as assert from 'node:assert/strict';
import * as sinon from 'sinon';
import { env, ExtensionMode } from 'vscode';
import { setUrlOpeningExtensionMode } from '../../system/-webview/vscode/uris.js';
import { ConfigureCustomRemoteProviderCommandQuickPickItem } from '../remoteProviderPicker.js';

suite('ConfigureCustomRemoteProviderCommandQuickPickItem', () => {
	let openExternal: sinon.SinonStub;

	setup(() => {
		openExternal = sinon.stub(env, 'openExternal').resolves(true);
	});

	teardown(() => {
		openExternal.restore();
		setUrlOpeningExtensionMode(ExtensionMode.Production);
	});

	test('does not open remote provider help in extension test mode', async () => {
		setUrlOpeningExtensionMode(ExtensionMode.Test);

		await new ConfigureCustomRemoteProviderCommandQuickPickItem().execute();

		assert.strictEqual(openExternal.called, false);
	});

	test('opens remote provider help in production mode', async () => {
		setUrlOpeningExtensionMode(ExtensionMode.Production);

		await new ConfigureCustomRemoteProviderCommandQuickPickItem().execute();

		assert.deepStrictEqual(openExternal.args, [
			['https://help.gitkraken.com/gitlens/gitlens-settings/#remote-provider-integration-settings'],
		]);
	});
});
