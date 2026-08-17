import type { Disposable, McpServerDefinition, McpServerDefinitionProvider } from 'vscode';
import { lm, McpStdioServerDefinition } from 'vscode';
import type { LocalMcpServerDefinition, McpHostRegistrationProvider } from './types.js';

type McpProviderRegistration = (id: string, provider: McpServerDefinitionProvider) => Disposable;

export class VSCodeMcpHostProvider implements McpHostRegistrationProvider, McpServerDefinitionProvider {
	private readonly registration: Disposable;

	static isSupported(): boolean {
		return lm.registerMcpServerDefinitionProvider != null;
	}

	static create(definition: LocalMcpServerDefinition): VSCodeMcpHostProvider | undefined {
		const register = lm.registerMcpServerDefinitionProvider;
		if (register == null) return undefined;

		return new VSCodeMcpHostProvider(definition, register);
	}

	constructor(
		private readonly definition: LocalMcpServerDefinition,
		register: McpProviderRegistration,
	) {
		this.registration = register('bb1.offline-gitlense.mcp', this);
	}

	dispose(): void {
		this.registration.dispose();
	}

	provideMcpServerDefinitions(): McpServerDefinition[] {
		return [
			new McpStdioServerDefinition(
				this.definition.label,
				this.definition.command,
				this.definition.args,
				this.definition.env,
			),
		];
	}
}
