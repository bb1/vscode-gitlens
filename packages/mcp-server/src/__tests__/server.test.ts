import * as assert from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

type JsonRpcMessage = {
	id?: number;
	result?: unknown;
	error?: { code: number; message: string };
};

const expectedToolNames = [
	'git_blame',
	'git_branches',
	'git_diff',
	'git_log',
	'git_show',
	'git_stash_list',
	'git_status',
	'git_worktrees',
];

suite('MCP stdio server', () => {
	let repository: string;

	suiteSetup(async () => {
		repository = await mkdtemp(join(tmpdir(), 'gitlens-mcp-server-smoke-'));
		await runGit(['init', '--initial-branch=main', repository]);
	});

	suiteTeardown(async () => {
		await rm(repository, { recursive: true, force: true });
	});

	test('lists and calls the read-only Git tools over stdio', async () => {
		const server = spawn(process.execPath, [resolve('dist/server.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
		const output = createInterface({ input: server.stdout, crlfDelay: Infinity });
		const stdin = server.stdin;
		if (stdin == null) {
			throw new Error('Expected server stdin');
		}

		try {
			const initialized = await request(stdin, output, 1, 'initialize', {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'gitlens-mcp-server-test', version: '1.0.0' },
			});
			assert.strictEqual(initialized.error, undefined);

			stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

			const listed = await request(stdin, output, 2, 'tools/list', {});
			assert.strictEqual(listed.error, undefined);
			const tools = (listed.result as { tools: { name: string }[] }).tools;
			assert.deepStrictEqual(tools.map(tool => tool.name).sort(), expectedToolNames);

			const status = await request(stdin, output, 3, 'tools/call', {
				name: 'git_status',
				arguments: { repository: repository },
			});
			assert.strictEqual(status.error, undefined);
			const result = status.result as { content: { type: string; text: string }[]; isError?: boolean };
			assert.strictEqual(result.isError, undefined);
			assert.strictEqual(result.content[0].type, 'text');
			assert.match(result.content[0].text, /No commits yet on main/);
		} finally {
			output.close();
			server.kill();
		}
	});
});

function request(
	stdin: NonNullable<ReturnType<typeof spawn>['stdin']>,
	output: ReturnType<typeof createInterface>,
	id: number,
	method: string,
	params: Record<string, unknown>,
): Promise<JsonRpcMessage> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			output.off('line', onLine);
			reject(new Error(`Timed out waiting for ${method}`));
		}, 10_000);

		const onLine = (line: string): void => {
			const message = JSON.parse(line) as JsonRpcMessage;
			if (message.id !== id) {
				return;
			}

			clearTimeout(timeout);
			output.off('line', onLine);
			resolve(message);
		};

		output.on('line', onLine);
		stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params })}\n`);
	});
}

function runGit(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('git', args, { stdio: 'ignore' });
		child.once('error', reject);
		child.once('close', code => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`git exited with ${code}`));
		});
	});
}
