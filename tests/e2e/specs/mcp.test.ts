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
				await git.commit('Initial commit', 'mcp.txt', 'one\n');
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test('registers the local MCP commands', async ({ vscode }) => {
	await expect(vscode.gitlens.hasCommand('gitlens.mcp.enable')).resolves.toBe(true);
	await expect(vscode.gitlens.hasCommand('gitlens.mcp.disable')).resolves.toBe(true);
	await expect(vscode.gitlens.hasCommand('gitlens.mcp.showConfiguration')).resolves.toBe(true);
});
