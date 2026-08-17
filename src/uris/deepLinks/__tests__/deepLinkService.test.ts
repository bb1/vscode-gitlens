import * as assert from 'assert';
// Imported first: the command decorator registry must initialize before dependent modules.
import '../../../container.js';
import * as sinon from 'sinon';
import { commands, window } from 'vscode';
import type { Container } from '../../../container.js';
import { DeepLinkServiceAction, DeepLinkServiceState, DeepLinkType } from '../deepLink.js';
import { DeepLinkService } from '../deepLinkService.js';

suite('DeepLinkService', () => {
	test('reports cloud patch links as unsupported without executing the removed command', async () => {
		const disposable = { dispose: () => {} };
		const container = {
			storage: {
				getSecret: sinon.stub().resolves(undefined),
				onDidChangeSecrets: () => disposable,
			},
			uri: {
				onDidReceiveUri: () => disposable,
			},
		} as unknown as Container;
		const showErrorMessage = sinon.stub(window, 'showErrorMessage').resolves(undefined);
		const executeCommand = sinon.stub(commands, 'executeCommand').resolves(undefined);
		const service = new DeepLinkService(container);

		try {
			service['_context'] = {
				state: DeepLinkServiceState.TypeMatch,
				targetId: 'cloud-patch-id',
				targetType: DeepLinkType.Draft,
				url: 'gitlens://gitlens/link/drafts/cloud-patch-id',
			};

			await service['processDeepLink'](DeepLinkServiceAction.LinkIsDraftType, false);

			assert.strictEqual(showErrorMessage.callCount, 1);
			assert.strictEqual(showErrorMessage.firstCall.firstArg, 'Unable to resolve link');
			assert.strictEqual(executeCommand.calledWith('gitlens.openCloudPatch'), false);
		} finally {
			service.dispose();
			executeCommand.restore();
			showErrorMessage.restore();
		}
	});
});
