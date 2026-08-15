import * as assert from 'assert';
import { getMinimapTargetIndex } from '../graphMinimap.js';

suite('getMinimapTargetIndex', () => {
	test('maps a minimap pointer to a loaded row index', () => {
		assert.strictEqual(getMinimapTargetIndex(75, 100, 200), 150);
	});

	test('clamps pointers outside the minimap to loaded row bounds', () => {
		assert.strictEqual(getMinimapTargetIndex(-1, 100, 200), 0);
		assert.strictEqual(getMinimapTargetIndex(100, 100, 200), 199);
	});

	test('returns zero when no rows are loaded or the minimap has no height', () => {
		assert.strictEqual(getMinimapTargetIndex(75, 100, 0), 0);
		assert.strictEqual(getMinimapTargetIndex(75, 0, 200), 0);
	});
});
