import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

const maximumArgumentLength = 512;
const commandTimeout = 30_000;
const maximumOutputLength = 1024 * 1024;
const gitControlVariables = new Set([
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_OBJECT_DIRECTORY',
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_CONFIG',
	'GIT_CONFIG_SYSTEM',
	'GIT_CONFIG_GLOBAL',
	'GIT_CONFIG_COUNT',
	'GIT_SSH',
	'GIT_SSH_COMMAND',
]);

const repositorySchema = z
	.string()
	.min(1)
	.max(maximumArgumentLength)
	.refine(isAbsolute, 'Repository must be an absolute path');

const revisionSchema = z
	.string()
	.min(1)
	.max(maximumArgumentLength)
	.refine(value => !value.startsWith('-') && !/[\0\r\n]/.test(value), 'Invalid revision');

const fileSchema = z
	.string()
	.min(1)
	.max(maximumArgumentLength)
	.refine(isSafeFilePath, 'File must be a repository-relative path without traversal');

export const gitToolSchemas = {
	git_status: z.object({ repository: repositorySchema }).strict(),
	git_log: z
		.object({
			repository: repositorySchema,
			limit: z.number().int().min(1).max(100).optional().default(20),
			revision: revisionSchema.optional(),
			file: fileSchema.optional(),
		})
		.strict(),
	git_show: z
		.object({ repository: repositorySchema, revision: revisionSchema, file: fileSchema.optional() })
		.strict(),
	git_diff: z
		.object({
			repository: repositorySchema,
			base: revisionSchema.optional(),
			head: revisionSchema.optional(),
			file: fileSchema.optional(),
		})
		.strict()
		.refine(value => value.head == null || value.base != null, 'A base revision is required when head is set'),
	git_branches: z.object({ repository: repositorySchema }).strict(),
	git_worktrees: z.object({ repository: repositorySchema }).strict(),
	git_stash_list: z.object({ repository: repositorySchema }).strict(),
	git_blame: z
		.object({
			repository: repositorySchema,
			file: fileSchema,
			startLine: z.number().int().min(1).optional(),
			endLine: z.number().int().min(1).optional(),
		})
		.strict()
		.refine(value => value.endLine == null || (value.startLine != null && value.endLine >= value.startLine), {
			message: 'endLine must not be less than startLine',
		}),
};

export type GitExecutor = (repository: string, args: readonly string[]) => Promise<string>;

export type GitTools = {
	[K in keyof typeof gitToolSchemas]: (input: unknown) => Promise<string>;
};

export function createGitTools(executor: GitExecutor): GitTools {
	return {
		git_status: async input => {
			const { repository } = gitToolSchemas.git_status.parse(input);
			return execute(repository, ['--no-pager', 'status', '--short', '--branch'], executor);
		},
		git_log: async input => {
			const { repository, limit, revision, file } = gitToolSchemas.git_log.parse(input);
			const args = ['--no-pager', 'log', `--max-count=${limit}`];
			if (revision != null) {
				args.push(revision);
			}
			if (file != null) {
				args.push('--', file);
			}

			return execute(repository, args, executor);
		},
		git_show: async input => {
			const { repository, revision, file } = gitToolSchemas.git_show.parse(input);
			const args = ['--no-pager', 'show', '--no-ext-diff', revision];
			if (file != null) {
				args.push('--', file);
			}

			return execute(repository, args, executor);
		},
		git_diff: async input => {
			const { repository, base, head, file } = gitToolSchemas.git_diff.parse(input);
			const args = ['--no-pager', 'diff', '--no-ext-diff'];
			if (base != null) {
				args.push(base);
			}
			if (head != null) {
				args.push(head);
			}
			if (file != null) {
				args.push('--', file);
			}

			return execute(repository, args, executor);
		},
		git_branches: async input => {
			const { repository } = gitToolSchemas.git_branches.parse(input);
			return execute(repository, ['--no-pager', 'branch', '--all', '--no-color'], executor);
		},
		git_worktrees: async input => {
			const { repository } = gitToolSchemas.git_worktrees.parse(input);
			return execute(repository, ['--no-pager', 'worktree', 'list', '--porcelain'], executor);
		},
		git_stash_list: async input => {
			const { repository } = gitToolSchemas.git_stash_list.parse(input);
			return execute(repository, ['--no-pager', 'stash', 'list'], executor);
		},
		git_blame: async input => {
			const { repository, file, startLine, endLine } = gitToolSchemas.git_blame.parse(input);
			const args = ['--no-pager', 'blame', '--date=iso-strict'];
			if (startLine != null) {
				args.push('-L', `${startLine},${endLine ?? startLine}`);
			}
			args.push('--', file);

			return execute(repository, args, executor);
		},
	};
}

export function createGitExecutor(): GitExecutor {
	return (repository, args) =>
		new Promise((resolve, reject) => {
			const child = spawn('git', args, {
				cwd: repository,
				env: getGitEnvironment(),
				shell: false,
				windowsHide: true,
			});

			let settled = false;
			let outputLength = 0;
			const stdout: Buffer[] = [];
			const timeout = setTimeout(() => {
				abort(new Error('Git command timed out'));
			}, commandTimeout);

			const onStdout = (chunk: Buffer): void => {
				if (!collectOutput(chunk)) {
					return;
				}

				stdout.push(chunk);
			};
			const onStderr = (chunk: Buffer): void => {
				collectOutput(chunk);
			};
			const onError = (): void => {
				finish(new Error('Unable to start Git command'));
			};
			const onClose = (code: number | null): void => {
				if (code === 0) {
					finish(undefined, Buffer.concat(stdout).toString());
					return;
				}

				finish(new Error(`Git command failed with exit code ${code}`));
			};

			child.stdout.on('data', onStdout);
			child.stderr.on('data', onStderr);
			child.once('error', onError);
			child.once('close', onClose);

			function collectOutput(chunk: Buffer): boolean {
				if (settled) {
					return false;
				}

				outputLength += chunk.length;
				if (outputLength > maximumOutputLength) {
					abort(new Error('Git command output exceeded limit'));
					return false;
				}

				return true;
			}

			function abort(error: Error): void {
				if (settled) {
					return;
				}

				child.kill();
				finish(error);
			}

			function finish(error?: Error, output?: string): void {
				if (settled) {
					return;
				}

				settled = true;
				clearTimeout(timeout);
				child.stdout.off('data', onStdout);
				child.stderr.off('data', onStderr);
				child.off('error', onError);
				child.off('close', onClose);
				if (error != null) {
					reject(error);
					return;
				}

				resolve(output ?? '');
			}
		});
}

async function execute(repository: string, args: string[], executor: GitExecutor): Promise<string> {
	let isWorktree: string;
	try {
		isWorktree = await executor(repository, ['rev-parse', '--is-inside-work-tree']);
	} catch {
		throw new Error('Repository must be a valid Git worktree');
	}

	if (isWorktree.trim() !== 'true') {
		throw new Error('Repository must be a Git worktree');
	}

	return executor(repository, args);
}

function getGitEnvironment(): NodeJS.ProcessEnv {
	const environment = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !gitControlVariables.has(key) && !/^GIT_CONFIG_(?:KEY|VALUE)_/.test(key),
		),
	);

	environment.GIT_OPTIONAL_LOCKS = '0';
	environment.GIT_TERMINAL_PROMPT = '0';
	environment.GIT_PAGER = 'cat';
	return environment;
}

function isSafeFilePath(value: string): boolean {
	return (
		!isAbsolute(value) &&
		!/[\0\r\n]/.test(value) &&
		!value.split(/[\\/]+/).some(segment => segment === '.' || segment === '..')
	);
}
