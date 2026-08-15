import * as assert from 'node:assert';
import { Uri } from 'vscode';
import { isDescendant, isFolderGlobUri, splitPath } from '../path.js';

const smallDiskNameRegex = /^[a-z]:\//gm;
function capitalizeDiskName(path: string) {
	const match = smallDiskNameRegex.exec(path);
	if (!match) {
		return path;
	}
	return match[0].toUpperCase() + path.slice(match[0].length);
}

suite('Path Test Suite', () => {
	suite('splitPath Tests', () => {
		function assertSplitPath(actual: [string, string], expected: [string, string]) {
			assert.strictEqual(capitalizeDiskName(actual[0]), capitalizeDiskName(expected[0]));
			assert.strictEqual(capitalizeDiskName(actual[1]), capitalizeDiskName(expected[1]));
		}

		test('splitPath: no repoPath', () => {
			assertSplitPath(splitPath('C:\\User\\Name\\code\\example-org\\example-repo', ''), [
				'C:/User/Name/code/example-org/example-repo',
				'',
			]);

			assertSplitPath(splitPath('C:\\User\\Name\\code\\example-org\\example-repo\\', ''), [
				'C:/User/Name/code/example-org/example-repo',
				'',
			]);

			assertSplitPath(splitPath('C:/User/Name/code/example-org/example-repo', ''), [
				'C:/User/Name/code/example-org/example-repo',
				'',
			]);

			assertSplitPath(splitPath('C:/User/Name/code/example-org/example-repo/', ''), [
				'C:/User/Name/code/example-org/example-repo',
				'',
			]);
		});

		test('splitPath: no repoPath (split base)', () => {
			assertSplitPath(splitPath('C:\\User\\Name\\code\\example-org\\example-repo', '', true), [
				'example-repo',
				'C:/User/Name/code/example-org',
			]);

			assertSplitPath(splitPath('C:\\User\\Name\\code\\example-org\\example-repo\\', '', true), [
				'example-repo',
				'C:/User/Name/code/example-org',
			]);

			assertSplitPath(splitPath('C:/User/Name/code/example-org/example-repo', '', true), [
				'example-repo',
				'C:/User/Name/code/example-org',
			]);

			assertSplitPath(splitPath('C:/User/Name/code/example-org/example-repo/', '', true), [
				'example-repo',
				'C:/User/Name/code/example-org',
			]);
		});

		test('splitPath: match', () => {
			assertSplitPath(
				splitPath(
					'C:\\User\\Name\\code\\example-org\\example-repo\\foo\\bar\\baz.ts',
					'C:\\User\\Name\\code\\example-org\\example-repo',
				),
				['foo/bar/baz.ts', 'C:/User/Name/code/example-org/example-repo'],
			);

			assertSplitPath(
				splitPath(
					'C:\\User\\Name\\code\\example-org\\example-repo\\foo\\bar\\baz.ts',
					'C:\\User\\Name\\code\\example-org\\example-repo\\',
				),
				['foo/bar/baz.ts', 'C:/User/Name/code/example-org/example-repo'],
			);

			assertSplitPath(
				splitPath(
					'C:\\User\\Name\\code\\example-org\\example-repo\\foo\\bar\\baz.ts',
					'C:/User/Name/code/example-org/example-repo',
				),
				['foo/bar/baz.ts', 'C:/User/Name/code/example-org/example-repo'],
			);

			assertSplitPath(
				splitPath(
					'C:\\User\\Name\\code\\example-org\\example-repo\\foo\\bar\\baz.ts',
					'C:/User/Name/code/example-org/example-repo/',
				),
				['foo/bar/baz.ts', 'C:/User/Name/code/example-org/example-repo'],
			);

			assertSplitPath(
				splitPath(
					'C:/User/Name/code/example-org/example-repo/foo/bar/baz.ts',
					'C:/User/Name/code/example-org/example-repo',
				),
				['foo/bar/baz.ts', 'C:/User/Name/code/example-org/example-repo'],
			);

			assertSplitPath(
				splitPath(
					'C:/User/Name/code/example-org/example-repo/foo/bar/baz.ts',
					'C:/User/Name/code/example-org/example-repo/',
				),
				['foo/bar/baz.ts', 'C:/User/Name/code/example-org/example-repo'],
			);
		});

		test.skip('splitPath: match (casing)', () => {
			assertSplitPath(
				splitPath(
					'C:/USER/NAME/CODE/EXAMPLE-ORG/EXAMPLE-REPO/FOO/BAR/BAZ.TS',
					'C:/User/Name/code/example-org/example-repo/',
					undefined,
					true,
				),
				['FOO/BAR/BAZ.TS', 'C:/USER/NAME/CODE/EXAMPLE-ORG/EXAMPLE-REPO'],
			);

			assertSplitPath(
				splitPath(
					'C:/USER/NAME/CODE/EXAMPLE-ORG/EXAMPLE-REPO/FOO/BAR/BAZ.TS',
					'C:/User/Name/code/example-org/example-repo/',
					undefined,
					false,
				),
				['USER/NAME/CODE/EXAMPLE-ORG/EXAMPLE-REPO/FOO/BAR/BAZ.TS', 'C:'],
			);

			assertSplitPath(
				splitPath(
					'/USER/NAME/CODE/EXAMPLE-ORG/EXAMPLE-REPO/FOO/BAR/BAZ.TS',
					'/User/Name/code/example-org/example-repo/',
					undefined,
					true,
				),
				['FOO/BAR/BAZ.TS', '/USER/NAME/CODE/EXAMPLE-ORG/EXAMPLE-REPO'],
			);

			assertSplitPath(
				splitPath(
					'/USER/NAME/CODE/EXAMPLE-ORG/EXAMPLE-REPO/FOO/BAR/BAZ.TS',
					'/User/Name/code/example-org/example-repo/',
					undefined,
					false,
				),
				['/USER/NAME/CODE/EXAMPLE-ORG/EXAMPLE-REPO/FOO/BAR/BAZ.TS', '/User/Name/code/example-org/example-repo'],
			);
		});

		test.skip('splitPath: no match', () => {
			assertSplitPath(
				splitPath(
					'/foo/User/Name/code/example-org/example-repo/foo/bar/baz.ts',
					'/User/Name/code/example-org/example-repo',
				),
				[
					'/foo/User/Name/code/example-org/example-repo/foo/bar/baz.ts',
					'/User/Name/code/example-org/example-repo',
				],
			);
		});
	});

	suite('isDescendant Tests', () => {
		test('string paths - basic functionality', () => {
			// Basic case
			assert.strictEqual(isDescendant('/path/to/file', '/path'), true);
			assert.strictEqual(isDescendant('/path/to/file', '/other'), false);

			// Root path
			assert.strictEqual(isDescendant('/anything', '/'), true);

			// Trailing slashes in base
			assert.strictEqual(isDescendant('/path/to/file', '/path/'), true);
			// Folder glob in base
			assert.strictEqual(isDescendant('/path/to/file', '/path/*'), true);

			// Exact match should not match
			assert.strictEqual(isDescendant('/path', '/path'), false);
			// Partial path segment should not match
			assert.strictEqual(isDescendant('/pathExtra/to/file', '/path'), false);
		});

		test('URI paths - basic functionality', () => {
			const baseUri = Uri.parse('file:///path');
			const fileUri = Uri.parse('file:///path/to/file');
			const otherUri = Uri.parse('file:///other/path');

			assert.strictEqual(isDescendant(fileUri, baseUri), true);
			assert.strictEqual(isDescendant(otherUri, baseUri), false);

			// Different schemes
			const httpUri = Uri.parse('http:///path/to/file');
			assert.strictEqual(isDescendant(httpUri, baseUri), false);

			// Different authorities
			const diffAuthorityUri = Uri.parse('file://server1/path/to/file');
			const baseAuthorityUri = Uri.parse('file://server2/path');
			assert.strictEqual(isDescendant(diffAuthorityUri, baseAuthorityUri), false);
		});

		test('mixed string and URI paths', () => {
			const baseUri = Uri.parse('file:///base/path');

			assert.strictEqual(isDescendant('/base/path/to/file', baseUri), true);
			assert.strictEqual(isDescendant('/other/path', baseUri), false);

			assert.strictEqual(isDescendant(Uri.parse('file:///base/path/file'), '/base/path'), true);
			assert.strictEqual(isDescendant(Uri.parse('file:///other/path'), '/base/path'), false);
		});

		test('edge cases', () => {
			// Empty paths
			assert.strictEqual(isDescendant('', '/'), true);
			assert.strictEqual(isDescendant('/', ''), true);

			// URI with query parameters
			const baseUri = Uri.parse('file:///base/path');
			const uriWithQuery = Uri.parse('file:///base/path/file?query=value');

			assert.strictEqual(isDescendant(uriWithQuery, baseUri), true);
		});
	});

	suite('isFolderGlobUri Tests', () => {
		test('URI with glob pattern', () => {
			assert.strictEqual(isFolderGlobUri(Uri.parse('file:///path/*')), true);
			assert.strictEqual(isFolderGlobUri(Uri.parse('file:///path/to/*')), true);
		});

		test('URI without glob pattern', () => {
			assert.strictEqual(isFolderGlobUri(Uri.parse('file:///path')), false);
			assert.strictEqual(isFolderGlobUri(Uri.parse('file:///path/file.txt')), false);
			assert.strictEqual(isFolderGlobUri(Uri.parse('file:///path/dir/')), false);
		});

		test('Edge cases', () => {
			assert.strictEqual(isFolderGlobUri(Uri.parse('file:///*')), true);
			assert.strictEqual(isFolderGlobUri(Uri.parse('http:///path/*')), true);
		});
	});
});
