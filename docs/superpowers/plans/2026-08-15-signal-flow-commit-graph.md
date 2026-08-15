# Signal Flow Commit Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Signal Flow full-height Commit Graph workspace with daily exploration, selection, and commit workflow support.

**Architecture:** Expand the graph protocol and `GraphSessionController` to make repository context, filtering, details, and supported actions available to the Lit app. Keep the virtualized graph as the central canvas; compose its command deck, reference rail, inspector, and minimap from focused graph-app components/state, and persist only display preferences in webview state.

**Tech Stack:** TypeScript, VS Code extension APIs, Lit, `@lit-labs/virtualizer`, existing GitLens graph sessions/commands, CSS container queries.

## Global Constraints

- Support both desktop Node and browser VS Code targets through existing `@env/` abstractions where applicable.
- Do not add dependencies or a parallel command framework; reuse existing Graph commands and Git providers.
- Keep protocol input bounded and validated before use.
- Use explicit `.js` local import extensions, `import type`, strict TypeScript, and GitLens import order.
- Preserve keyboard navigation, forced-colors behavior, focus indicators, and list semantics.
- Use CSS custom properties and container queries; do not use SCSS syntax inside Lit `css` templates.
- Do not edit generated contribution sections in `package.json`; edit `contributions.json` and run the generator if contributions change.

---

## File Structure

- Modify `src/webviews/graph/protocol.ts`: define bounded context, filter, selection, detail, and action messages.
- Modify `src/webviews/graph/graphSessionController.ts`: serialize refresh/filter/detail operations around the graph session.
- Modify `src/webviews/graph/graphWebview.ts`: resolve repository context and selected commit data; route supported graph actions.
- Modify `src/webviews/apps/graph/graph.ts`: compose workspace state, virtualized canvas, selection, inspector, and minimap interactions.
- Modify `src/webviews/apps/graph/graph.css.ts`: establish the Signal Flow layout and responsive styles.
- Create `src/webviews/apps/graph/graphState.ts`: pure graph app state transitions and persisted display preferences.
- Create `src/webviews/apps/graph/graphSelection.ts`: pure range/toggle selection helpers.
- Create `src/webviews/apps/graph/graphMinimap.ts`: pure row-index/scroll-position conversion helpers.
- Create focused unit tests beside the new helpers and extend existing graph protocol/app/host tests.

### Task 1: Define Bounded Workspace Messages

**Files:**

- Modify: `src/webviews/graph/protocol.ts`
- Test: `src/webviews/apps/graph/__tests__/graph.test.ts`
- Test: `src/webviews/graph/__tests__/graphSessionController.test.ts`

**Interfaces:**

- Produces `GraphWorkspaceContext`, `GraphCommitDetails`, `GraphFilterRequest`, `GraphDetailsRequest`, and `GraphDisplayPreferences`.
- Extends `GraphHostMessage` and `GraphWebviewMessage` with parsed, bounded workspace messages.

- [ ] **Step 1: Write failing protocol parsing tests**

```ts
test('parses bounded workspace context and details messages', () => {
	assert.deepStrictEqual(
		parseGraphHostMessage({
			type: 'graph/context',
			repository: { name: 'vscode-gitlens', branch: 'main' },
			refs: [{ type: 'head', name: 'main' }],
		}),
		expectedContext,
	);
});

test('rejects unbounded graph filter and detail requests', () => {
	assert.strictEqual(parseGraphWebviewMessage({ type: 'graph/filter', query: 'x'.repeat(10001) }), undefined);
	assert.strictEqual(parseGraphWebviewMessage({ type: 'graph/details', sha: 'not a sha' }), undefined);
});
```

- [ ] **Step 2: Run the targeted tests and confirm failure**

Run: `pnpm exec mocha --require out/test/setup.js out/webviews/apps/graph/__tests__/graph.test.js`

Expected: FAIL because the workspace message types and parsers do not exist.

- [ ] **Step 3: Add minimal bounded protocol types and parsers**

```ts
export type GraphFilterRequest = { readonly type: 'graph/filter'; readonly query: string };
export type GraphDetailsRequest = {
	readonly type: 'graph/details';
	readonly sha: string;
	readonly includeFiles: boolean;
};

function parseGraphFilterRequest(value: Record<string, unknown>): GraphFilterRequest | undefined {
	if (!isString(value.query, graphQueryMaxLength)) return undefined;

	return { type: 'graph/filter', query: value.query };
}
```

Include explicit maximums for query text, refs, detail files, and display-preference arrays. Preserve existing messages unchanged.

- [ ] **Step 4: Run the targeted tests and confirm pass**

Run: `pnpm exec mocha --require out/test/setup.js out/webviews/apps/graph/__tests__/graph.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webviews/graph/protocol.ts src/webviews/apps/graph/__tests__/graph.test.ts
```

### Task 2: Add Host Workspace Data and Operations

**Files:**

- Modify: `src/webviews/graph/graphSessionController.ts`
- Modify: `src/webviews/graph/graphWebview.ts`
- Modify: `src/webviews/graph/__tests__/graphSessionController.test.ts`
- Modify: `src/webviews/graph/__tests__/graphWebview.test.ts`

**Interfaces:**

- Consumes `GraphFilterRequest` and `GraphDetailsRequest` from Task 1.
- Produces context/detail host notifications and serializes graph refresh/filter/detail requests.

- [ ] **Step 1: Write failing host/controller tests**

```ts
test('serializes filter after an active graph operation', async () => {
	await controller.filter('author:ada');
	assert.deepStrictEqual(messages.at(-1), { type: 'graph/replace', rows: expectedRows, paging: { hasMore: false } });
});

test('requests selected commit details only for the active repository', () => {
	provider.onMessageReceived(message('graph/details', { sha: 'abcdef', includeFiles: false }));
	assert.strictEqual(repository.git.commits.getCommit.calledOnce, true);
});
```

- [ ] **Step 2: Run host/controller tests and confirm failure**

Run: `pnpm exec mocha --require out/test/setup.js out/webviews/graph/__tests__/graphSessionController.test.js out/webviews/graph/__tests__/graphWebview.test.js`

Expected: FAIL because `filter` and detail routing are unavailable.

- [ ] **Step 3: Implement the smallest host flow**

```ts
case 'graph/filter':
	void this.controller?.refresh({ search: request.query });
	break;
case 'graph/details':
	void this.sendCommitDetails(request);
	break;
```

Add `GraphSessionController.filter(query: string): Promise<void>` only if the underlying session API cannot accept the refresh options directly. Post a context message after `open()`, preserve prior rows on errors, and ignore detail results if the request is stale.

- [ ] **Step 4: Run host/controller tests and confirm pass**

Run: `pnpm exec mocha --require out/test/setup.js out/webviews/graph/__tests__/graphSessionController.test.js out/webviews/graph/__tests__/graphWebview.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webviews/graph/graphSessionController.ts src/webviews/graph/graphWebview.ts src/webviews/graph/__tests__
```

### Task 3: Add Pure Graph Display and Selection State

**Files:**

- Create: `src/webviews/apps/graph/graphState.ts`
- Create: `src/webviews/apps/graph/graphSelection.ts`
- Create: `src/webviews/apps/graph/graphMinimap.ts`
- Create: `src/webviews/apps/graph/__tests__/graphState.test.ts`
- Create: `src/webviews/apps/graph/__tests__/graphSelection.test.ts`
- Create: `src/webviews/apps/graph/__tests__/graphMinimap.test.ts`

**Interfaces:**

- Produces `applyGraphWorkspaceMessage`, `toggleGraphColumn`, `selectGraphRows`, and `getMinimapTargetIndex`.
- Consumed by `GlGraphApp` in Task 4.

- [ ] **Step 1: Write failing pure-helper tests**

```ts
test('selects an inclusive shift range from the active row', () => {
	assert.deepStrictEqual(selectGraphRows(['a', 'b', 'c', 'd'], ['b'], 'd', { range: true }), ['b', 'c', 'd']);
});

test('toggles a row without discarding other selected rows', () => {
	assert.deepStrictEqual(selectGraphRows(['a', 'b'], ['a'], 'b', { toggle: true }), ['a', 'b']);
});

test('maps a minimap pointer to a loaded row index', () => {
	assert.strictEqual(getMinimapTargetIndex(75, 100, 200), 150);
});
```

- [ ] **Step 2: Run pure-helper tests and confirm failure**

Run: `pnpm exec mocha --require out/test/setup.js out/webviews/apps/graph/__tests__/graphState.test.js out/webviews/apps/graph/__tests__/graphSelection.test.js out/webviews/apps/graph/__tests__/graphMinimap.test.js`

Expected: FAIL because the helper modules do not exist.

- [ ] **Step 3: Implement pure helpers with no DOM dependencies**

```ts
export function getMinimapTargetIndex(offset: number, height: number, rowCount: number): number {
	if (rowCount === 0 || height <= 0) return 0;

	return Math.min(rowCount - 1, Math.max(0, Math.floor((offset / height) * rowCount)));
}
```

Model display preferences as `{ columns: readonly GraphColumn[]; compact: boolean; minimap: boolean }`, and ensure every state transition returns immutable values.

- [ ] **Step 4: Run pure-helper tests and confirm pass**

Run: `pnpm exec mocha --require out/test/setup.js out/webviews/apps/graph/__tests__/graphState.test.js out/webviews/apps/graph/__tests__/graphSelection.test.js out/webviews/apps/graph/__tests__/graphMinimap.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webviews/apps/graph/graphState.ts src/webviews/apps/graph/graphSelection.ts src/webviews/apps/graph/graphMinimap.ts src/webviews/apps/graph/__tests__
```

### Task 4: Compose the Signal Flow Workspace

**Files:**

- Modify: `src/webviews/apps/graph/graph.ts`
- Modify: `src/webviews/apps/graph/__tests__/graph.test.ts`

**Interfaces:**

- Consumes Task 1 protocol messages and Task 3 state helpers.
- Produces command deck, reference rail, sticky graph header, multi-selection behavior, inspector, and minimap UI.

- [ ] **Step 1: Write failing app behavior tests**

```ts
test('posts a filter request after a committed search input', () => {
	assert.deepStrictEqual(getGraphFilterRequest('author:ada'), { type: 'graph/filter', query: 'author:ada' });
});

test('keeps the active row when a multi-selection is toggled', () => {
	assert.deepStrictEqual(updateGraphSelection(['a'], 'b', { toggle: true }), { active: 'b', selected: ['a', 'b'] });
});
```

- [ ] **Step 2: Run the graph app tests and confirm failure**

Run: `pnpm exec mocha --require out/test/setup.js out/webviews/apps/graph/__tests__/graph.test.js`

Expected: FAIL because filter and multi-selection app helpers do not exist.

- [ ] **Step 3: Implement the workspace composition**

```ts
override render(): unknown {
	return html`<main class="workspace">
		${this.renderCommandDeck()}
		${this.renderReferenceRail()}
		<section class="canvas">${this.renderColumnHeader()}${this.renderRows()}</section>
		${this.renderMinimap()}
		${this.renderInspector()}
	</main>`;
}
```

Use native `<button>`, `<input type="search">`, and `<details>` controls. Persist preferences with the existing webview-state facility in `SignalWatcherWebviewApp`; do not add storage. Debounce only committed search input and post one validated `graph/filter` request. Keep existing double-click/open, context menu, paging, and keyboard navigation behavior.

- [ ] **Step 4: Run graph app tests and confirm pass**

Run: `pnpm exec mocha --require out/test/setup.js out/webviews/apps/graph/__tests__/graph.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webviews/apps/graph/graph.ts src/webviews/apps/graph/__tests__/graph.test.ts
```

### Task 5: Apply the Signal Flow Responsive Design

**Files:**

- Modify: `src/webviews/apps/graph/graph.css.ts`
- Test: `src/webviews/apps/graph/__tests__/graph.test.ts`

**Interfaces:**

- Consumes CSS classes emitted by Task 4: `workspace`, `command-deck`, `reference-rail`, `canvas`, `column-header`, `rows`, `minimap`, and `inspector`.
- Produces full-height desktop and constrained sidebar layouts without horizontal row clipping.

- [ ] **Step 1: Add failing display-rule tests**

```ts
test('uses only graph, message, and refs columns in compact mode', () => {
	assert.deepStrictEqual(getVisibleGraphColumns({ compact: true, columns: defaultGraphColumns }), [
		'graph',
		'message',
		'refs',
	]);
});
```

- [ ] **Step 2: Run the graph app tests and confirm failure**

Run: `pnpm exec mocha --require out/test/setup.js out/webviews/apps/graph/__tests__/graph.test.js`

Expected: FAIL because compact visible-column logic is unavailable.

- [ ] **Step 3: Implement CSS and compact display rules**

```ts
@container (max-width: 58rem) {
	.minimap,
	.column--author,
	.column--date,
	.column--sha {
		display: none;
	}
}
```

Set `:host`, `.workspace`, `.canvas`, and `.rows` to use available block size so the graph fills both an editor and a view container. Use only VS Code and `--gl-*` tokens, visible focus styling, forced-colors overrides, and a restrained lane palette defined as CSS custom properties.

- [ ] **Step 4: Run graph app tests and confirm pass**

Run: `pnpm exec mocha --require out/test/setup.js out/webviews/apps/graph/__tests__/graph.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webviews/apps/graph/graph.css.ts src/webviews/apps/graph/__tests__/graph.test.ts
```

### Task 6: Validate End-to-End Graph Behavior

**Files:**

- Modify: `tests/e2e/specs/graph.test.ts`
- Modify: `docs/graph-keyboard.md`

**Interfaces:**

- Consumes completed workspace behavior from Tasks 1-5.
- Produces regression coverage for panel and sidebar graph surfaces plus updated keyboard documentation.

- [ ] **Step 1: Add failing E2E and keyboard documentation assertions**

```ts
test('shows the command deck, commit canvas, and inspector for a selected commit', async () => {
	await graphPage.open();
	await expect(graphPage.commandDeck).toBeVisible();
	await graphPage.selectCommit(0);
	await expect(graphPage.inspector).toBeVisible();
});
```

Document Shift range selection, Ctrl/Cmd toggle selection, and Escape inspector focus restoration in `docs/graph-keyboard.md`.

- [ ] **Step 2: Run the focused E2E test and confirm failure**

Run: `pnpm run test:e2e -- --grep "command deck, commit canvas"`

Expected: FAIL until the workspace controls are reachable from the page object.

- [ ] **Step 3: Update graph page object/selectors and complete E2E coverage**

```ts
await page.getByRole('searchbox', { name: 'Filter commits' }).fill('author:ada');
await page.getByRole('option').nth(0).click();
await expect(page.getByRole('region', { name: 'Commit details' })).toBeVisible();
```

Use accessible role/name selectors. Exercise filter submission, row selection, inspector close/focus return, and narrow viewport behavior.

- [ ] **Step 4: Run focused E2E, check, and build**

Run: `pnpm run test:e2e -- --grep "Commit Graph"`

Expected: PASS.

Run: `pnpm run check`

Expected: PASS.

Run: `pnpm run build`

Expected: PASS, including Node and browser targets.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/specs/graph.test.ts docs/graph-keyboard.md
```

## Plan Review

- Spec coverage: Tasks 1-2 supply bounded host data/actions; Task 3 supplies persisted display and interaction state; Task 4 supplies the full workspace; Task 5 supplies the visual identity and responsive behavior; Task 6 covers workflow, accessibility, and both build targets.
- Scope: saved views, topology minimap, and unsupported host commands are intentionally excluded from all tasks.
- Consistency: Task 1 names the protocol interfaces consumed by Tasks 2 and 4. Task 3 names pure helpers consumed by Task 4. CSS classes introduced in Task 4 are the exact classes styled in Task 5.
