#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGitExecutor, createGitTools, gitToolSchemas } from './gitTools.js';

const tools = createGitTools(createGitExecutor());
const server = new McpServer({ name: 'gitlens-mcp-server', version: '0.0.1' });

server.registerTool(
	'git_status',
	{
		description: 'Show the repository status.',
		inputSchema: gitToolSchemas.git_status,
		annotations: { readOnlyHint: true },
	},
	async input => ({ content: [{ type: 'text', text: await tools.git_status(input) }] }),
);
server.registerTool(
	'git_log',
	{ description: 'List recent commits.', inputSchema: gitToolSchemas.git_log, annotations: { readOnlyHint: true } },
	async input => ({ content: [{ type: 'text', text: await tools.git_log(input) }] }),
);
server.registerTool(
	'git_show',
	{
		description: 'Show a commit or file revision.',
		inputSchema: gitToolSchemas.git_show,
		annotations: { readOnlyHint: true },
	},
	async input => ({ content: [{ type: 'text', text: await tools.git_show(input) }] }),
);
server.registerTool(
	'git_diff',
	{
		description: 'Show a read-only Git diff.',
		inputSchema: gitToolSchemas.git_diff,
		annotations: { readOnlyHint: true },
	},
	async input => ({ content: [{ type: 'text', text: await tools.git_diff(input) }] }),
);
server.registerTool(
	'git_branches',
	{
		description: 'List local and remote branches.',
		inputSchema: gitToolSchemas.git_branches,
		annotations: { readOnlyHint: true },
	},
	async input => ({ content: [{ type: 'text', text: await tools.git_branches(input) }] }),
);
server.registerTool(
	'git_worktrees',
	{
		description: 'List repository worktrees.',
		inputSchema: gitToolSchemas.git_worktrees,
		annotations: { readOnlyHint: true },
	},
	async input => ({ content: [{ type: 'text', text: await tools.git_worktrees(input) }] }),
);
server.registerTool(
	'git_stash_list',
	{
		description: 'List stash entries.',
		inputSchema: gitToolSchemas.git_stash_list,
		annotations: { readOnlyHint: true },
	},
	async input => ({ content: [{ type: 'text', text: await tools.git_stash_list(input) }] }),
);
server.registerTool(
	'git_blame',
	{
		description: 'Show line authorship for a repository file.',
		inputSchema: gitToolSchemas.git_blame,
		annotations: { readOnlyHint: true },
	},
	async input => ({ content: [{ type: 'text', text: await tools.git_blame(input) }] }),
);

await server.connect(new StdioServerTransport());
