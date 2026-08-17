import { cursor } from 'vscode';
import type { LocalMcpServerDefinition, McpHostRegistrationProvider } from './types.js';

type CursorMcpRegistration = {
	registerServer(config: {
		name: string;
		server: { command: string; args: string[]; env: Record<string, string> };
	}): void;
	unregisterServer(name: string): void;
};

export class CursorMcpHostProvider implements McpHostRegistrationProvider {
	static isSupported(): boolean {
		return cursor?.mcp?.registerServer != null && cursor.mcp.unregisterServer != null;
	}

	static create(definition: LocalMcpServerDefinition): CursorMcpHostProvider | undefined {
		const registration = cursor?.mcp;
		if (registration?.registerServer == null || registration.unregisterServer == null) return undefined;

		return new CursorMcpHostProvider(definition, registration);
	}

	constructor(
		private readonly definition: LocalMcpServerDefinition,
		private readonly registration: CursorMcpRegistration,
	) {
		registration.registerServer({
			name: definition.label,
			server: { command: definition.command, args: definition.args, env: definition.env },
		});
	}

	dispose(): void {
		this.registration.unregisterServer(this.definition.label);
	}
}
