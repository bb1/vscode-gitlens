import * as assert from 'node:assert';
import { getMcpService } from '../../../browser/providers.js';

suite('Browser MCP provider', () => {
	test('does not expose a desktop MCP service or register local Git tools', () => {
		const getService = getMcpService as (container: undefined) => undefined;
		// oxlint-disable-next-line typescript/no-confusing-void-expression -- asserts the intentional browser no-op
		const service = getService(undefined);
		assert.strictEqual(service, undefined);
	});
});
