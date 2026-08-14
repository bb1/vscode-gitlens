import * as assert from 'assert';
import {
	AbortCommand,
	ContinueCommand,
	GetConflictsRequest,
	ResolveAllConflictsCommand,
	ResolveConflictCommand,
	StageConflictCommand,
} from '../protocol.js';

suite('rebase protocol', () => {
	test('keeps manual rebase and conflict controls local', () => {
		assert.deepStrictEqual(
			[
				AbortCommand.method,
				ContinueCommand.method,
				ResolveConflictCommand.method,
				ResolveAllConflictsCommand.method,
				StageConflictCommand.method,
			],
			[
				'rebase/abort',
				'rebase/continue',
				'rebase/conflicts/resolve',
				'rebase/conflicts/resolveAll',
				'rebase/conflicts/stage',
			],
		);
	});

	test('checks planned commits with a local rebase request', () => {
		assert.strictEqual(GetConflictsRequest.method, 'rebase/conflicts/get');
	});
});
