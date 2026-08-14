import * as assert from 'node:assert/strict';
import * as sinon from 'sinon';
import type { InputBox } from 'vscode';
import { env, ExtensionMode, window } from 'vscode';
import type { Container } from '../../../../../container.js';
import { setUrlOpeningExtensionMode } from '../../../../../system/-webview/vscode/uris.js';
import { getOrPromptApiKey } from '../ai.utils.js';

suite('getOrPromptApiKey', () => {
	let sandbox: sinon.SinonSandbox;
	let openExternal: sinon.SinonStub;
	let input: InputBox;
	let triggerInfoButton: ((button: unknown) => void) | undefined;
	let hide: (() => void) | undefined;

	setup(() => {
		sandbox = sinon.createSandbox();
		openExternal = sandbox.stub(env, 'openExternal').resolves(true);
		input = {
			onDidHide: (listener: () => void) => {
				hide = listener;
				return { dispose: () => {} };
			},
			onDidChangeValue: () => ({ dispose: () => {} }),
			onDidAccept: () => ({ dispose: () => {} }),
			onDidTriggerButton: (listener: (button: unknown) => void) => {
				triggerInfoButton = listener;
				return { dispose: () => {} };
			},
			show: () => {
				triggerInfoButton?.(input.buttons[0]);
				hide?.();
			},
			dispose: () => {},
		} as unknown as InputBox;
		sandbox.stub(window, 'createInputBox').returns(input);
	});

	teardown(() => {
		sandbox.restore();
		setUrlOpeningExtensionMode(ExtensionMode.Production);
	});

	test('does not open provider info in extension test mode', async () => {
		setUrlOpeningExtensionMode(ExtensionMode.Test);

		await getOrPromptApiKey(
			{
				storage: { getSecret: async () => undefined },
			} as unknown as Container,
			{
				id: 'openai',
				name: 'OpenAI',
				requiresAccount: false,
				validator: () => true,
				url: 'https://platform.openai.com/api-keys',
			},
		);

		assert.strictEqual(openExternal.called, false);
	});
});
