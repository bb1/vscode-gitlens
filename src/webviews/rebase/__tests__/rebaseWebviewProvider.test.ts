import * as assert from 'assert';
// Imported first: the command decorator registry must initialize before dependent modules.
import '../../../container.js';
import * as sinon from 'sinon';
import type { TextDocument } from 'vscode';
import { Uri, window, workspace } from 'vscode';
import type { Container } from '../../../container.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import type { WebviewHost } from '../../webviewProvider.js';
import { RebaseWebviewProvider } from '../rebaseWebviewProvider.js';

suite('RebaseWebviewProvider', () => {
	test('preserves the todo document when aborting the paused operation fails', async () => {
		const disposable = { dispose: () => {} };
		const save = sinon.stub().resolves(true);
		const document = {
			lineCount: 1,
			save: save,
			uri: Uri.file('/repo/.git/rebase-merge/git-rebase-todo'),
		} as unknown as TextDocument;
		const svc = {
			pausedOps: { abortPausedOperation: sinon.stub().rejects(new Error('abort failed')) },
		} as unknown as GitRepositoryService;
		const container = {
			git: {
				getRepository: () => undefined,
				getRepositoryService: () => svc,
			},
			onboarding: { onDidChange: () => disposable },
		} as unknown as Container;
		const host = { sendTelemetryEvent: () => {} } as unknown as WebviewHost<'gitlens.rebase'>;
		const applyEdit = sinon.stub(workspace, 'applyEdit').resolves(true);
		const showErrorMessage = sinon.stub(window, 'showErrorMessage').resolves(undefined);
		const provider = new RebaseWebviewProvider(container, host, document, '/repo');

		try {
			await provider['onAbort']();

			assert.strictEqual(applyEdit.called, false);
			assert.strictEqual(save.called, false);
			assert.ok(showErrorMessage.calledOnce);
		} finally {
			provider.dispose();
			showErrorMessage.restore();
			applyEdit.restore();
		}
	});
});
