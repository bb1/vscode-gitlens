/** @typedef {import('esbuild').BuildOptions} BuildOptions **/
/** @typedef {import('esbuild').WatchOptions} WatchOptions **/

import { readdir, rm } from 'node:fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';
import { nodeExternalsPlugin } from 'esbuild-node-externals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.join(path.dirname(__filename), '..');

const args = process.argv.slice(2);
const watch = args.includes('--watch');

async function getTestEntryPoints(directory = path.join(__dirname, 'src')) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await getTestEntryPoints(entryPath)));
		} else if (entry.name.endsWith('.test.ts')) {
			files.push(path.relative(__dirname, entryPath));
		}
	}
	return files;
}

/**
 * @param { 'node' | 'webworker' } target
 */
async function buildTests(target) {
	/** @type BuildOptions | WatchOptions */
	const config = {
		bundle: true,
		define: {
			DEBUG: 'false',
		},
		entryPoints: await getTestEntryPoints(),
		entryNames: '[dir]/[name]',
		external: ['vscode'],
		format: 'cjs',
		logLevel: 'info',
		logOverride: {
			'duplicate-case': 'silent',
		},
		mainFields: target === 'webworker' ? ['browser', 'module', 'main'] : ['module', 'main'],
		metafile: false,
		minify: false,
		outdir: target === 'webworker' ? 'out/tests/browser' : 'out/tests',
		platform: target === 'webworker' ? 'browser' : target,
		// Bundle workspace packages from source so tests exercise the same code as the extension bundle.
		plugins: [nodeExternalsPlugin({ allowList: [/^@gitlens\//] })],
		sourcemap: true,
		target: ['es2023', 'chrome124', 'node20.14.0'],
		tsconfig: target === 'webworker' ? 'tsconfig.test.browser.json' : 'tsconfig.test.json',
	};

	config.alias = {
		'@env': path.resolve(__dirname, 'src', 'env', target === 'webworker' ? 'browser' : 'node'),
		'@gitlens/utils': path.resolve(__dirname, 'packages', 'utils', 'src'),
		'@gitlens/git': path.resolve(__dirname, 'packages', 'git', 'src'),
		'@gitlens/git-cli': path.resolve(__dirname, 'packages', 'git-cli', 'src'),
		'@gitlens/hosting-integrations': path.resolve(__dirname, 'packages', 'integrations', 'src'),
		'@gitlens/hosting-github': path.resolve(__dirname, 'packages', 'git-github', 'src'),
		// This dependency is very large, and isn't needed for our use-case
		tr46: path.resolve(__dirname, 'patches', 'tr46.js'),
		// This dependency is unnecessary for our use-case
		'whatwg-url': path.resolve(__dirname, 'patches', 'whatwg-url.js'),
	};

	if (target === 'webworker') {
		config.alias.path = 'path-browserify';
		config.alias.os = 'os-browserify/browser';
	}

	// Clear stale bundles first: esbuild doesn't prune outputs, so tests that were renamed,
	// deleted, or moved out of `src` (e.g. into a workspace package) would otherwise linger in
	// `out/tests` and get picked up by the vscode-test runner.
	await rm(path.join(__dirname, config.outdir), { recursive: true, force: true });

	if (watch) {
		const ctx = await esbuild.context(config);
		await ctx.watch();
	} else {
		await esbuild.build(config);
	}
}

try {
	await buildTests('node');
} catch (ex) {
	console.error(ex);
	process.exit(1);
}
