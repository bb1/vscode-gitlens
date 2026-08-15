import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const forbiddenPaths = [
	'packages/core/',
	'packages/ipc/',
	'packages/plus/',
	'src/agents/',
	'src/env/browser/agents/',
	'src/env/browser/coretools/',
	'src/env/browser/gk/',
	'src/env/node/agents/',
	'src/env/node/coretools/',
	'src/plus/',
	'src/webviews/plus/',
	'src/webviews/apps/plus/',
	'src/env/node/gk/',
];
const projects = new Set();
const compileProjects = new Set();
const resolvedConfigs = new Map();
let failed = false;

function getProjectPath(path) {
	return path.endsWith('.json') ? path : `${path}/tsconfig.json`;
}

function parseJsonc(source) {
	let output = '';
	let inString = false;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;

	for (let index = 0; index < source.length; index++) {
		const character = source[index];
		const next = source[index + 1];
		if (lineComment) {
			if (character === '\n') {
				lineComment = false;
				output += character;
			}
			continue;
		}
		if (blockComment) {
			if (character === '*' && next === '/') {
				blockComment = false;
				index++;
			} else if (character === '\n') {
				output += character;
			}
			continue;
		}
		if (!inString && character === '/' && next === '/') {
			lineComment = true;
			index++;
			continue;
		}
		if (!inString && character === '/' && next === '*') {
			blockComment = true;
			index++;
			continue;
		}
		output += character;
		if (character === '"' && !escaped) {
			inString = !inString;
		}
		escaped = character === '\\' && !escaped;
		if (character !== '\\') {
			escaped = false;
		}
	}

	let json = '';
	for (let index = 0; index < output.length; index++) {
		const character = output[index];
		if (character === ',') {
			let next = index + 1;
			while (/\s/.test(output[next] ?? '')) {
				next++;
			}
			if (output[next] === '}' || output[next] === ']') {
				continue;
			}
		}
		json += character;
	}
	return JSON.parse(json);
}

async function addProject(project, compile = false) {
	const normalized = relative(repoRoot, resolve(repoRoot, getProjectPath(project)));
	if (compile) {
		compileProjects.add(normalized);
	}
	if (projects.has(normalized)) return;

	await access(resolve(repoRoot, normalized));
	projects.add(normalized);

	const source = await readFile(resolve(repoRoot, normalized), 'utf8');
	const rawConfig = parseJsonc(source);
	if (typeof rawConfig.extends === 'string' && rawConfig.extends.startsWith('.')) {
		await addProject(resolve(dirname(normalized), rawConfig.extends));
	}
	for (const reference of rawConfig.references ?? []) {
		await addProject(resolve(dirname(normalized), reference.path), true);
	}

	const result = spawnSync('pnpm', ['exec', 'tsc', '-p', normalized, '--showConfig'], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	if (result.status !== 0 || !result.stdout) {
		console.error(`[check-cleanroom] unable to resolve ${normalized}`);
		if (result.stderr) {
			process.stderr.write(result.stderr);
		}

		failed = true;
		return;
	}

	let config;
	try {
		config = JSON.parse(result.stdout);
	} catch {
		console.error(`[check-cleanroom] unable to parse ${normalized} --showConfig output`);
		failed = true;
		return;
	}

	resolvedConfigs.set(normalized, config);
	for (const file of config.files ?? []) {
		if (isForbiddenPath(normalized, file)) {
			console.error(`[check-cleanroom] ${normalized} resolves deferred product source ${file}`);
			failed = true;
		}
	}
}

function getConfigFilePath(project, file) {
	return resolve(dirname(resolve(repoRoot, project)), file);
}

function isForbiddenPath(project, file) {
	const normalized = relative(repoRoot, getConfigFilePath(project, file)).replaceAll('\\', '/');
	return forbiddenPaths.some(path => normalized === path.slice(0, -1) || normalized.startsWith(path));
}

function isRuntimeProject(project) {
	return (
		project.startsWith('packages/') ||
		project === 'tsconfig.node.json' ||
		project === 'tsconfig.browser.json' ||
		project === 'src/webviews/apps/tsconfig.json'
	);
}

function isSourceFile(file) {
	return /\.[cm]?[jt]sx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file);
}

function isTestFile(file) {
	return /(?:^|\/)__tests__\/|\.(?:benchmark|test)\.[cm]?[jt]sx?$/.test(file);
}

function getLintFiles(project) {
	const config = resolvedConfigs.get(project);
	if (config == null) return [];

	return (config.files ?? [])
		.filter(file => !isForbiddenPath(project, file))
		.filter(isSourceFile)
		.filter(file => !isRuntimeProject(project) || !isTestFile(file))
		.map(file => getConfigFilePath(project, file));
}

await addProject('tsconfig.json');

for (const project of projects) {
	const source = await readFile(resolve(repoRoot, project), 'utf8');
	if (source.includes('skipLibCheck')) {
		console.error(`[check-cleanroom] ${project} references deferred product source`);
		failed = true;
	}
}

let lintedSourceFiles = 0;
let lintedProjects = 0;
for (const project of compileProjects) {
	const args = ['exec', 'tsc', '-p', project, '--noEmit'];
	if (!project.startsWith('packages/')) {
		args.push('--incremental', 'false');
	}

	const typecheck = spawnSync('pnpm', args, { cwd: repoRoot, stdio: 'inherit' });
	if (typecheck.status !== 0) {
		failed = true;
	}

	const files = getLintFiles(project);
	if (files.length === 0) {
		continue;
	}

	lintedSourceFiles += files.length;
	lintedProjects++;
	const lint = spawnSync(
		'pnpm',
		['exec', 'oxlint', '--type-aware', '--tsconfig', resolve(repoRoot, project), ...files],
		{
			cwd: repoRoot,
			stdio: 'inherit',
		},
	);
	if (lint.status !== 0) {
		failed = true;
	}
}

if (failed) {
	process.exitCode = 1;
} else {
	console.log(
		`[check-cleanroom] ${projects.size} resolved configs; ${compileProjects.size} type-checked project roots; linted ${lintedSourceFiles} active source files across ${lintedProjects} projects`,
	);
}
