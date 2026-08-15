import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Uri } from 'vscode';
import { getLocalMcpServerDefinition } from '../env/node/mcp/localMcpService.js';
import { LocalSubscriptionService } from '../localSubscriptionService.js';

const repoRoot = process.cwd();
const execFileAsync = promisify(execFile);

suite('LocalSubscriptionService', () => {
	test('makes local access available without product account prompts', async () => {
		const service = new LocalSubscriptionService() as LocalSubscriptionService & {
			getAccess?: () => Promise<{ available: true }>;
		};

		assert.deepEqual(await service.getAccess?.(), { available: true });

		for (const method of [
			'aiAllAccessOptIn',
			'autoResetTrialIfEligible',
			'getAuthenticationSession',
			'getFeaturePreview',
			'getSubscription',
			'loginOrSignUp',
			'loginWithCode',
			'manageSubscription',
			'resendVerification',
			'upgrade',
		]) {
			assert.ok(!(method in service), `must not expose ${method}`);
		}
	});
});

suite('Core subscription boundary', () => {
	test('rejects an in-tree removed-feature command fixture', async () => {
		const fixture = resolve(repoRoot, 'src/plus/__cleanroom-fixture.ts');
		await mkdir(resolve(repoRoot, 'src/plus'), { recursive: true });
		await writeFile(fixture, 'export const fixture = true;\n');

		try {
			await assert.rejects(
				execFileAsync('node', ['scripts/verifyCleanroomUi.mjs'], { cwd: repoRoot }),
				/\[verify-cleanroom-ui\][\s\S]*src\/plus/,
			);
		} finally {
			await rm(resolve(repoRoot, 'src/plus'), { force: true, recursive: true });
		}
	});

	test('rejects a stylized plan label in contributions', async () => {
		const fixture = resolve(repoRoot, 'contributions.json');
		const original = await readFile(fixture, 'utf8');
		const contributions = JSON.parse(original);
		const stylizedLabel = String.fromCharCode(0x1d18, 0x280, 0x1d0f);
		contributions.commands['gitlens.__cleanroom-label-fixture'] = { label: stylizedLabel };
		await writeFile(fixture, `${JSON.stringify(contributions)}\n`);

		try {
			await assert.rejects(
				execFileAsync('node', ['scripts/verifyCleanroomUi.mjs'], { cwd: repoRoot }),
				/\[verify-cleanroom-ui\][\s\S]*commercial label/,
			);
		} finally {
			await writeFile(fixture, original);
		}
	});

	test('checks the specified VSIX instead of a preexisting artifact', async () => {
		const fixture = 'offline-gitlense-cleanroom-fixture.vsix';
		const staleFixture = 'offline-gitlense-cleanroom-stale-fixture.vsix';
		const fixtureDirectory = resolve(repoRoot, '.cleanroom-vsix-fixture');
		const staleFixtureDirectory = resolve(repoRoot, '.cleanroom-vsix-stale-fixture');
		const manifest = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
		const serverPath = relative('/extension', getLocalMcpServerDefinition(Uri.file('/extension')).args[0]);

		await mkdir(resolve(fixtureDirectory, 'extension'), { recursive: true });
		await writeFile(resolve(fixtureDirectory, 'extension/package.json'), `${JSON.stringify(manifest)}\n`);
		await mkdir(resolve(fixtureDirectory, 'extension', dirname(serverPath)), { recursive: true });
		await writeFile(resolve(fixtureDirectory, 'extension', serverPath), 'server');
		await execFileAsync('zip', ['-q', '-r', resolve(repoRoot, fixture), 'extension'], { cwd: fixtureDirectory });

		manifest.displayName = ['Git', 'Kraken'].join('');
		await mkdir(resolve(staleFixtureDirectory, 'extension'), { recursive: true });
		await writeFile(resolve(staleFixtureDirectory, 'extension/package.json'), `${JSON.stringify(manifest)}\n`);
		await execFileAsync('zip', ['-q', '-r', resolve(repoRoot, staleFixture), 'extension'], {
			cwd: staleFixtureDirectory,
		});

		try {
			await execFileAsync('node', ['scripts/verifyCleanroomUi.mjs', '--vsix', fixture], { cwd: repoRoot });
			await assert.rejects(
				execFileAsync('node', ['scripts/verifyCleanroomUi.mjs', '--vsix', staleFixture], { cwd: repoRoot }),
				/cleanroom-stale-fixture\.vsix:extension\/package\.json: product text/,
			);
		} finally {
			await rm(resolve(repoRoot, fixture), { force: true });
			await rm(fixtureDirectory, { force: true, recursive: true });
			await rm(resolve(repoRoot, staleFixture), { force: true });
			await rm(staleFixtureDirectory, { force: true, recursive: true });
		}
	});

	test('requires the local MCP server in the VSIX', async () => {
		const fixture = 'offline-gitlense-cleanroom-fixture.vsix';
		const fixtureDirectory = resolve(repoRoot, '.cleanroom-vsix-fixture');
		const manifest = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));

		await mkdir(resolve(fixtureDirectory, 'extension'), { recursive: true });
		await writeFile(resolve(fixtureDirectory, 'extension/package.json'), `${JSON.stringify(manifest)}\n`);
		await execFileAsync('zip', ['-q', '-r', resolve(repoRoot, fixture), 'extension'], { cwd: fixtureDirectory });

		try {
			await assert.rejects(
				execFileAsync('node', ['scripts/verifyCleanroomUi.mjs', '--vsix', fixture], { cwd: repoRoot }),
				/cleanroom-fixture\.vsix: missing local MCP server/,
			);
		} finally {
			await rm(resolve(repoRoot, fixture), { force: true });
			await rm(fixtureDirectory, { force: true, recursive: true });
		}
	});

	test('rejects an obsolete LICENSE.plus notice in the VSIX', async () => {
		const fixture = 'offline-gitlense-cleanroom-fixture.vsix';
		const fixtureDirectory = resolve(repoRoot, '.cleanroom-vsix-fixture');
		const manifest = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
		const serverPath = relative('/extension', getLocalMcpServerDefinition(Uri.file('/extension')).args[0]);

		await mkdir(resolve(fixtureDirectory, 'extension', dirname(serverPath)), { recursive: true });
		await writeFile(resolve(fixtureDirectory, 'extension/package.json'), `${JSON.stringify(manifest)}\n`);
		await writeFile(resolve(fixtureDirectory, 'extension', serverPath), 'server');
		await writeFile(resolve(fixtureDirectory, 'extension/ThirdPartyNotices.txt'), 'LICENSE.plus\n');
		await execFileAsync('zip', ['-q', '-r', resolve(repoRoot, fixture), 'extension'], { cwd: fixtureDirectory });

		try {
			await assert.rejects(
				execFileAsync('node', ['scripts/verifyCleanroomUi.mjs', '--vsix', fixture], { cwd: repoRoot }),
				/cleanroom-fixture\.vsix:extension\/ThirdPartyNotices\.txt: obsolete LICENSE\.plus notice/,
			);
		} finally {
			await rm(resolve(repoRoot, fixture), { force: true });
			await rm(fixtureDirectory, { force: true, recursive: true });
		}
	});

	test('requires an explicit VSIX artifact path', async () => {
		await assert.rejects(
			execFileAsync('node', ['scripts/verifyCleanroomUi.mjs', '--vsix'], { cwd: repoRoot }),
			/VSIX: --vsix requires an explicit artifact path/,
		);
	});

	test('has no product view migration or activation commands', async () => {
		const migrations = await readSource('src/settingsMigrations.ts');
		const activation = await readSource('src/extension.ts');
		const storage = await readSource('src/constants.storage.ts');
		const legacyMigration = ['views', 'legacy:hidden'].join('.');
		const pendingStorage = ['views', 'pendingLegacyHide'].join(':');
		const activationHelper = ['apply', 'PendingLegacyViewHiding'].join('');
		const productViews = ['home', 'drafts', 'workspaces'].join('|');

		assert.doesNotMatch(migrations, new RegExp(`${legacyMigration}|${pendingStorage}`));
		assert.doesNotMatch(activation, new RegExp(`${activationHelper}|gitlens\\.views\\.(?:${productViews})\\.`));
		assert.doesNotMatch(storage, new RegExp(pendingStorage));
	});

	test('does not contribute obsolete product containers, commands, or agent metadata', async () => {
		const contributions = await readSource('contributions.json');
		const config = await readSource('packages/git/src/providers/config.ts');
		const branches = await readSource('packages/git-cli/src/providers/branches.ts');
		const branch = await readSource('packages/git/src/models/branch.ts');

		assert.doesNotMatch(contributions, /gitlensPatch|gitlens\.getStarted|gitlens:views:home/);
		assert.doesNotMatch(config, /gk-agent-last-activity/);
		assert.doesNotMatch(branches, /onCurrentBranchAgentActivity|gk-agent-last-activity/);
		assert.doesNotMatch(branch, /agentLastActivityAt/);
	});

	test('runs type-aware lint on active source but excludes declarations', async function (this: {
		timeout: (ms: number) => void;
	}) {
		this.timeout(240000);

		const activeFixture = resolve(repoRoot, 'src/__tests__/offlineRuntime.test.ts');
		const excludedFixture = resolve(repoRoot, 'src/@types/__cleanroom-lint-fixture.d.ts');
		const original = await readFile(activeFixture, 'utf8');
		await writeFile(excludedFixture, 'export default interface ExcludedLintFixture {}\n');
		await writeFile(activeFixture, `${original}\nexport default 1;\n`);

		try {
			await assert.rejects(execFileAsync('pnpm', ['run', 'check'], { cwd: repoRoot }), error => {
				assert.ok(error instanceof Error && 'stdout' in error);
				assert.match(String(error.stdout), /import\(no-default-export\)/);
				assert.doesNotMatch(String(error.stdout), /__cleanroom-lint-fixture\.d\.ts/);
				return true;
			});
		} finally {
			await writeFile(activeFixture, original);
			await rm(excludedFixture, { force: true });
		}
	});

	test('does not import product subscription models or declare product context keys', async () => {
		const files = await getCoreSourceFiles(resolve(repoRoot, 'src'));
		const forbiddenSubscriptionImport =
			/(?:models\/subscription|subscriptionService|utils\/subscription\.utils)\.js['"]/;
		const forbiddenContextKey = /gitlens:(?:plus|gk|ai|agents|promo|tabs:ai)/;

		for (const file of files) {
			const source = await readFile(file, 'utf8');
			assert.doesNotMatch(source, forbiddenSubscriptionImport, relative(repoRoot, file));
			assert.doesNotMatch(source, forbiddenContextKey, relative(repoRoot, file));
		}
	});

	test('does not depend on legacy integrations or product subscription code', async () => {
		const files = await getCoreSourceFiles(resolve(repoRoot, 'src'));
		const forbiddenImports = /(?:@gitlens\/integrations|\/(?:plus\/integrations|plus\/gk)\/)/;
		const forbiddenContainerMember = /\.integrations\b/;

		for (const file of files) {
			const source = await readFile(file, 'utf8');
			assert.doesNotMatch(source, forbiddenImports, relative(repoRoot, file));
			assert.doesNotMatch(source, forbiddenContainerMember, relative(repoRoot, file));
		}
	});

	test('checks every active resolved project source set without deferred product source', async () => {
		const checker = await readSource('scripts/checkCleanroom.mjs');

		assert.match(checker, /--showConfig/);
		assert.match(checker, /config\.files/);
		assert.match(checker, /linted \$\{lintedSourceFiles\} active source files/);
		assert.match(checker, /forbiddenPaths/);
		assert.doesNotMatch(checker, /lintEntries/);
		for (const path of ['packages/plus/', 'src/plus/', 'src/webviews/plus/', 'src/env/node/gk/']) {
			assert.match(checker, new RegExp(path));
		}

		for (const config of [
			'tsconfig.node.json',
			'tsconfig.browser.json',
			'tsconfig.test.json',
			'src/webviews/apps/tsconfig.json',
			'tsconfig.e2e.json',
		]) {
			const source = await readSource(config);
			const activeSource = source.replace(/"exclude"\s*:\s*\[[\s\S]*?\]/, '');
			assert.doesNotMatch(activeSource, /(?:packages|src)\/plus\//);
			assert.doesNotMatch(activeSource, /skipLibCheck/);
		}
	});
});

async function getCoreSourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			const relativePath = relative(resolve(repoRoot, 'src'), path);
			if (
				entry.name === 'plus' ||
				relativePath === 'agents' ||
				relativePath === 'env/node/gk' ||
				relativePath === 'webviews/plus' ||
				relativePath === 'webviews/apps/plus'
			) {
				continue;
			}

			files.push(...(await getCoreSourceFiles(path)));
		} else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
			files.push(path);
		}
	}
	return files;
}

function readSource(path: string): Promise<string> {
	return readFile(resolve(repoRoot, path), 'utf8');
}
