import * as assert from 'assert';
import { getWorktreesDisplay } from '../worktrees.js';

suite('worktrees display', () => {
	test('uses local-only labels', () => {
		assert.deepStrictEqual(getWorktreesDisplay(), {
			description: 'open, create, or delete worktrees',
			title: 'Worktrees',
		});
	});
});
