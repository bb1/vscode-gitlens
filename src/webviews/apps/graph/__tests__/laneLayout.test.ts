import * as assert from 'assert';
import { layoutGraphRows } from '../laneLayout.js';

suite('layoutGraphRows', () => {
	test('keeps a linear history in lane zero', () => {
		const layout = layoutGraphRows([
			{ sha: 'top', parents: ['middle'] },
			{ sha: 'middle', parents: ['root'] },
			{ sha: 'root', parents: [] },
		]);

		assert.deepStrictEqual(layout, [
			{ sha: 'top', lane: 0, edges: [{ from: 0, to: 0, parent: 'middle' }] },
			{ sha: 'middle', lane: 0, edges: [{ from: 0, to: 0, parent: 'root' }] },
			{ sha: 'root', lane: 0, edges: [] },
		]);
	});

	test('keeps a fork parent in its own lane until it is visited', () => {
		const layout = layoutGraphRows([
			{ sha: 'top', parents: ['trunk', 'topic'] },
			{ sha: 'trunk', parents: ['base'] },
			{ sha: 'topic', parents: ['base'] },
			{ sha: 'base', parents: [] },
		]);

		assert.deepStrictEqual(layout, [
			{
				sha: 'top',
				lane: 0,
				edges: [
					{ from: 0, to: 0, parent: 'trunk' },
					{ from: 0, to: 1, parent: 'topic' },
				],
			},
			{ sha: 'trunk', lane: 0, edges: [{ from: 0, to: 0, parent: 'base' }] },
			{ sha: 'topic', lane: 1, edges: [{ from: 1, to: 0, parent: 'base' }] },
			{ sha: 'base', lane: 0, edges: [] },
		]);
	});

	test('merges two live lanes into its first parent lane', () => {
		const layout = layoutGraphRows([
			{ sha: 'tip', parents: ['merge'] },
			{ sha: 'merge', parents: ['main', 'topic'] },
			{ sha: 'main', parents: ['base'] },
			{ sha: 'topic', parents: ['base'] },
			{ sha: 'base', parents: [] },
		]);

		assert.deepStrictEqual(layout, [
			{ sha: 'tip', lane: 0, edges: [{ from: 0, to: 0, parent: 'merge' }] },
			{
				sha: 'merge',
				lane: 0,
				edges: [
					{ from: 0, to: 0, parent: 'main' },
					{ from: 0, to: 1, parent: 'topic' },
				],
			},
			{ sha: 'main', lane: 0, edges: [{ from: 0, to: 0, parent: 'base' }] },
			{ sha: 'topic', lane: 1, edges: [{ from: 1, to: 0, parent: 'base' }] },
			{ sha: 'base', lane: 0, edges: [] },
		]);
	});

	test('allocates a lane for every octopus parent in parent order', () => {
		const layout = layoutGraphRows([
			{ sha: 'octopus', parents: ['alpha', 'beta', 'gamma'] },
			{ sha: 'alpha', parents: [] },
			{ sha: 'beta', parents: [] },
			{ sha: 'gamma', parents: [] },
		]);

		assert.deepStrictEqual(layout, [
			{
				sha: 'octopus',
				lane: 0,
				edges: [
					{ from: 0, to: 0, parent: 'alpha' },
					{ from: 0, to: 1, parent: 'beta' },
					{ from: 0, to: 2, parent: 'gamma' },
				],
			},
			{ sha: 'alpha', lane: 0, edges: [] },
			{ sha: 'beta', lane: 1, edges: [] },
			{ sha: 'gamma', lane: 2, edges: [] },
		]);
	});

	test('preserves unresolved parent lanes across a pagination boundary', () => {
		const layout = layoutGraphRows(
			[
				{ sha: 'topic', parents: ['base'] },
				{ sha: 'base', parents: [] },
			],
			new Map([
				['topic', 1],
				['base', 0],
			]),
		);

		assert.deepStrictEqual(layout, [
			{ sha: 'topic', lane: 1, edges: [{ from: 1, to: 0, parent: 'base' }] },
			{ sha: 'base', lane: 0, edges: [] },
		]);
	});

	test('rejects negative seed lanes', () => {
		assert.throws(
			() => layoutGraphRows([], new Map([['pending', -1]])),
			error =>
				error instanceof TypeError &&
				error.message === 'Invalid seed lane for "pending": lanes must be unique non-negative safe integers',
		);
	});

	test('rejects fractional seed lanes', () => {
		assert.throws(
			() => layoutGraphRows([], new Map([['pending', 0.5]])),
			error =>
				error instanceof TypeError &&
				error.message === 'Invalid seed lane for "pending": lanes must be unique non-negative safe integers',
		);
	});

	test('rejects unsafe seed lanes', () => {
		assert.throws(
			() => layoutGraphRows([], new Map([['pending', Number.MAX_SAFE_INTEGER + 1]])),
			error =>
				error instanceof TypeError &&
				error.message === 'Invalid seed lane for "pending": lanes must be unique non-negative safe integers',
		);
	});

	test('rejects duplicate seed lanes', () => {
		assert.throws(
			() =>
				layoutGraphRows(
					[],
					new Map([
						['first', 0],
						['second', 0],
					]),
				),
			error =>
				error instanceof TypeError &&
				error.message === 'Invalid seed lane for "second": lanes must be unique non-negative safe integers',
		);
	});
});
