# Git-Hosted Cleanroom Fork Design

## Goal

Produce a GitLens-derived VS Code extension that has no GitKraken product account, subscription, trial,
paywall, telemetry, remote feature flag, cloud AI, or GitKraken CLI dependency. The extension continues to
support normal Git remotes and direct Git-host provider APIs, and includes independently implemented Commit
Graph and local MCP features.

## Network Boundary

Allowed traffic:

- Git operations initiated through the installed Git executable, including clone, fetch, pull, push, and
  `ls-remote`.
- Direct API and authentication traffic to a user-selected Git hosting provider such as GitHub, GitLab,
  Bitbucket, or Azure DevOps.
- Provider-owned avatar images returned by those APIs.
- User-initiated remote-host links and repository deep links.

Forbidden traffic:

- `gitkraken.dev`, `api.gitkraken.dev`, `configs.gitkraken.dev`, and GitKraken telemetry endpoints.
- GitKraken account, organization, subscription, trial, purchase, and feature-check services.
- ConfigCat or another remotely managed product-feature service.
- Automatic downloads of `gk` or another GitKraken binary.
- Cloud AI providers exposed by GitLens.
- Background Gravatar lookup. A generated local avatar is the fallback when a provider avatar is absent.

## Product Account Boundary

The finished extension has no GitKraken login, signup, create-account, verification, trial, upgrade,
purchase, plan, subscription, organization, or account-management prompt. Provider-specific authentication
is allowed and must name the provider, for example `Connect GitHub`.

Provider authentication follows this order:

1. Silently request an existing VS Code authentication session.
2. If the user explicitly chooses a connect action, ask VS Code to create a provider session.
3. If the editor does not expose the provider, offer a provider-specific personal access token input and
   store it in VS Code secret storage.

GitHub uses VS Code's built-in `github` authentication provider whenever available. VSCodium and other hosts
without that provider use the token fallback.

## Source and Test Boundary

All files in a directory named `plus` remain governed by `LICENSE.plus`. During development they may be read
and their tests may be run unchanged as characterization references. No implementation or test from those
directories is copied into the replacement.

The release branch and packaged artifact must ultimately contain no directory named `plus`, no
`LICENSE.plus`, and no dependency whose workspace source is under a `plus` directory. New tests are written
against independently designed public interfaces. Existing Plus tests are removed only after the matching
replacement tests pass.

## Architecture

### Hosting Integrations

Fresh provider-neutral code lives outside `plus` and separates authentication, API transport, provider
models, and extension UI.

```ts
export type HostingProviderId = 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps';

export type HostingSession = {
	provider: HostingProviderId;
	accessToken: string;
	accountLabel: string;
};

export type HostingAuthenticationService = {
	getSession(
		provider: HostingProviderId,
		scopes: readonly string[],
		mode: 'silent' | 'interactive',
	): Promise<HostingSession | undefined>;
};
```

The extension keeps remote URL generation, open/copy commands, pull-request creation, provider enrichment,
deep-link sharing, and provider avatars. These features consume the new hosting service and never consume a
GitKraken account session.

### Commit Graph

The replacement Commit Graph consumes the MIT graph contracts and CLI implementation in `packages/git` and
`packages/git-cli`. A host controller owns one `GitGraphSession` per graph panel and sends normalized rows to
a new Lit webview. A pure lane-layout module assigns lanes and edges from row SHAs and parent SHAs. The first
release includes paging, refresh, refs, commit metadata, selection, keyboard navigation, local Git actions,
remote-host actions, and provider avatars.

Advanced lane folding, minimap visualizations, AI actions, Launchpad, and cloud-patch UI are not part of the
first graph release.

### Local MCP

The replacement MCP server is a bundled Node entry point using `@modelcontextprotocol/sdk` and stdio. VS Code
or another compatible host launches the bundled script directly. It does not download or authenticate a
`gk` executable and does not require the existing localhost discovery server.

Initial MCP tools are read-only:

- `git_status`
- `git_log`
- `git_show`
- `git_diff`
- `git_branches`
- `git_worktrees`
- `git_stash_list`
- `git_blame`

Mutating tools require a separate approved design because they need explicit confirmation and workspace
trust handling.

### Local Git Features

Worktrees, patches, history, compare, stash, branch management, cherry-pick, merge, and manual rebase are
made unconditional by removing subscription checks and Pro badges. AI conflict resolution, AI composition,
cloud drafts, and cloud workspaces are removed rather than stubbed.

### Product Services

Telemetry becomes a permanent local no-op before its exporter and dependencies are removed. Feature flags
become static local defaults. GitKraken URL, connection, account, subscription, organization, AI, agent, and
CLI services are then removed from `Container` and the environment providers.

## Migration Strategy

1. Add replacements beside the current implementation so the branch remains buildable.
2. Characterize current behavior with unchanged tests where useful.
3. Add independent tests for each replacement and switch consumers to it.
4. Remove GitKraken account and paywall UI after provider authentication has a replacement.
5. Remove GitKraken product services, telemetry, feature flags, AI, and `gk` integration.
6. Delete all Plus sources and tests, then clean workspace, build, manifest, and packaging references.
7. Verify both desktop and browser builds, provider-auth fallbacks, Commit Graph, local MCP, and the final VSIX
   contents.

## Acceptance Criteria

- No GitKraken account or commercial prompt is visible or registered.
- No request is made to a GitKraken, ConfigCat, telemetry, or cloud-AI endpoint.
- Git operations using configured remotes continue to work.
- GitHub authentication prefers an existing VS Code session and supports interactive connection and a
  VSCodium-compatible token fallback.
- Git-host links, deep links, pull-request creation, provider APIs, and provider avatars work without a
  GitKraken account.
- The desktop extension provides the new local Commit Graph and bundled stdio MCP server.
- The browser extension retains the independently implemented GitHub virtual provider and does not import
  Node-only MCP code.
- The final repository and VSIX contain no Plus source, Plus tests, `LICENSE.plus`, GitKraken endpoint, or
  stale Plus contribution.
- `pnpm run build`, `pnpm run check`, relevant unit/integration suites, and E2E smoke tests pass for both
  desktop and browser paths.
