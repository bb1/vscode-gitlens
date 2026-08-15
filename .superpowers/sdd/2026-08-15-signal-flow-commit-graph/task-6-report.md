# Task 6 Report

## Status

Complete. Added role/name-based E2E coverage for the sidebar graph workspace and Graph panel, commit filtering and selection, inspector Escape focus restoration, and a narrow viewport. Updated the graph keyboard documentation and included the approved Signal Flow spec and plan artifacts.

## Root-Cause Fixes

- The first workspace context notification could replace the queued graph bootstrap message before the webview became ready, leaving the live graph empty. Context is now sent after readiness when bootstrap delivery is complete.
- The inspector had no close state or Escape focus restoration. It now has a named region and close control; Escape closes it and focuses the active rendered commit row.

## Validation

- PASS: `pnpm exec playwright test -c tests/e2e/playwright.config.ts --project=vscode tests/e2e/specs/graph.test.ts`
  - 4 passed: sidebar graph, Graph panel, command deck/filter/selection/inspector Escape focus, narrow viewport.
- PASS: `pnpm run check`
- PASS: `pnpm run build`
  - Node and browser extension targets compiled successfully.
- PASS: `pnpm exec vscode-test --config .vscode-test.mjs --run out/tests/webviews/apps/graph/__tests__/graph.test.js --run out/tests/webviews/graph/__tests__/graphWebview.test.js`
  - 33 passing.

## Concerns

- Full build retains its existing webpack asset-size and Node `DEP0190` warnings; neither caused a failure.
