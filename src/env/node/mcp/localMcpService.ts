import type { ConfigurationChangeEvent, Disposable, Event } from 'vscode';
import { commands, ConfigurationTarget, Uri, workspace } from 'vscode';
import type { Container } from '../../../container.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { CursorMcpHostProvider } from './hostProviders/cursorMcpHostProvider.js';
import type { LocalMcpServerDefinition, McpHostRegistrationProvider } from './hostProviders/types.js';
import { VSCodeMcpHostProvider } from './hostProviders/vscodeMcpHostProvider.js';

export type LocalMcpServiceOptions = {
	isTrusted: () => boolean;
	isEnabled: () => boolean;
	isRegistrationCapable: () => boolean;
	onDidGrantWorkspaceTrust: Event<void>;
	onDidChangeConfiguration: Event<ConfigurationChangeEvent>;
	createHostProvider: (definition: LocalMcpServerDefinition) => McpHostRegistrationProvider | undefined;
	registerCommand: (
		command: 'gitlens.mcp.enable' | 'gitlens.mcp.disable' | 'gitlens.mcp.showConfiguration',
		callback: () => unknown,
	) => Disposable;
	updateEnabled: (enabled: boolean) => Thenable<void>;
	showConfiguration: () => Thenable<unknown>;
	setAvailable: (available: boolean) => Thenable<unknown>;
};

export class LocalMcpService implements Disposable {
	private readonly definition: LocalMcpServerDefinition;
	private readonly disposable: Disposable[];
	private available: boolean | undefined;
	private provider: McpHostRegistrationProvider | undefined;

	constructor(
		extensionUri: Uri,
		private readonly options: LocalMcpServiceOptions = createOptions(),
	) {
		this.definition = getLocalMcpServerDefinition(extensionUri);
		this.disposable = [
			options.onDidGrantWorkspaceTrust(() => this.ensureRegistration()),
			options.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('gitlens.mcp.enabled')) {
					this.ensureRegistration();
				}
			}),
			options.registerCommand('gitlens.mcp.enable', () => void options.updateEnabled(true)),
			options.registerCommand('gitlens.mcp.disable', () => void options.updateEnabled(false)),
			options.registerCommand('gitlens.mcp.showConfiguration', () => void options.showConfiguration()),
		];
		this.ensureRegistration();
	}

	get isRegistrationCapable(): boolean {
		return this.options.isRegistrationCapable();
	}

	get isRegistrationEnabled(): boolean {
		return this.options.isEnabled();
	}

	get isRegistrationAllowed(): boolean {
		return this.options.isTrusted() && this.options.isEnabled() && this.isRegistrationCapable;
	}

	dispose(): void {
		this.disposeProvider();
		this.setAvailable(false);
		for (const disposable of this.disposable) {
			disposable.dispose();
		}
	}

	private ensureRegistration(): void {
		this.setAvailable(this.options.isTrusted() && this.isRegistrationCapable);

		if (!this.isRegistrationAllowed) {
			this.disposeProvider();
			return;
		}

		this.provider ??= this.options.createHostProvider(this.definition);
	}

	private disposeProvider(): void {
		this.provider?.dispose();
		this.provider = undefined;
	}

	private setAvailable(available: boolean): void {
		if (this.available === available) return;

		this.available = available;
		void this.options.setAvailable(available);
	}
}

export function getLocalMcpServerDefinition(extensionUri: Uri): LocalMcpServerDefinition {
	return {
		label: 'Offline GitLense Local Git MCP Server',
		command: globalThis.process.execPath,
		args: [Uri.joinPath(extensionUri, 'dist', 'mcp-server', 'server.js').fsPath],
		env: {},
	};
}

export function getLocalMcpService(container: Container): LocalMcpService {
	return new LocalMcpService(container.context.extensionUri);
}

function createOptions(): LocalMcpServiceOptions {
	return {
		isTrusted: () => workspace.isTrusted,
		isEnabled: () => configuration.get('mcp.enabled'),
		isRegistrationCapable: () => VSCodeMcpHostProvider.isSupported() || CursorMcpHostProvider.isSupported(),
		onDidGrantWorkspaceTrust: workspace.onDidGrantWorkspaceTrust,
		onDidChangeConfiguration: workspace.onDidChangeConfiguration,
		createHostProvider: definition =>
			VSCodeMcpHostProvider.create(definition) ?? CursorMcpHostProvider.create(definition),
		registerCommand: (command, callback) => commands.registerCommand(command, callback),
		updateEnabled: enabled => configuration.update('mcp.enabled', enabled, ConfigurationTarget.Global),
		showConfiguration: () => commands.executeCommand('workbench.action.openSettings', 'gitlens.mcp.enabled'),
		setAvailable: available => commands.executeCommand('setContext', 'gitlens:mcp:available', available),
	};
}
