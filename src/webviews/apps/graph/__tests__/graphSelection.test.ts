import * as assert from 'assert';
import { selectGraphRows } from '../graphSelection.js';

suite('selectGraphRows', () => {
	test('selects an inclusive shift range from the active row', () => {
		assert.deepStrictEqual(selectGraphRows(['a', 'b', 'c', 'd'], ['b'], 'd', { range: true }), ['b', 'c', 'd']);
	});

	test('toggles a row without discarding other selected rows', () => {
		assert.deepStrictEqual(selectGraphRows(['a', 'b'], ['a'], 'b', { toggle: true }), ['a', 'b']);
	});

	test('removes a toggled selected row without mutating the prior selection', () => {
		const selection = ['a', 'b'];

		const result = selectGraphRows(['a', 'b', 'c'], selection, 'b', { toggle: true });

		assert.deepStrictEqual(result, ['a']);
		assert.deepStrictEqual(selection, ['a', 'b']);
	});
});
