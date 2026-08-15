import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FeatureFlagKey, LocalFeatureFlagService } from '../featureFlagService.js';

suite('Local feature flags', () => {
	test('always returns the local default without network access', () => {
		const service = new LocalFeatureFlagService();

		assert.strictEqual(service.getFlag(FeatureFlagKey.WelcomeTitleVariant, 'control'), 'control');
		assert.deepStrictEqual(service.getAllFlags(), {});
	});

	test('does not import remote configuration or fetch feature flags', async () => {
		const source = await readFile(resolve(process.cwd(), 'src/featureFlags/featureFlagService.ts'), 'utf8');

		assert.doesNotMatch(source, /config[a-z]+|fetch\(/);
	});
});
