# Git-Hosted Cleanroom Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove GitKraken product-account and Plus dependencies while retaining direct Git-host integrations and adding independently implemented Commit Graph and local MCP features.

**Architecture:** Build new hosting, graph, and MCP seams outside every `plus` directory while the current code remains available as a non-shipping characterization reference. Switch consumers only after replacement tests pass, then remove all GitKraken product services and Plus artifacts in one final dependency-cut phase.

**Tech Stack:** TypeScript 7, VS Code Extension API, Lit 3, `@modelcontextprotocol/sdk` 1.x, Zod 4, existing `@gitlens/git`, `@gitlens/git-cli`, Mocha, Sinon, Playwright, pnpm 11.

## Global Constraints

- Retain Git clone, fetch, pull, push, and other remote operations through Git.
- Retain direct GitHub, GitLab, Bitbucket, and Azure DevOps API integrations.
- Prefer an existing VS Code GitHub authentication session; prompt only from an explicit provider-connect action.
- Provide a provider-token fallback for hosts such as VSCodium that lack the built-in provider.
- Remove every GitKraken login, signup, create-account, verification, trial, upgrade, purchase, plan, and account-management prompt.
- Remove GitKraken telemetry, ConfigCat, GitKraken product APIs, cloud AI, and automatic `gk` downloads.
- Existing Plus source and tests are reference-only. Do not copy or modify them for replacement implementation.
- Write a failing independent test before each production behavior.
- Keep desktop and browser builds valid; MCP remains Node-only.
- After every task, dispatch `qa-fast` to review security, code quality, and spec compliance.
- A build agent fixes every confirmed Critical or Important `qa-fast` finding before the task can finish.
- Commit each task only after its focused tests, required checks, and `qa-fast` gate pass, then push the feature branch to `origin`.
- Never push to `upstream`; do not amend commits or create a PR unless the user explicitly asks.

---

### Task 1: Provider Authentication Seam

**Files:**

- Create: `src/hosting/models.ts`
- Create: `src/hosting/authenticationService.ts`
- Create: `src/hosting/__tests__/authenticationService.test.ts`
- Modify: `src/constants.storage.ts`

**Interfaces:**

- Produces: `HostingProviderId`, `HostingSession`, and `HostingAuthenticationService.getSession(provider, scopes, mode)`.
- Consumes: `vscode.authentication`, `SecretStorage`, and `window.showInputBox` through injected functions.

- [ ] **Step 1: Write failing tests for silent GitHub-session reuse**

Create a test where `getSession('github', scopes, { silent: true })` returns an existing session and assert that
the service returns it without invoking the token prompt.

- [ ] **Step 2: Run the focused test and confirm it fails because the service does not exist**

Run: `corepack pnpm exec mocha --config tests/unit/.mocharc.json src/hosting/__tests__/authenticationService.test.ts`

- [ ] **Step 3: Implement the provider models and silent lookup**

Use this public contract:

```ts
export type HostingProviderId = 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps';

export type HostingSession = {
	provider: HostingProviderId;
	accessToken: string;
	accountLabel: string;
};
```

- [ ] **Step 4: Add failing tests for explicit GitHub connection and token fallback**

Assert that interactive mode first requests a VS Code session with `createIfNone: true`, then offers a
provider-named password input only when the editor reports no GitHub provider. Assert cancellation stores
nothing and a token is stored under a provider-specific secret key.

- [ ] **Step 5: Implement only the interactive and secret-storage paths required by those tests**

- [ ] **Step 6: Run the focused tests and `corepack pnpm run check`**

Expected: authentication tests pass and check exits 0.

### Task 2: Direct Hosting Integration Core

**Files:**

- Create: `packages/integrations/package.json`
- Create: `packages/integrations/tsconfig.json`
- Create: `packages/integrations/src/models.ts`
- Create: `packages/integrations/src/provider.ts`
- Create: `src/hosting/hostingIntegrationService.ts`
- Create: `src/hosting/__tests__/hostingIntegrationService.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `tsconfig.json`
- Modify: `tsconfig.node.json`
- Modify: `tsconfig.browser.json`

**Interfaces:**

- Consumes: `HostingAuthenticationService` from Task 1.
- Produces: `HostingProvider`, `HostingRepositoryDescriptor`, and `HostingIntegrationService.get(provider, domain)`.

- [ ] **Step 1: Write failing tests for provider registration and lazy authentication**

Tests must prove that reading provider metadata does not prompt and that an authenticated API operation asks
for a silent session before returning `authenticationRequired`.

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

- [ ] **Step 3: Add the package and the minimum provider-neutral contracts**

```ts
export type HostingRepositoryDescriptor = {
	owner: string;
	name: string;
	domain: string;
};

export type HostingProvider = {
	id: HostingProviderId;
	getPullRequests(repository: HostingRepositoryDescriptor): Promise<readonly HostingPullRequest[]>;
	createPullRequest(
		repository: HostingRepositoryDescriptor,
		input: CreatePullRequestInput,
	): Promise<HostingPullRequest>;
};
```

- [ ] **Step 4: Implement service registration without a compatibility abstraction for unused Plus methods**

- [ ] **Step 5: Run package build, focused tests, and check**

Run: `corepack pnpm exec tsc -b packages/integrations`

### Task 3: GitHub Provider and Browser Git Provider

**Files:**

- Create: `packages/git-github/package.json`
- Create: `packages/git-github/tsconfig.json`
- Create: `packages/git-github/src/githubClient.ts`
- Create: `packages/git-github/src/githubHostingProvider.ts`
- Create: `packages/git-github/src/__tests__/githubHostingProvider.test.ts`
- Create: `src/hosting/githubVirtualGitProvider.ts`
- Create: `src/hosting/__tests__/githubVirtualGitProvider.test.ts`
- Modify: `src/env/node/providers.ts`
- Modify: `src/env/browser/providers.ts`
- Modify: root TypeScript path mappings and package dependencies

**Interfaces:**

- Consumes: Task 2 hosting contracts and Task 1 sessions.
- Produces: direct GitHub REST/GraphQL operations and a browser-capable `GlGitProvider`.

- [ ] **Step 1: Write request-injection tests for repository metadata, pull-request listing, and pull-request creation**

Use an injected request function and assert URL, method, headers, and response mapping. Do not make live API
requests in tests.

- [ ] **Step 2: Implement the minimal GitHub client and provider**

- [ ] **Step 3: Write a failing browser-provider registration test**

Assert `src/env/browser/providers.ts` returns the new provider without importing a `plus` path.

- [ ] **Step 4: Implement browser and desktop registration**

- [ ] **Step 5: Run provider tests, browser build, desktop build, and check**

Run: `corepack pnpm run build:packages && corepack pnpm run build:webviews`

### Task 4: Remaining Git Hosts

**Files:**

- Create: `packages/integrations/src/providers/gitlab.ts`
- Create: `packages/integrations/src/providers/bitbucket.ts`
- Create: `packages/integrations/src/providers/azureDevOps.ts`
- Create: matching provider tests under `packages/integrations/src/providers/__tests__/`
- Modify: `src/hosting/hostingIntegrationService.ts`

**Interfaces:**

- Consumes: Tasks 1 and 2.
- Produces: direct metadata, pull-request list/create, account lookup, and avatar URL operations for each host.

- [ ] **Step 1: Add one failing contract test per provider for authentication and pull-request mapping**

- [ ] **Step 2: Implement GitLab, Bitbucket, and Azure DevOps one provider at a time**

- [ ] **Step 3: Add failing tests for custom domains and token-secret isolation**

- [ ] **Step 4: Implement custom-domain handling and run all integration package tests**

### Task 5: Rewire Remote Links, PRs, Deep Links, and Avatars

**Files:**

- Modify: `src/commands/openOnRemote.ts`
- Modify: `src/commands/openPullRequestOnRemote.ts`
- Modify: `src/commands/openIssueOnRemote.ts`
- Modify: `src/commands/createPullRequestOnRemote.ts`
- Modify: `src/commands/copyDeepLink.ts`
- Modify: `src/avatars.ts`
- Modify: `src/git/utils/-webview/remote.utils.ts`
- Modify: related command and avatar tests outside `plus`

**Interfaces:**

- Consumes: `HostingIntegrationService` from Tasks 2-4.
- Produces: unchanged public command IDs backed directly by Git-host providers.

- [ ] **Step 1: Add failing tests showing public remote commands no longer require a GitKraken account**

- [ ] **Step 2: Rewire remote URL and PR commands to provider capabilities**

- [ ] **Step 3: Add failing avatar tests for provider avatar, cache hit, and generated local fallback**

- [ ] **Step 4: Remove Gravatar background generation and implement provider-only lookup**

- [ ] **Step 5: Run command, avatar, hosting, browser, and desktop checks**

### Task 6: Unpaywall Local Git Features

**Files:**

- Modify: `src/views/worktreesView.ts`
- Modify: `src/commands/git/worktree.ts`
- Modify: `src/commands/patches.ts`
- Modify: `src/commands/git/rebase.ts`
- Modify: `src/webviews/rebase/protocol.ts`
- Modify: `src/webviews/rebase/rebaseWebviewProvider.ts`
- Modify: `src/webviews/apps/rebase/rebase.ts`
- Test: existing non-Plus worktree, patch, and rebase tests plus focused new tests

**Interfaces:**

- Produces: subscription-free Worktrees, local patches, and manual rebase/conflict behavior.

- [ ] **Step 1: Add failing tests for worktree view/command labels without Pro state**

- [ ] **Step 2: Remove the worktree gate and Pro labels**

- [ ] **Step 3: Add failing tests for local patch commands without Draft dependencies**

- [ ] **Step 4: Separate local patch commands and remove cloud-patch command implementation**

- [ ] **Step 5: Add failing rebase protocol tests without subscription or AI fields**

- [ ] **Step 6: Remove recompose, auto-rebase, subscription notifications, and AI conflict actions while retaining manual conflict controls**

- [ ] **Step 7: Run worktree, patch, rebase, browser, and desktop verification**

### Task 7: Commit Graph Lane Layout

**Files:**

- Create: `src/webviews/apps/graph/laneLayout.ts`
- Create: `src/webviews/apps/graph/__tests__/laneLayout.test.ts`

**Interfaces:**

- Consumes: `{ sha: string; parents: string[] }[]` in display order.
- Produces: `GraphLayoutRow[]` containing node lane and edge start/end lanes.

- [ ] **Step 1: Write failing tests for linear, branch, merge, and octopus histories**

The expected lane numbers must be authored from the desired stable public behavior, not copied from Plus
tests.

- [ ] **Step 2: Implement a deterministic open-lane allocator**

```ts
export type GraphLayoutRow = {
	sha: string;
	lane: number;
	edges: readonly { from: number; to: number; parent: string }[];
};

export function layoutGraphRows(rows: readonly GraphTopologyRow[]): readonly GraphLayoutRow[];
```

- [ ] **Step 3: Add failing tests for pagination boundary seeds**

- [ ] **Step 4: Add the minimum seed input needed to preserve lanes across pages**

- [ ] **Step 5: Run layout tests and check**

### Task 8: Commit Graph Host Controller and Protocol

**Files:**

- Create: `src/webviews/graph/protocol.ts`
- Create: `src/webviews/graph/graphSessionController.ts`
- Create: `src/webviews/graph/__tests__/graphSessionController.test.ts`
- Reuse: `packages/git/src/models/graph.ts`, `packages/git/src/models/graphSession.ts`

**Interfaces:**

- Consumes: `GitGraphSession` and a webview message sink.
- Produces: initial snapshot, refresh replacement, and append-page messages.

- [ ] **Step 1: Write failing tests for open, more, refresh, and dispose**

- [ ] **Step 2: Define the smallest protocol containing bootstrap, rows, paging, selection, and row-action messages**

- [ ] **Step 3: Implement session ownership and serialized paging**

- [ ] **Step 4: Run focused tests and check**

### Task 9: Commit Graph Webview and Registration

**Files:**

- Create: `src/webviews/graph/registration.ts`
- Create: `src/webviews/graph/graphWebview.ts`
- Create: `src/webviews/apps/graph/graph.ts`
- Create: `src/webviews/apps/graph/graph.css.ts`
- Create: `src/webviews/apps/graph/__tests__/graph.test.ts`
- Modify: `src/container.ts`
- Modify: `src/views/views.ts`
- Modify: `contributions.json`
- Regenerate: `package.json`, command types, custom element metadata

**Interfaces:**

- Consumes: Tasks 7 and 8.
- Produces: existing `gitlens.showGraph` and graph view IDs backed by the new implementation.

- [ ] **Step 1: Write failing rendering tests for rows, refs, lanes, paging request, selection, keyboard navigation, and ARIA labels**

- [ ] **Step 2: Implement the virtualized Lit row list and SVG lane gutter**

- [ ] **Step 3: Add failing tests for local and remote row actions**

- [ ] **Step 4: Register the graph and route actions through existing local Git and Task 5 remote commands**

- [ ] **Step 5: Regenerate contributions and run webview, browser, desktop, accessibility, and E2E graph smoke tests**

### Task 10: Bundled Local MCP Server

**Files:**

- Create: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/tsconfig.json`
- Create: `packages/mcp-server/src/server.ts`
- Create: `packages/mcp-server/src/gitTools.ts`
- Create: `packages/mcp-server/src/__tests__/gitTools.test.ts`
- Modify: workspace, TypeScript, and build package lists

**Interfaces:**

- Produces: a stdio MCP server executable and eight read-only Git tools.
- Consumes: installed Git executable and validated repository paths.

- [ ] **Step 1: Write failing tests for every tool's argument validation and Git argument construction**

- [ ] **Step 2: Implement read-only Git tool handlers with no shell interpolation**

- [ ] **Step 3: Register tools with `McpServer` and `StdioServerTransport`**

- [ ] **Step 4: Add an MCP protocol smoke test over child-process stdio**

- [ ] **Step 5: Run MCP tests and package build**

### Task 11: MCP Host Registration

**Files:**

- Create: `src/env/node/mcp/localMcpService.ts`
- Create: `src/env/node/mcp/hostProviders/types.ts`
- Create: `src/env/node/mcp/hostProviders/vscodeMcpHostProvider.ts`
- Create: `src/env/node/mcp/hostProviders/cursorMcpHostProvider.ts`
- Create: matching tests under `src/env/node/mcp/__tests__/`
- Modify: `src/env/node/providers.ts`
- Modify: `src/env/browser/providers.ts`
- Modify: `src/container.ts`
- Modify: `contributions.json`

**Interfaces:**

- Consumes: bundled MCP server entry point from Task 10.
- Produces: local MCP registration and explicit enable/disable commands without `gk`.

- [ ] **Step 1: Write failing tests for generated stdio command configuration**

- [ ] **Step 2: Implement VS Code and Cursor registration adapters**

- [ ] **Step 3: Write a failing browser test proving no Node MCP import or command is exposed**

- [ ] **Step 4: Wire Node registration and the local commands; remove AI/account gating**

- [ ] **Step 5: Run MCP, browser, desktop, and contribution-generation checks**

### Task 12: Remove GitKraken Product Services and Prompts

**Files:**

- Modify: `src/container.ts`
- Modify: `src/extension.ts`
- Modify: `src/telemetry/telemetry.ts`
- Delete: `src/telemetry/openTelemetryProvider.ts`
- Replace: `src/featureFlags/featureFlagService.ts` with static local flags
- Delete: `src/env/node/gk/**`
- Delete: GitKraken account/AI command bridge files outside `plus`
- Modify: `contributions.json`, `README.md`, walkthroughs, settings, deep-link docs, and user-visible webviews

**Interfaces:**

- Consumes: completed hosting, graph, and MCP replacements.
- Produces: an account-free extension composition root.

- [ ] **Step 1: Add failing static tests for prohibited command IDs, strings, endpoints, exporters, ConfigCat, and `gk` downloads**

- [ ] **Step 2: Make telemetry permanently disabled and remove its exporter dependencies**

- [ ] **Step 3: Replace remote feature flags with local constants**

- [ ] **Step 4: Remove GitKraken account, subscription, organization, AI, agent, CLI, and URL services from activation**

- [ ] **Step 5: Remove all GitKraken commercial prompts while retaining provider-specific connect prompts**

- [ ] **Step 6: Run static policy tests, full build, check, and relevant E2E flows**

### Task 13: Delete Plus and Clean Packaging

**Files:**

- Delete: every tracked path containing a directory named `plus`
- Delete: every `LICENSE.plus`
- Modify: `pnpm-workspace.yaml`
- Modify: root package dependencies and scripts
- Modify: `tsconfig*.json`
- Modify: `webpack.config.mjs`
- Modify: `scripts/esbuild.tests.mjs`
- Modify: `packages/core/scripts/bundle.mjs`
- Modify: lint, test, and release configuration
- Create: `scripts/verifyCleanroom.mts`

**Interfaces:**

- Consumes: all replacements from Tasks 1-12.
- Produces: source tree and VSIX containing no Plus or GitKraken product artifact.

- [ ] **Step 1: Run all unchanged Plus characterization tests one final time and record only their results in the SDD report**

- [ ] **Step 2: Delete Plus sources/tests/licenses and remove their workspace/build aliases**

- [ ] **Step 3: Add a failing cleanroom-verification test against a fixture containing a forbidden path**

- [ ] **Step 4: Implement source, dependency, contribution, endpoint, and VSIX-content verification**

- [ ] **Step 5: Regenerate the lockfile, contributions, command types, and metadata**

- [ ] **Step 6: Run `corepack pnpm run build`, `corepack pnpm run check`, package tests, desktop tests, browser tests, E2E tests, bundle, VSIX packaging, and `verifyCleanroom`**

- [ ] **Step 7: Inspect `git diff main --stat` and resolve every branch-owned build, type, lint, or test failure**

## Final Review

After Task 13, request a whole-branch review covering functional regressions, provider-token security, desktop
and browser completeness, MCP trust boundaries, graph accessibility, forbidden network paths, and packaged
artifact contents. Any Critical or Important finding is fixed and re-reviewed before presenting integration
options.
