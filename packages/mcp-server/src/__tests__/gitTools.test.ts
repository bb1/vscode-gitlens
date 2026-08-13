import * as assert from 'node:assert';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

type GitExecutor = (repository: string, args: readonly string[]) => Promise<string>;
type GitTool = (input: unknown) => Promise<string>;
type GitTools = Record<string, GitTool>;
type GitToolsModule = {
	createGitExecutor(): GitExecutor;
	createGitTools(executor: GitExecutor): GitTools;
};

async function loadGitTools(): Promise<GitToolsModule> {
	return await import('../gitTools.js');
}

suite('MCP Git tools', () => {
	let repository: string;
	let gitDirectory: string;
	let originalPath: string | undefined;

	suiteSetup(async () => {
		repository = await mkdtemp(join(tmpdir(), 'gitlens-mcp-server-'));
		gitDirectory = await mkdtemp(join(tmpdir(), 'gitlens-mcp-server-git-'));
		await writeFile(
			join(gitDirectory, 'git'),
			`#!${process.execPath}
const mode = process.argv[2];
if (mode === 'timeout') {
	setTimeout(() => process.exit(0), 31_000);
} else if (mode === 'overflow') {
	process.stdout.write(Buffer.alloc(524_288));
	process.stderr.write(Buffer.alloc(524_289));
} else if (mode === 'stderr') {
	process.stderr.write('sensitive Git details');
	process.exit(23);
} else if (mode === 'environment') {
	process.stdout.write(JSON.stringify(process.env));
}
`,
		);
		await chmod(join(gitDirectory, 'git'), 0o755);

		originalPath = process.env.PATH;
		process.env.PATH = `${gitDirectory}${delimiter}${originalPath ?? ''}`;
	});

	suiteTeardown(async () => {
		if (originalPath == null) {
			Reflect.deleteProperty(process.env, 'PATH');
		} else {
			process.env.PATH = originalPath;
		}

		await rm(repository, { recursive: true, force: true });
		await rm(gitDirectory, { recursive: true, force: true });
	});

	test('constructs read-only argv for every tool', async () => {
		const calls: { repository: string; args: readonly string[] }[] = [];
		const executor: GitExecutor = async (cwd, args) => {
			calls.push({ repository: cwd, args: args });
			if (args[0] === 'rev-parse') {
				return 'true\n';
			}

			return 'output';
		};
		const tools = (await loadGitTools()).createGitTools(executor);

		const cases: readonly { name: string; input: Record<string, unknown>; args: readonly string[] }[] = [
			{
				name: 'git_status',
				input: { repository: repository },
				args: ['--no-pager', 'status', '--short', '--branch'],
			},
			{
				name: 'git_log',
				input: { repository: repository, limit: 20, revision: 'main', file: '--output=bad' },
				args: ['--no-pager', 'log', '--max-count=20', 'main', '--', '--output=bad'],
			},
			{
				name: 'git_show',
				input: { repository: repository, revision: 'main', file: 'src/app.ts' },
				args: ['--no-pager', 'show', '--no-ext-diff', 'main', '--', 'src/app.ts'],
			},
			{
				name: 'git_diff',
				input: { repository: repository, base: 'main', head: 'origin/main', file: 'src/app.ts' },
				args: ['--no-pager', 'diff', '--no-ext-diff', 'main', 'origin/main', '--', 'src/app.ts'],
			},
			{
				name: 'git_branches',
				input: { repository: repository },
				args: ['--no-pager', 'branch', '--all', '--no-color'],
			},
			{
				name: 'git_worktrees',
				input: { repository: repository },
				args: ['--no-pager', 'worktree', 'list', '--porcelain'],
			},
			{
				name: 'git_stash_list',
				input: { repository: repository },
				args: ['--no-pager', 'stash', 'list'],
			},
			{
				name: 'git_blame',
				input: { repository: repository, file: 'src/app.ts', startLine: 2, endLine: 5 },
				args: ['--no-pager', 'blame', '--date=iso-strict', '-L', '2,5', '--', 'src/app.ts'],
			},
		];

		for (const { name, input, args } of cases) {
			assert.strictEqual(await tools[name](input), 'output');
		}

		assert.deepStrictEqual(
			calls,
			cases.flatMap(({ args }) => [
				{ repository: repository, args: ['rev-parse', '--is-inside-work-tree'] },
				{ repository: repository, args: args },
			]),
		);
	});

	test('validates a missing path through Git without a filesystem pre-check', async () => {
		const calls: { repository: string; args: readonly string[] }[] = [];
		const tools = (await loadGitTools()).createGitTools(async (cwd, args) => {
			calls.push({ repository: cwd, args: args });
			return args[0] === 'rev-parse' ? 'true\n' : 'output';
		});
		const missingRepository = join(repository, 'missing');

		assert.strictEqual(await tools.git_status({ repository: missingRepository }), 'output');
		assert.deepStrictEqual(calls, [
			{ repository: missingRepository, args: ['rev-parse', '--is-inside-work-tree'] },
			{ repository: missingRepository, args: ['--no-pager', 'status', '--short', '--branch'] },
		]);
	});

	test('rejects a directory that is not a Git worktree before running the requested tool', async () => {
		const calls: { repository: string; args: readonly string[] }[] = [];
		const tools = (await loadGitTools()).createGitTools(async (cwd, args) => {
			calls.push({ repository: cwd, args: args });
			return 'false\n';
		});

		await assert.rejects(tools.git_status({ repository: repository }), /Repository must be a Git worktree/);
		assert.deepStrictEqual(calls, [{ repository: repository, args: ['rev-parse', '--is-inside-work-tree'] }]);
	});

	test('reports an unusable repository when the Git preflight fails', async () => {
		const tools = (await loadGitTools()).createGitTools(async () => {
			throw new Error('untrusted Git error');
		});

		await assert.rejects(tools.git_status({ repository: repository }), /Repository must be a valid Git worktree/);
	});

	test('rejects invalid input for every tool without running Git', async () => {
		let callCount = 0;
		const tools = (await loadGitTools()).createGitTools(async () => {
			callCount++;
			return 'output';
		});

		const cases: readonly { name: string; input: Record<string, unknown> }[] = [
			{ name: 'git_status', input: { repository: 'relative/repository' } },
			{ name: 'git_log', input: { repository: repository, limit: 0 } },
			{ name: 'git_show', input: { repository: repository, revision: '--config=value' } },
			{ name: 'git_diff', input: { repository: repository, base: '--cached' } },
			{ name: 'git_branches', input: { repository: 'relative/repository' } },
			{ name: 'git_worktrees', input: { repository: 'relative/repository' } },
			{ name: 'git_stash_list', input: { repository: 'relative/repository' } },
			{ name: 'git_blame', input: { repository: repository, file: '../outside.ts' } },
		];

		for (const { name, input } of cases) {
			await assert.rejects(tools[name](input));
		}

		assert.strictEqual(callCount, 0);
	});

	test('times out Git commands after 30 seconds', async function () {
		this.timeout(35_000);
		const executor = (await loadGitTools()).createGitExecutor();

		await assert.rejects(executor(repository, ['timeout']), /Git command timed out/);
	});

	test('rejects Git output larger than 1 MiB across both streams', async () => {
		const executor = (await loadGitTools()).createGitExecutor();

		await assert.rejects(executor(repository, ['overflow']), /Git command output exceeded limit/);
	});

	test('does not expose Git stderr in command failures', async () => {
		const executor = (await loadGitTools()).createGitExecutor();

		await assert.rejects(executor(repository, ['stderr']), error => {
			assert.strictEqual((error as Error).message, 'Git command failed with exit code 23');
			return true;
		});
	});

	test('removes Git control variables while preserving ordinary environment', async () => {
		const executor = (await loadGitTools()).createGitExecutor();
		const variables = {
			GIT_DIR: '/untrusted/git-dir',
			GIT_WORK_TREE: '/untrusted/work-tree',
			GIT_INDEX_FILE: '/untrusted/index',
			GIT_OBJECT_DIRECTORY: '/untrusted/objects',
			GIT_ALTERNATE_OBJECT_DIRECTORIES: '/untrusted/alternate-objects',
			GIT_CONFIG: '/untrusted/config',
			GIT_CONFIG_SYSTEM: '/untrusted/system-config',
			GIT_CONFIG_GLOBAL: '/untrusted/global-config',
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'alias.status=!malicious-command',
			GIT_CONFIG_VALUE_0: 'malicious-command',
			GIT_SSH: '/untrusted/ssh',
			GIT_SSH_COMMAND: 'malicious-ssh-command',
			GIT_OPTIONAL_LOCKS: '1',
			GIT_TERMINAL_PROMPT: '1',
			GIT_PAGER: 'less',
			HOME: '/ordinary-home',
		};

		await withEnvironment(variables, async () => {
			const environment = JSON.parse(await executor(repository, ['environment'])) as NodeJS.ProcessEnv;

			for (const variable of [
				'GIT_DIR',
				'GIT_WORK_TREE',
				'GIT_INDEX_FILE',
				'GIT_OBJECT_DIRECTORY',
				'GIT_ALTERNATE_OBJECT_DIRECTORIES',
				'GIT_CONFIG',
				'GIT_CONFIG_SYSTEM',
				'GIT_CONFIG_GLOBAL',
				'GIT_CONFIG_COUNT',
				'GIT_CONFIG_KEY_0',
				'GIT_CONFIG_VALUE_0',
				'GIT_SSH',
				'GIT_SSH_COMMAND',
			]) {
				assert.strictEqual(environment[variable], undefined);
			}

			assert.strictEqual(environment.GIT_OPTIONAL_LOCKS, '0');
			assert.strictEqual(environment.GIT_TERMINAL_PROMPT, '0');
			assert.strictEqual(environment.GIT_PAGER, 'cat');
			assert.strictEqual(environment.HOME, '/ordinary-home');
			assert.strictEqual(environment.PATH, process.env.PATH);
		});
	});
});

async function withEnvironment<T>(values: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(values)) {
		previous.set(key, process.env[key]);
		if (value == null) {
			Reflect.deleteProperty(process.env, key);
		} else {
			process.env[key] = value;
		}
	}

	try {
		return await fn();
	} finally {
		for (const [key, value] of previous) {
			if (value == null) {
				Reflect.deleteProperty(process.env, key);
			} else {
				process.env[key] = value;
			}
		}
	}
}
