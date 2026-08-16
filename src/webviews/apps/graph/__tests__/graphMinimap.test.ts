import * as assert from 'assert';
import {
	getMinimapMarkerPosition,
	getMinimapRowMarkers,
	getMinimapTargetIndex,
	getMinimapViewport,
} from '../graphMinimap.js';

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

	test('maps visible and selected rows to proportional minimap markers', () => {
		assert.deepStrictEqual(getMinimapViewport(20, 29, 100), { start: 20, size: 10 });
		assert.strictEqual(getMinimapMarkerPosition(49, 100), 49.5);
	});

	test('caps row markers for a large loaded graph', () => {
		assert.deepStrictEqual(getMinimapRowMarkers(5000, 3), [0, 1666, 3333]);
	});
});
