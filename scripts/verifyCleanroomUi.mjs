import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const execFileAsync = promisify(execFile);
const sourceExtensions = new Set(['.js', '.json', '.md', '.mjs', '.mts', '.ts', '.yml', '.yaml']);
const prohibitedWords = ['Git' + 'Kraken', 'Kep' + 'ler', 'Config' + 'Cat', 'Open' + 'Telemetry'];
const productName = ['Git', 'Kr' + 'aken'].join('');
const productDomain = ['git', 'kr' + 'aken'].join('');
const productPlan = ['GitLens', 'P' + 'ro'].join(' ');
const productLaunchpad = ['Launch', 'p' + 'ad'].join('');
const productContext = ['gitlens', '' + ''].join(':');
const legacyCli = ['gk', 'c' + 'li'].join('-');
const remoteConfig = ['config', 'c' + 'at'].join('');
const telemetry = ['open', 'tele' + 'metry'].join('');
const protocolToken = ['ot', String.fromCharCode(108), 'p'].join('');
const forbidden = [
	[
		'product command',
		new RegExp(
			`gitlens\\.(?:show(?:AccountView|HomeView|WelcomeView|Timeline(?:Page|View)|PatchDetailsPage)|plus|ai|agents|gk|cloud(?:Patches)?|drafts|${productLaunchpad}|workspaces)\\b`,
			'i',
		),
	],
	[
		'product view',
		new RegExp(
			`gitlens\\.views\\.(?:account|home|welcome|timeline|patchDetails|drafts|${productLaunchpad}|workspaces)\\b`,
			'i',
		),
	],
	[
		'product context',
		new RegExp(
			`${productContext}(?:account|plus|ai|agents|gk|cloud|drafts|${productLaunchpad}|workspaces)\\b`,
			'i',
		),
	],
	['product setting anchor', /gitlens\.showSettingsPage!(?:account|agents|ai|integrations)\b/i],
	[
		'product setting',
		new RegExp(
			`gitlens\\.(?:ai|agents|gk|cloud(?:Patches)?|drafts|${productLaunchpad}|workspaces|plusFeatures|graph\\.(?:branchesVisibility|experimental\\.(?:kanban|visualizations)))`,
			'i',
		),
	],
	['product text', new RegExp(`\\b(?:${productPlan}|${productLaunchpad}|${prohibitedWords.join('|')})\\b`, 'i')],
	['product URL', new RegExp(`https?:\\/\\/(?:[^/]+\\.)?${productDomain}\\.(?:com|dev)\\b`, 'i')],
	['product dependency', new RegExp(`@${productDomain}\\/`, 'i')],
	['legacy CLI', new RegExp(`\\b(?:${legacyCli}|${productName} CLI)\\b`, 'i')],
	['remote configuration runtime', new RegExp(`\\b(?:${remoteConfig}|${telemetry}|${protocolToken})\\b`, 'i')],
	['Plus condition', new RegExp(`!${productContext}plus:disabled`, 'i')],
];
const removedPaths = [
	'LICENSE.plus',
	'packages/core',
	'packages/ipc',
	'packages/plus',
	'src/agents',
	'src/env/browser/agents',
	'src/env/browser/coretools',
	'src/env/browser/gk',
	'src/env/node/agents',
	'src/env/node/coretools',
	'src/env/node/gk',
	'src/plus',
	'src/webviews/apps/plus',
	'src/webviews/plus',
];
const retainedCommands = [
	'gitlens.createPatch',
	'gitlens.applyPatchFromClipboard',
	'gitlens.openPatch',
	'gitlens.connectRemoteProvider',
	'gitlens.disconnectRemoteProvider',
	'gitlens.git.stash.push',
	'gitlens.stashSave',
	'gitlens.showGraph',
	'gitlens.showInCommitGraph',
	'gitlens.showCommitDetailsView',
	'gitlens.showSettingsPage',
	'gitlens.rebase.enableEditor',
	'gitlens.mcp.enable',
];
const errors = [];

function isLegalAttribution(path) {
	return (
		basename(path) === 'LICENSE' || basename(path) === 'LICENSE.txt' || basename(path) === 'ThirdPartyNotices.txt'
	);
}

function isScanned(path) {
	if (isLegalAttribution(path) || path === 'CHANGELOG.md') return false;
	if (path.startsWith('.claude/') || path.startsWith('.augment/') || path.startsWith('.work/')) return false;
	if (
		path.startsWith('docs/') ||
		path.startsWith('src/') ||
		path.startsWith('packages/') ||
		path.startsWith('scripts/') ||
		path.startsWith('tests/')
	) {
		return sourceExtensions.has(extname(path));
	}
	return (
		path === 'README.md' ||
		path === 'CONTRIBUTING.md' ||
		path === 'package.json' ||
		path === 'contributions.json' ||
		path === '.mcp.json' ||
		path === '.vscode-agent.json' ||
		path === 'pnpm-workspace.yaml' ||
		path === 'pnpm-lock.yaml' ||
		path === 'webpack.config.mjs' ||
		path === '.vscodeignore' ||
		path.startsWith('.vscode/') ||
		path.startsWith('.github/') ||
		/^tsconfig(?:\.[^.]+)?\.json$/.test(path)
	);
}

function checkText(path, source) {
	for (const [label, pattern] of forbidden) {
		if (pattern.test(source)) {
			errors.push(`${path}: ${label}`);
			return;
		}
	}
}

function checkLegalAttribution(path, source) {
	if (path.endsWith('ThirdPartyNotices.txt') && source.includes('LICENSE.plus')) {
		errors.push(`${path}: obsolete LICENSE.plus notice`);
	}
}

function checkCommercialLabels(path, source) {
	const normalized = source.normalize('NFKC').toLocaleLowerCase('en-US');
	if (/\bpro\b/.test(normalized) || /[ᴘᴾ][ʀᴿ][ᴏᴼ]/.test(source)) {
		errors.push(`${path}: commercial label`);
	}
}

async function getFiles() {
	const { stdout } = await execFileAsync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root });
	const files = [];
	for (const path of stdout.split('\n').filter(Boolean)) {
		try {
			await access(resolve(root, path));
			files.push(path);
		} catch {
			// Staged deletions are not active files.
		}
	}
	return files;
}

async function checkRegistration(path, expected) {
	const source = await readFile(resolve(root, path), 'utf8');
	if (!expected.every(value => source.includes(value))) {
		errors.push(`${path}: missing retained command registration`);
	}
}

async function checkRegistrations() {
	await checkRegistration('src/commands.ts', [
		"import './commands/patches.js';",
		"import './commands/rebaseEditor.js';",
		"import './commands/remoteProviders.js';",
		"import './commands/stashSave.js';",
	]);
	await checkRegistration('src/commands/showView.ts', ["'gitlens.showCommitDetailsView'"]);
	await checkRegistration('src/commands/patches.ts', [
		'@command()',
		"'gitlens.createPatch'",
		"'gitlens.applyPatchFromClipboard'",
		"'gitlens.openPatch'",
	]);
	await checkRegistration('src/commands/stashSave.ts', ['@command()', "'gitlens.stashSave'"]);
	await checkRegistration('src/commands/gitWizard.ts', [
		'@command()',
		"'gitlens.git.stash'",
		"'gitlens.git.stash.push'",
	]);
	await checkRegistration('src/commands/rebaseEditor.ts', ['@command()', "'gitlens.rebase.enableEditor'"]);
	await checkRegistration('src/commands/remoteProviders.ts', [
		'@command()',
		"'gitlens.connectRemoteProvider'",
		"'gitlens.disconnectRemoteProvider'",
	]);
	await checkRegistration('src/webviews/graph/registration.ts', [
		"registerCommand('gitlens.showGraph'",
		"registerCommand('gitlens.showInCommitGraph'",
	]);
	await checkRegistration('src/webviews/settings/registration.ts', ["id: 'gitlens.showSettingsPage'"]);
	await checkRegistration('src/env/node/mcp/localMcpService.ts', ["'gitlens.mcp.enable'", 'registerCommand']);
	await checkRegistration('src/container.ts', [
		'registerGraphWebviewCommands(this, graphPanels)',
		'registerSettingsWebviewCommands(settingsPanels)',
		'getMcpService(this)',
	]);
	await checkRegistration('src/views/views.ts', ['registerCommitDetailsWebviewView(webviews)']);
}

async function checkTestDiscovery() {
	const source = await readFile(resolve(root, 'scripts/esbuild.tests.mjs'), 'utf8');
	if (!source.includes("entry.name.endsWith('.test.ts')") || !source.includes('getTestEntryPoints()')) {
		errors.push('scripts/esbuild.tests.mjs: retained source test discovery is curated');
	}
}

async function checkMigrationSettingsStorage() {
	const legacyMigration = new RegExp(
		[
			['views', 'legacy:hidden'].join('.'),
			['views', 'pendingLegacyHide'].join(':'),
			['apply', 'PendingLegacyViewHiding'].join(''),
		].join('|'),
	);
	for (const path of ['src/settingsMigrations.ts', 'src/extension.ts', 'src/constants.storage.ts', 'package.json']) {
		const source = await readFile(resolve(root, path), 'utf8');
		if (legacyMigration.test(source)) {
			errors.push(`${path}: obsolete product view migration`);
		}
	}
}

function checkManifest(manifest, path) {
	checkText(path, JSON.stringify(manifest));
	for (const configuration of manifest.contributes?.configuration ?? []) {
		checkCommercialLabels(path, configuration.title ?? '');
	}
	for (const command of manifest.contributes?.commands ?? []) {
		checkCommercialLabels(path, command.title ?? '');
	}
	for (const submenu of manifest.contributes?.submenus ?? []) {
		checkCommercialLabels(path, submenu.label ?? '');
	}
	const commands = manifest.contributes?.commands ?? [];
	const commandIds = new Set(commands.map(command => command.command));
	for (const command of retainedCommands) {
		if (!commandIds.has(command)) {
			errors.push(`${path}: missing retained command ${command}`);
		}
	}
}

async function checkVsix(artifact) {
	const archive = resolve(root, artifact);
	try {
		await access(archive);
	} catch {
		errors.push(`VSIX: expected artifact ${artifact} does not exist`);
		return;
	}

	const { stdout } = await execFileAsync('unzip', ['-Z1', archive], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
	const paths = stdout.split('\n').filter(Boolean);
	if (!paths.includes('extension/dist/mcp-server/server.js')) {
		errors.push(`${artifact}: missing local MCP server extension/dist/mcp-server/server.js`);
	}

	for (const path of paths) {
		const normalized = path.replace(/^extension\//, '');
		if (isLegalAttribution(normalized)) {
			const { stdout: contents } = await execFileAsync('unzip', ['-p', archive, path], {
				cwd: root,
				maxBuffer: 64 * 1024 * 1024,
			});
			checkLegalAttribution(`${artifact}:${path}`, contents);
			continue;
		}
		if (normalized === 'CHANGELOG.md') continue;
		if (removedPaths.some(removed => normalized === removed || normalized.startsWith(`${removed}/`))) {
			errors.push(`${archive}:${path}: removed product artifact remains`);
		}
		checkText(`${archive}:${path}`, path);
		if (!path.startsWith('extension/')) continue;

		const { stdout: contents } = await execFileAsync('unzip', ['-p', archive, path], {
			cwd: root,
			maxBuffer: 64 * 1024 * 1024,
		});
		if (normalized === 'package.json') {
			checkManifest(JSON.parse(contents), `${archive}:${path}`);
		} else {
			checkText(`${archive}:${path}`, contents);
		}
	}
}

const files = await getFiles();
for (const path of removedPaths) {
	if (files.some(file => file === path || file.startsWith(`${path}/`))) {
		errors.push(`${path}: removed product artifact remains`);
	}
}
for (const path of files.filter(isScanned)) {
	checkText(path, await readFile(resolve(root, path), 'utf8'));
}
for (const path of files.filter(isLegalAttribution)) {
	checkLegalAttribution(path, await readFile(resolve(root, path), 'utf8'));
}

const contributions = JSON.parse(await readFile(resolve(root, 'contributions.json'), 'utf8'));
for (const command of Object.values(contributions.commands)) {
	checkCommercialLabels('contributions.json', command.label ?? '');
}
for (const submenu of Object.values(contributions.submenus)) {
	checkCommercialLabels('contributions.json', submenu.label ?? '');
}
for (const command of retainedCommands) {
	if (contributions.commands[command] == null) {
		errors.push(`contributions.json: missing retained command ${command}`);
	}
}

const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
checkManifest(manifest, 'package.json');
await checkRegistrations();
await checkTestDiscovery();
await checkMigrationSettingsStorage();
const vsixIndex = process.argv.indexOf('--vsix');
if (vsixIndex !== -1) {
	const artifact = process.argv[vsixIndex + 1];
	if (artifact == null || artifact.startsWith('--')) {
		errors.push('VSIX: --vsix requires an explicit artifact path');
	} else {
		await checkVsix(artifact);
	}
}

if (errors.length !== 0) {
	console.error(`[verify-cleanroom-ui] ${errors.length} policy violation${errors.length === 1 ? '' : 's'}`);
	for (const error of errors) {
		console.error(`- ${error}`);
	}
	process.exitCode = 1;
} else {
	console.log(
		`[verify-cleanroom-ui] ${files.filter(isScanned).length} active files, generated manifest, and registrations clean`,
	);
}
