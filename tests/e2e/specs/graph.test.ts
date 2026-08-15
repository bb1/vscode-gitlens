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
	await expect(graph!.getByRole('listbox', { name: 'Commit graph' }).getByRole('option').first()).toBeVisible({
		timeout: 30000,
	});

	await vscode.gitlens.executeCommand('gitlens.showSettingsPage');
	const settings = await vscode.gitlens.getGitLensWebview('GitLens Settings', 'webviewPanel', 30000);
	expect(settings).not.toBeNull();
	await expect(settings!.locator('gl-settings-app')).toBeVisible({ timeout: 30000 });

	await vscode.gitlens.executeCommand('gitlens.showCommitDetailsView');
	const details = await vscode.gitlens.getGitLensWebview('Inspect', 'webviewView', 30000);
	expect(details).not.toBeNull();
	await expect(details!.locator('gl-commit-details-app')).toBeVisible({ timeout: 30000 });
});

test('shows the command deck, filters commits, and restores focus after closing the inspector', async ({ vscode }) => {
	await vscode.gitlens.showCommitGraphView();

	const graph = await vscode.gitlens.getCommitGraphWebview(30000);
	const commandDeck = graph.getByRole('region', { name: 'Commit graph commands' });
	const search = graph.getByRole('searchbox', { name: 'Filter commits' });
	const commits = graph.getByRole('listbox', { name: 'Commit graph' });
	const inspector = graph.getByRole('region', { name: 'Commit details' });
	const firstCommit = commits.getByRole('option').first();

	await expect(commandDeck).toBeVisible();
	await expect(search).toBeVisible();
	await expect(firstCommit).toBeVisible();
	await search.fill('Second graph commit');
	const secondCommit = commits.getByRole('option', { name: /Second graph commit/ });
	await expect(secondCommit).toBeVisible();

	await secondCommit.click();
	await expect(inspector).toBeVisible();
	await graph.getByRole('button', { name: 'Close commit details' }).focus();
	await vscode.page.keyboard.press('Escape');
	await expect(inspector).toBeHidden();
	await expect(secondCommit).toBeFocused();
});

test('shows commit rows and commands in the Graph panel', async ({ vscode }) => {
	await vscode.gitlens.executeCommand('gitlens.showGraph');

	const graph = await vscode.gitlens.getCommitGraphPanel(30000);
	await expect(graph.getByRole('region', { name: 'Commit graph commands' })).toBeVisible();
	await expect(graph.getByRole('listbox', { name: 'Commit graph' }).getByRole('option').first()).toBeVisible();
});

test('keeps command controls and commit rows usable in a narrow viewport', async ({ vscode }) => {
	await vscode.page.setViewportSize({ width: 640, height: 720 });
	await vscode.gitlens.showCommitGraphView();

	const graph = await vscode.gitlens.getCommitGraphWebview(30000);
	await expect(graph.getByRole('searchbox', { name: 'Filter commits' })).toBeVisible();
	await expect(graph.getByRole('complementary', { name: 'Repository references' })).toBeHidden();
	await expect(graph.getByRole('listbox', { name: 'Commit graph' }).getByRole('option').first()).toBeVisible();
});
