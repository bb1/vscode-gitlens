import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const artifact = `${manifest.name}-${manifest.version}.vsix`;

rmSync(join(root, artifact), { force: true });

const packageResult = spawnSync(
	'pnpm',
	['exec', 'vsce', 'package', '--no-dependencies', '--out', artifact, ...process.argv.slice(2)],
	{ cwd: root, stdio: 'inherit' },
);
if (packageResult.status !== 0 || !existsSync(join(root, artifact))) {
	process.exit(packageResult.status ?? 1);
}

const verifyResult = spawnSync(process.execPath, ['./scripts/verifyCleanroomUi.mjs', '--vsix', artifact], {
	cwd: root,
	stdio: 'inherit',
});
process.exit(verifyResult.status ?? 1);
