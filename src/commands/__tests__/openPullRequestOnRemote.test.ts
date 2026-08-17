import * as assert from 'node:assert/strict';
import * as sinon from 'sinon';
import { window } from 'vscode';
import { GitHubRemoteProvider } from '@gitlens/git/remotes/github.js';
import type { Container } from '../../container.js';
import { OpenPullRequestOnRemoteCommand } from '../openPullRequestOnRemote.js';

suite('OpenPullRequestOnRemoteCommand', () => {
	test('opens a pull request resolved by the configured hosting provider', async () => {
		let pullRequestLookups = 0;
		const container = {
			git: {
				getRepositoryService: () => ({
					remotes: {
						getBestRemoteWithProvider: async () => ({
							provider: new GitHubRemoteProvider('github.com', 'example-org/example-repo'),
						}),
					},
				}),
			},
			hosting: {
				get: () => ({
					getPullRequestForCommit: async () => {
						pullRequestLookups++;
						return {
							id: '1',
							number: 1,
							title: 'Direct provider PR',
							url: 'https://github.com/example-org/example-repo/pull/1',
							state: 'open',
						};
					},
				}),
			},
		} as unknown as Container;

		await createCommand(container).execute({
			repoPath: '/repo',
			ref: 'abcdef1',
		});

		assert.strictEqual(pullRequestLookups, 1);
	});

	test('prompts to connect the named provider after authentication is required by a user command', async () => {
		const prompt = sinon.stub(window, 'showInformationMessage').resolves(undefined);
		const container = {
			git: {
				getRepositoryService: () => ({
					remotes: {
						getBestRemoteWithProvider: async () => ({
							provider: new GitHubRemoteProvider('github.com', 'example-org/example-repo'),
						}),
					},
				}),
			},
			hosting: {
				get: () => ({ getPullRequestForCommit: async () => ({ authenticationRequired: true }) }),
			},
		} as unknown as Container;

		try {
			await createCommand(container).execute({ repoPath: '/repo', ref: 'abcdef1' });

			assert.match(prompt.firstCall.args[0], /Connect GitHub/);
		} finally {
			prompt.restore();
		}
	});
});

function createCommand(container: Container): OpenPullRequestOnRemoteCommand {
	return Object.assign(Object.create(OpenPullRequestOnRemoteCommand.prototype), {
		container: container,
	}) as OpenPullRequestOnRemoteCommand;
}
