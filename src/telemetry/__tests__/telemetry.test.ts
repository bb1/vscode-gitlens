import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TelemetryService } from '../telemetry.js';

suite('Local telemetry', () => {
	test('is permanently disabled and never calls fetch for events', () => {
		let fetches = 0;
		const originalFetch = globalThis.fetch;
		const blockedFetch = (() => {
			fetches++;
			return Promise.reject(new Error('network access is not allowed'));
		}) satisfies typeof fetch;
		globalThis.fetch = blockedFetch;

		try {
			const telemetry = new TelemetryService(undefined);
			telemetry.sendEvent('activate', {
				'activation.elapsed': 1,
				'activation.mode': undefined,
			});

			assert.strictEqual(telemetry.enabled, false);
			assert.strictEqual(fetches, 0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('does not load remote telemetry exporters', async () => {
		const source = await readFile(resolve(process.cwd(), 'src/telemetry/telemetry.ts'), 'utf8');

		assert.doesNotMatch(source, /open[a-z]+|loadChunk/);
	});
});
