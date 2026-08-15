import * as process from 'node:process';
import { test as base, createTmpDir, expect, GitFixture } from '../baseTest.js';

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				await git.commit('Initial graph commit', 'graph.txt', 'one\n');
				await git.commit('Second graph commit', 'graph.txt', 'two\n');
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test('shows local Graph, Settings, and Commit Details webviews', async ({ vscode }) => {
	await vscode.gitlens.executeCommand('gitlens.showGraphView');

	const graph = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
	expect(graph).not.toBeNull();
	await expect(graph!.getByRole('list').getByRole('option').first()).toBeVisible({ timeout: 30000 });

	await vscode.gitlens.executeCommand('gitlens.showSettingsPage');
	const settings = await vscode.gitlens.getGitLensWebview('GitLens Settings', 'webviewPanel', 30000);
	expect(settings).not.toBeNull();
	await expect(settings!.locator('gl-settings-app')).toBeVisible({ timeout: 30000 });

	await vscode.gitlens.executeCommand('gitlens.showCommitDetailsView');
	const details = await vscode.gitlens.getGitLensWebview('Inspect', 'webviewView', 30000);
	expect(details).not.toBeNull();
	await expect(details!.locator('gl-commit-details-app')).toBeVisible({ timeout: 30000 });
});
