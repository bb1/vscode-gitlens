import * as assert from 'node:assert';
import type { ConfigurationChangeEvent, Disposable, McpServerDefinitionProvider } from 'vscode';
import { EventEmitter, McpStdioServerDefinition, Uri } from 'vscode';
import { CursorMcpHostProvider } from '../hostProviders/cursorMcpHostProvider.js';
import type { McpHostRegistrationProvider } from '../hostProviders/types.js';
import { VSCodeMcpHostProvider } from '../hostProviders/vscodeMcpHostProvider.js';
import type { LocalMcpServiceOptions } from '../localMcpService.js';
import { getLocalMcpServerDefinition, LocalMcpService } from '../localMcpService.js';

suite('Local MCP registration', () => {
	test('creates a bundled stdio definition using the current Node runtime', () => {
		const definition = getLocalMcpServerDefinition(Uri.file('/extension'));

		assert.deepStrictEqual(definition, {
			label: 'Offline GitLense Local Git MCP Server',
			command: process.execPath,
			args: ['/extension/dist/mcp-server/server.js'],
			env: {},
		});
	});

	test('registers only after workspace trust is granted and disposes on disable', () => {
		let trusted = false;
		let enabled = true;
		let registrations = 0;
		let disposals = 0;
		const availability: boolean[] = [];
		const trust = new EventEmitter<void>();
		const configuration = new EventEmitter<ConfigurationChangeEvent>();
		const options: LocalMcpServiceOptions = {
			isTrusted: () => trusted,
			isEnabled: () => enabled,
			isRegistrationCapable: () => true,
			onDidGrantWorkspaceTrust: trust.event,
			onDidChangeConfiguration: configuration.event,
			createHostProvider: (): McpHostRegistrationProvider => {
				registrations++;
				return { dispose: () => disposals++ };
			},
			registerCommand: (): Disposable => ({ dispose: () => {} }),
			updateEnabled: () => Promise.resolve(),
			showConfiguration: () => Promise.resolve(undefined),
			setAvailable: available => {
				availability.push(available);
				return Promise.resolve(undefined);
			},
		};
		const service = new LocalMcpService(Uri.file('/extension'), options);

		assert.strictEqual(registrations, 0);
		assert.deepStrictEqual(availability, [false]);

		trusted = true;
		trust.fire();
		assert.strictEqual(registrations, 1);
		assert.deepStrictEqual(availability, [false, true]);

		enabled = false;
		const configurationEvent = {
			affectsConfiguration: section => section === 'gitlens.mcp.enabled',
		} satisfies Pick<ConfigurationChangeEvent, 'affectsConfiguration'>;
		configuration.fire(configurationEvent);
		assert.strictEqual(disposals, 1);

		service.dispose();
		assert.strictEqual(disposals, 1);
	});

	test('disposes the active registration when the service is disposed', () => {
		let disposals = 0;
		const trust = new EventEmitter<void>();
		const configuration = new EventEmitter<ConfigurationChangeEvent>();
		const service = new LocalMcpService(Uri.file('/extension'), {
			isTrusted: () => true,
			isEnabled: () => true,
			isRegistrationCapable: () => true,
			onDidGrantWorkspaceTrust: trust.event,
			onDidChangeConfiguration: configuration.event,
			createHostProvider: (): McpHostRegistrationProvider => ({ dispose: () => disposals++ }),
			registerCommand: (): Disposable => ({ dispose: () => {} }),
			updateEnabled: () => Promise.resolve(),
			showConfiguration: () => Promise.resolve(undefined),
			setAvailable: () => Promise.resolve(undefined),
		});

		service.dispose();
		assert.strictEqual(disposals, 1);
	});
});

suite('Local MCP host providers', () => {
	const definition = getLocalMcpServerDefinition(Uri.file('/extension'));

	test('registers the VS Code provider and supplies the bundled definition', () => {
		let id: string | undefined;
		let supplied: McpServerDefinitionProvider | undefined;
		let disposed = false;
		const provider = new VSCodeMcpHostProvider(definition, (providerId, value) => {
			id = providerId;
			supplied = value;
			return { dispose: () => (disposed = true) };
		});

		assert.strictEqual(id, 'bb1.offline-gitlense.mcp');
		assert.ok(supplied != null);
		const suppliedDefinitions = supplied.provideMcpServerDefinitions(undefined!);
		assert.ok(Array.isArray(suppliedDefinitions));
		const suppliedDefinition = suppliedDefinitions[0];
		assert.ok(suppliedDefinition instanceof McpStdioServerDefinition);
		assert.strictEqual(suppliedDefinition?.label, definition.label);
		assert.strictEqual(suppliedDefinition.command, definition.command);
		assert.deepStrictEqual(suppliedDefinition.args, definition.args);

		provider.dispose();
		assert.strictEqual(disposed, true);
	});

	test('registers and unregisters the Cursor server without a shell command', () => {
		let registered: unknown;
		let unregistered: string | undefined;
		const provider = new CursorMcpHostProvider(definition, {
			registerServer: config => (registered = config),
			unregisterServer: name => (unregistered = name),
		});

		assert.deepStrictEqual(registered, {
			name: definition.label,
			server: { command: process.execPath, args: ['/extension/dist/mcp-server/server.js'], env: {} },
		});

		provider.dispose();
		assert.strictEqual(unregistered, definition.label);
	});

	test('does not expose a provider when the host has no registration capability', () => {
		const trust = new EventEmitter<void>();
		const configuration = new EventEmitter<ConfigurationChangeEvent>();
		const service = new LocalMcpService(Uri.file('/extension'), {
			isTrusted: () => true,
			isEnabled: () => true,
			isRegistrationCapable: () => false,
			onDidGrantWorkspaceTrust: trust.event,
			onDidChangeConfiguration: configuration.event,
			createHostProvider: () => {
				throw new Error('The host provider must not be created');
			},
			registerCommand: (): Disposable => ({ dispose: () => {} }),
			updateEnabled: () => Promise.resolve(),
			showConfiguration: () => Promise.resolve(undefined),
			setAvailable: () => Promise.resolve(undefined),
		});

		assert.strictEqual(service.isRegistrationAllowed, false);
		service.dispose();
	});
});
