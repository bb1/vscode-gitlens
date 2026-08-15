// The `@gitlens/*` workspace packages the extension bundles from source. Their runtime dependencies
// ship inside dist/ just like the root's own, so anything reasoning about what we distribute (e.g.
// third-party licence notices) has to look at their manifests too.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** @returns {string[]} Absolute directories, one per bundled `@gitlens/*` package. */
export function getBundledPackageDirs() {
	const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
	const bundled = Object.entries(rootManifest.dependencies ?? {})
		.filter(([name, spec]) => name.startsWith('@gitlens/') && String(spec).startsWith('workspace:'))
		.map(([name]) => name);

	const dirs = [];
	for (const parent of [join(repoRoot, 'packages')]) {
		if (!existsSync(parent)) continue;

		for (const entry of readdirSync(parent)) {
			const manifestPath = join(parent, entry, 'package.json');
			if (!existsSync(manifestPath)) continue;

			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
			if (bundled.includes(manifest.name)) dirs.push(join(parent, entry));
		}
	}

	if (dirs.length !== bundled.length) {
		const found = new Set(dirs.map(dir => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name));
		const missing = bundled.filter(name => !found.has(name));
		throw new Error(`Could not locate every bundled @gitlens/* package under packages/: ${missing.join(', ')}`);
	}
	return dirs;
}

/** @returns {string[]} Absolute paths to the root manifest and every bundled package's manifest. */
export function getBundledManifestPaths() {
	return [join(repoRoot, 'package.json'), ...getBundledPackageDirs().map(dir => join(dir, 'package.json'))];
}
