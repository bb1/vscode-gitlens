# Signal Flow Commit Graph Design

## Goal

Replace the sparse Commit Graph list with a full-height, editor-style Git history workspace that supports everyday history exploration and commit workflows without copying GitLens' visual design.

## Scope

The first release provides:

- A compact command deck for repository and branch context, refresh/fetch, search, and filters.
- A scrollable reference rail for local branches, remotes, and tags.
- A dense, virtualized commit canvas with colored lanes, refs, message, author, date, and SHA columns.
- Multi-selection, range selection, and existing common commit actions such as copy, details, remote open, and compare.
- A selection-driven bottom inspector for commit metadata, actions, and lazily loaded changed files.
- Browser-side display preferences: column visibility, compact graph mode, and minimap visibility.
- A low-cost right-side navigation rail that represents row density, current viewport, and selection.
- Responsive layouts that retain graph, message, and refs in the sidebar while hiding secondary surfaces.

The first release excludes saved queries/views, topology rendering in the minimap, and host actions that do not already have a supported command or data source.

## Visual Identity

Signal Flow is an editorial technical workspace rather than a clone of the reference product:

- Use a restrained teal, indigo, amber, and coral lane palette. A ref pill adopts its associated lane color only as an accent.
- Prioritize a dark, full-bleed canvas with precise hairline dividers, compact type, and strong selected-row contrast.
- Treat the graph as the primary visual element. Controls and metadata recede until focus or selection makes them relevant.
- Put details in a collapsible bottom inspector to preserve graph width; do not use a permanently open details sidebar.

## Architecture

### Host and Protocol

Extend the graph host payload with the current repository context, active branch/HEAD, available refs, and selected-commit details when loaded. Extend webview requests for refresh, query/filter changes, selected-row details/files, and existing supported actions. Parsing must remain bounded and reject malformed input.

The host owns repository access, Git graph sessions, filtering/search, fetching, details/file retrieval, and command execution. Reuse existing GitLens commands and providers rather than adding a second command framework.

### Webview State

The Lit app owns transient graph rows, topology layout, active query/filters, selection, inspector state, and pending requests. Persist only browser-side display preferences through the VS Code webview-state API: visible columns, compact graph mode, and minimap visibility.

### Commit Canvas

Retain `lit-virtualizer` for the rows. Render it as a table-like grid with a sticky column header, a fixed-width SVG lane cell, and independently hideable metadata columns. Preserve existing paging and roving keyboard navigation.

Selection is single-click by default, Shift for contiguous range selection, and Ctrl/Cmd for toggling a commit. The active row remains keyboard focusable. Escape closes the inspector and restores focus to the active row.

### Inspector and Minimap

The inspector opens for the active commit and initially shows identifier, refs, author, date, message, and available actions. Changed files load only after the files section is expanded. The minimap is a proportional index of loaded rows, with viewport and selection markers, and jumps the virtualizer to a clicked position. It deliberately does not reproduce lane topology.

### Responsive Layout

The panel/editor layout is driven by container queries. In narrow sidebar widths, keep the canvas, refs, and message; hide secondary columns, reference-rail overflow, minimap, and expanded inspector content. There must be no horizontal clipping of the row body.

## Error Handling

- Keep prior graph rows visible if a refresh, filter, or detail request fails.
- Display an inline non-blocking error in the relevant surface with a retry control.
- Cancel or ignore outdated detail responses when selection changes.
- Preserve bounded protocol parsing for every host and webview message.

## Accessibility

- Use semantic controls with names and keyboard-operable toggles.
- Preserve listbox navigation and roving tabindex for commits.
- Announce loading and errors with scoped status regions.
- Keep selected-row contrast, focus indicators, and forced-colors behavior intact.
- Return focus from the inspector to the selected graph row on Escape.

## Validation

- Unit-test protocol parsing for new bounded messages.
- Unit-test UI state reducers for query/filter replacement, preferences, selections, and stale detail results.
- Unit-test range/toggle selection and inspector focus restoration.
- Unit-test responsive display decisions, minimap position mapping, and existing paging/navigation behavior.
- Run targeted graph tests followed by `pnpm run check` and `pnpm run build`, covering Node and browser builds.
