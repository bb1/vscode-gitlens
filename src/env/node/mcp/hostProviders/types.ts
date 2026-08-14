import type { Disposable } from 'vscode';

export type LocalMcpServerDefinition = {
	label: string;
	command: string;
	args: string[];
	env: Record<string, string>;
};

export type McpHostRegistrationProvider = Disposable;
