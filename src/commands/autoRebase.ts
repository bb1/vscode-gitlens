import { Logger } from '@gitlens/utils/logger.js';
import type { Source, Sources } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { showGenericErrorMessage } from '../messages.js';
import { takeoverAutoRebaseRun, undoWithConfirmation } from '../plus/coretools/conflict/autoRebaseProgress.js';
import { ensurePaidPlan } from '../plus/gk/utils/-webview/plus.utils.js';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';
import { isCommandContextViewNodeHasRepoPath, isCommandContextViewNodeHasRepository } from './commandContext.utils.js';

export interface ContinueRebaseWithAiCommandArgs {
	repoPath?: string;
	source?: Sources;
}

/**
 * Takes over an already-paused rebase and automates its remaining steps with AI conflict
 * resolution, and the way to re-engage
 * automation after an escalation was resolved manually.
 */
@command()
export class ContinueRebaseWithAiCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.ai.continueRebase', 'gitlens.ai.continueRebase:views']);
	}

	protected override preExecute(context: CommandContext, args?: ContinueRebaseWithAiCommandArgs): Promise<void> {
		args = { ...args };

		if (isCommandContextViewNodeHasRepository(context)) {
			args.repoPath ??= context.node.repo.path;
			args.source ??= 'view';
		} else if (isCommandContextViewNodeHasRepoPath(context)) {
			args.repoPath ??= context.node.repoPath;
			args.source ??= 'view';
		}

		return this.execute(args);
	}

	async execute(args?: ContinueRebaseWithAiCommandArgs): Promise<void> {
		const source: Source = { source: args?.source ?? 'commandPalette' };
		if (!(await ensurePaidPlan(this.container, 'Continue Automatic Rebase is a Pro feature.', source))) {
			return;
		}

		try {
			let repoPath = args?.repoPath;
			if (repoPath == null) {
				const repo = await getRepositoryOrShowPicker(this.container, 'Continue Automatic Rebase');
				repoPath = repo?.path;
			}
			if (repoPath == null) return;

			await takeoverAutoRebaseRun(this.container, this.container.git.getRepositoryService(repoPath), source);
		} catch (ex) {
			Logger.error(ex, 'ContinueRebaseWithAiCommand', 'execute');
			void showGenericErrorMessage('Unable to continue the rebase');
		}
	}
}

export interface UndoAutoRebaseCommandArgs {
	repoPath?: string;
}

/**
 * Rolls a completed automatic rebase back to its pre-rebase state (validated — refuses if the
 * branch has moved). Palette-hidden: invoked from the completion toast / summary flows, and kept
 * as a command so the stored undo record stays reachable after a webview teardown or reload.
 */
@command()
export class UndoAutoRebaseCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.ai.autoRebase.undo');
	}

	async execute(args?: UndoAutoRebaseCommandArgs): Promise<void> {
		try {
			let repoPath = args?.repoPath;
			if (repoPath == null) {
				const repo = await getRepositoryOrShowPicker(this.container, 'Undo Automatic Rebase');
				repoPath = repo?.path;
			}
			if (repoPath == null) return;

			// Works with or without an in-memory session — the stored record (which survives a
			// reload) is what a validated undo actually needs.
			const record = this.container.autoRebase.getStoredUndo(repoPath);
			if (record == null) {
				void showGenericErrorMessage('There is no automatic rebase to undo');
				return;
			}

			await undoWithConfirmation(this.container, repoPath, record.branch);
		} catch (ex) {
			Logger.error(ex, 'UndoAutoRebaseCommand', 'execute');
			void showGenericErrorMessage('Unable to undo the automatic rebase');
		}
	}
}
