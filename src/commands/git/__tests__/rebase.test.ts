import * as assert from 'assert';
import { getManualRebaseModes } from '../rebase.utils.js';

suite('manual rebase modes', () => {
	test('offers regular and interactive rebase only', () => {
		assert.deepStrictEqual(getManualRebaseModes(true), [
			{ flags: [], picked: true },
			{ flags: ['--interactive'], picked: false },
		]);
	});
});
