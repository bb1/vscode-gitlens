import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionId = 'bb1.offline-gitlense';
const oldExtensionId = 'eamodio.gitlens';
const errors = [];

function fail(message) {
	errors.push(message);
}

function readText(file) {
	return readFileSync(join(root, file), 'utf8');
}

function readJson(file) {
	return JSON.parse(readText(file));
}

function readHeadJson(file) {
	return JSON.parse(readTextAtHead(file));
}

function readTextAtHead(file) {
	return execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function assertEqual(actual, expected, label) {
	if (actual !== expected) {
		fail(`${label} must be ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}`);
	}
}

function assertIncludes(value, expected, label) {
	if (!value.includes(expected)) {
		fail(`${label} must include ${JSON.stringify(expected)}`);
	}
}

function assertExcludes(value, expected, label) {
	if (value.includes(expected)) {
		fail(`${label} must not include ${JSON.stringify(expected)}`);
	}
}

function collectSettings(configurations, settings = new Set()) {
	for (const configuration of configurations ?? []) {
		for (const key of Object.keys(configuration.properties ?? {})) {
			settings.add(key);
		}

		for (const nested of configuration.allOf ?? []) {
			collectSettings([nested], settings);
		}
	}

	return settings;
}

function assertSameSetWithAllowedChanges(actual, expected, label, allowedMissing, allowedAdded) {
	const missing = [...expected].filter(value => !actual.has(value) && !allowedMissing.has(value));
	const added = [...actual].filter(value => !expected.has(value) && !allowedAdded.has(value));
	if (missing.length || added.length) {
		fail(`${label} changed (missing: ${missing.join(', ') || 'none'}; added: ${added.join(', ') || 'none'})`);
	}
}

const manifest = readJson('package.json');
const originalManifest = readHeadJson('package.json');
const contributions = readJson('contributions.json');
const originalContributions = readHeadJson('contributions.json');

assertEqual(manifest.publisher, 'bb1', 'package publisher');
assertEqual(manifest.name, 'offline-gitlense', 'package name');
assertEqual(`${manifest.publisher}.${manifest.name}`, extensionId, 'extension ID');
assertEqual(manifest.displayName, 'Offline GitLense', 'display name');
assertEqual(manifest.description, 'Offline GitLense is an offline-friendly Git extension for VS Code.', 'description');
assertEqual(manifest.author, 'bb1', 'author');
assertEqual(manifest.homepage, 'https://github.com/bb1/vscode-gitlens', 'homepage');
assertEqual(manifest.bugs?.url, 'https://github.com/bb1/vscode-gitlens/issues', 'bugs URL');
assertEqual(manifest.repository?.url, 'https://github.com/bb1/vscode-gitlens.git', 'repository URL');
assertEqual(manifest.badges, undefined, 'badges');
assertIncludes(manifest.keywords.join(','), 'offline-gitlense', 'keywords');

for (const command of Object.keys(contributions.commands)) {
	if (!command.startsWith('gitlens.')) {
		fail(`command ID must retain the gitlens.* namespace: ${command}`);
	}
}

const settings = collectSettings(manifest.contributes.configuration);
assertSameSetWithAllowedChanges(
	settings,
	collectSettings(originalManifest.contributes.configuration),
	'setting IDs',
	new Set(
		[...collectSettings(originalManifest.contributes.configuration)].filter(setting => {
			const removedPrefixes = [
				'ai',
				'cloudPatches',
				['git', 'kraken'].join(''),
				'launch' + 'pad',
				'plusFeatures',
			];
			return (
				removedPrefixes.some(prefix => setting.startsWith(`gitlens.${prefix}`)) ||
				['drafts', 'launch' + 'pad', 'patchDetails', 'workspaces'].some(view =>
					setting.startsWith(`gitlens.views.${view}.`),
				) ||
				setting === 'gitlens.views.scm.grouped.default' ||
				setting === 'gitlens.views.scm.grouped.views' ||
				setting === 'gitlens.views.scm.grouped.hiddenViews' ||
				setting.startsWith('gitlens.views.formats.') ||
				setting === ['gitlens', 'graph', 'branchesVisibility'].join('.') ||
				setting.startsWith(`${['gitlens', 'graph', 'experimental'].join('.')}.`)
			);
		}),
	),
	new Set(['gitlens.mcp.enabled']),
);
for (const setting of settings) {
	if (!setting.startsWith('gitlens.')) {
		fail(`setting ID must retain the gitlens.* namespace: ${setting}`);
	}
}

const contextKeys = readText('src/constants.context.ts');
for (const match of contextKeys.matchAll(/'([^']+)':/g)) {
	if (!match[1].startsWith('gitlens:')) {
		fail(`context key must retain the gitlens:* namespace: ${match[1]}`);
	}
}
for (const match of readText('src/constants.storage.ts').matchAll(/(?:'|`)(gitlens[^'`$]*)(?:'|`)/g)) {
	if (!match[1].startsWith('gitlens')) {
		fail(`storage key must retain the gitlens* namespace: ${match[1]}`);
	}
}

const activeIdentityFiles = [
	'.vscode-agent.json',
	'.vscode/launch.json',
	'.claude/skills/live-inspect/SKILL.md',
	'contributions.json',
	'docs/links.md',
	'package.json',
	'README.md',
	'CONTRIBUTING.md',
	'src/messages.ts',
	'src/uris/uriService.ts',
	'tests/e2e/baseTest.ts',
	'tests/e2e/pageObjects/gitLensPage.ts',
];
for (const file of activeIdentityFiles) {
	assertExcludes(readText(file), oldExtensionId, file);
}

assertEqual(readJson('.vscode-agent.json').extensionId, extensionId, '.vscode-agent.json extension ID');
assertIncludes(readText('.vscode/launch.json'), `*${extensionId}*`, '.vscode/launch.json URL filters');
assertIncludes(
	readText('contributions.json'),
	'extension =~ /^bb1\\\\.offline-gitlense$/ && extensionStatus == installed',
	'contributions extension predicates',
);
assertIncludes(readText('src/messages.ts'), `'${extensionId}'`, 'pre-release self-install commands');
assertIncludes(readText('src/uris/uriService.ts'), `vscode://${extensionId}/`, 'URI handler comment');
assertIncludes(readText('docs/links.md'), `vscode://${extensionId}/link`, 'deep-link documentation');
assertIncludes(readText('tests/e2e/baseTest.ts'), `'${extensionId}'`, 'E2E extension selector');
assertIncludes(readText('tests/e2e/pageObjects/gitLensPage.ts'), `extensionId=${extensionId}`, 'E2E webview selector');
assertIncludes(
	readText('src/constants.ts'),
	'https://github.com/bb1/vscode-gitlens/issues/new/choose',
	'GitHub issue URL',
);
assertIncludes(
	readText('src/constants.ts'),
	'https://github.com/bb1/vscode-gitlens/discussions',
	'GitHub discussion URL',
);

if (errors.length) {
	console.error(`Identity verification failed:\n\n${errors.map(error => `- ${error}`).join('\n')}`);
	process.exitCode = 1;
} else {
	console.log(`Identity verification passed for ${extensionId}`);
}
