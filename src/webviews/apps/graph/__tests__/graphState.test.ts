import * as assert from 'assert';
import { applyGraphWorkspaceMessage, toggleGraphColumn } from '../graphState.js';

suite('Graph workspace state', () => {
	test('applies display preferences from a workspace message without mutating the prior state', () => {
		const state = {
			display: { columns: ['refs', 'message', 'author'], compact: false, minimap: true },
		};
		const display = { columns: ['refs', 'message'], compact: true, minimap: false };

		const result = applyGraphWorkspaceMessage(state, { type: 'graph/display', display: display });

		assert.deepStrictEqual(result, { display: display });
		assert.deepStrictEqual(state, {
			display: { columns: ['refs', 'message', 'author'], compact: false, minimap: true },
		});
		assert.notStrictEqual(result, state);
	});

	test('toggles a display column without mutating the preferences', () => {
		const display = { columns: ['refs', 'message', 'author'], compact: false, minimap: true };

		const result = toggleGraphColumn(display, 'author');

		assert.deepStrictEqual(result, { columns: ['refs', 'message'], compact: false, minimap: true });
		assert.deepStrictEqual(display, { columns: ['refs', 'message', 'author'], compact: false, minimap: true });
		assert.notStrictEqual(result, display);
	});
});
