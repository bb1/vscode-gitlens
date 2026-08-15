import { command } from '../system/-webview/command.js';
import { openUrl } from '../system/-webview/vscode/uris.js';
import { GlCommandBase } from './commandBase.js';

@command()
export class ReportIssueCommand extends GlCommandBase {
	constructor() {
		super('gitlens.reportIssue');
	}

	execute(): void {
		void openUrl('https://github.com/bb1/vscode-gitlens/issues/new/choose');
	}
}

@command()
export class ShareFeedbackCommand extends GlCommandBase {
	constructor() {
		super('gitlens.shareFeedback');
	}

	execute(): void {
		void openUrl('https://github.com/bb1/vscode-gitlens/discussions');
	}
}
