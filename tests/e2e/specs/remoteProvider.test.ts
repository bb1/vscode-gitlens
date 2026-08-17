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
				await git.commit('Initial commit', 'remote.txt', 'one\n');
				await git.addRemote('origin', 'https://github.com/example-org/example-repo.git');
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test('connects and disconnects a direct hosting provider', async ({ vscode }) => {
	await expect(vscode.gitlens.hasCommand('gitlens.connectRemoteProvider')).resolves.toBe(true);
	await expect(vscode.gitlens.hasCommand('gitlens.disconnectRemoteProvider')).resolves.toBe(true);
});
