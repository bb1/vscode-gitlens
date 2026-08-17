import type { GitRevisionRangeNotation } from '@gitlens/git/models/revision.js';
import type { GraphBranchesVisibility, ViewShowBranchComparison } from './config.js';
import type { TrackedUsage, TrackedUsageKeys } from './constants.telemetry.js';
import type { GroupableTreeViewTypes, TreeViewTypes } from './constants.views.js';
import type { FeatureFlagMap } from './featureFlags/featureFlagService.js';
import type { HostingProviderId } from './hosting/models.js';
import type { OnboardingStorage } from './onboarding/models/onboarding.js';
import type { DeepLinkServiceState } from './uris/deepLinks/deepLink.js';
import type { OverviewRecentThreshold } from './webviews/shared/overviewBranches.js';

type GraphDisplayMode = 'default';
type GraphSidebarPanel = 'default';
type GraphTreemapMode = 'default';
type VisualizationMode = 'default';
type TimelinePeriod = 'default';
type TimelineSliceBy = 'default';
type IntegrationIds = string;
type IntegrationConnectedKey = `integration:connected:${string}`;
export type StoredConfiguredIntegrationDescriptor = { id: string };
export type StoredIntegrationConfigurations = StoredConfiguredIntegrationDescriptor[];

export type SecretKeys = `gitlens.hosting.auth:${HostingProviderId}:${string}` | 'deepLinks:pending';

export const enum SyncedStorageKeys {
	Version = 'gitlens:synced:version',
	PreReleaseVersion = 'gitlens:synced:preVersion',
	ApprovedAvatarRemoteTemplates = 'gitlens:avatars:approvedRemoteTemplates',
}

export type DeprecatedGlobalStorage = {
	/** @deprecated */
	'home:actions:completed': ('dismissed:welcome' | 'opened:scm')[];
	/** @deprecated */
	'home:steps:completed': string[];
	/** @deprecated */
	'home:sections:dismissed': string[];
	/** @deprecated */
	'home:status:pinned': boolean;
	/** @deprecated */
	'home:banners:dismissed': string[];
	/** @deprecated */
	pendingWelcomeOnFocus: boolean;
	/** @deprecated */
	'views:layout': 'gitlens' | 'scm';
	/** @deprecated */
	'views:commitDetails:dismissed': 'sidebar'[];
	/** @deprecated */
	'views:welcome:visible': boolean;
	/** @deprecated Use OnboardingService */
	'home:walkthrough:dismissed': boolean;
	/** @deprecated Use OnboardingService */
	'mcp:banner:dismissed': boolean;
	/** @deprecated Use OnboardingService */
	'views:scm:grouped:welcome:dismissed': boolean;
} & {
	/** @deprecated */
	[key in `disallow:connection:${string}`]: any;
};

interface GlobalStorageCore {
	avatars: [string, StoredAvatar][];
	'avatars:approvedRemoteTemplates': Record<string, 'allow' | 'deny'>;
	repoVisibility: [string, StoredRepoVisibilityInfo][];
	pendingWhatsNewOnFocus: boolean;
	/** Ids of one-time settings migrations already applied (see `migrateSettings`). */
	'settings:migrated': string[];
	'synced:version': string;
	// Keep the pre-release version separate from the released version
	'synced:preVersion': string;
	usages: Record<TrackedUsageKeys, TrackedUsage>;
	version: string;
	// Keep the pre-release version separate from the released version
	preVersion: string;
	'home:sections:collapsed': string[];
	/** Unified onboarding/dismissible UI state */
	'onboarding:state': OnboardingStorage;
	'featureFlags:flags': FeatureFlagMap;
}

type GlobalStorageDynamic = Record<`provider:authentication:skip:${string}`, boolean> &
	Record<`jira:${string}:organizations`, Stored<StoredJiraOrganization[] | undefined>> &
	Record<`jira:${string}:projects`, Stored<StoredJiraProject[] | undefined>> &
	Record<`azure:${string}:account`, Stored<StoredAzureAccount | undefined>> &
	Record<`azure:${string}:organizations`, Stored<StoredAzureOrganization[] | undefined>> &
	Record<`azure:${string}:projects`, Stored<StoredAzureProject[] | undefined>> &
	Record<`bitbucket:${string}:account`, Stored<StoredBitbucketAccount | undefined>> &
	Record<`bitbucket:${string}:workspaces`, Stored<StoredBitbucketWorkspace[] | undefined>> &
	Record<`bitbucket-server:${string}:account`, Stored<StoredBitbucketAccount | undefined>>;

export type GlobalStorage = GlobalStorageCore & GlobalStorageDynamic;

/**
 * Storage keys that contain environment-specific data (e.g., file paths, install status).
 * These are automatically scoped by platform and remote info to avoid conflicts when
 * globalState is shared across local/remote environments (Windows, WSL, containers, SSH).
 *
 * Use `storage.getScoped()` / `storage.storeScoped()` / `storage.deleteScoped()` for these keys.
 */
export type DeprecatedWorkspaceStorage = {
	/** @deprecated */
	'graph:banners:dismissed': Record<string, boolean>;
	/** @deprecated */
	'views:searchAndCompare:keepResults': boolean;
};

interface WorkspaceStorageCore {
	assumeRepositoriesOnStartup?: boolean;
	'branch:comparisons': StoredBranchComparisons;
	'gitComandPalette:usage': StoredRecentUsage;
	gitPath: string;
	'graph:columns': Record<string, StoredGraphColumn>;
	'graph:filtersByRepo': Record<string, StoredGraphFilters>;
	'graph:state': StoredGraphState;
	/** Per-worktree commit draft for the Graph's WIP details panel. Key is the worktree's
	 *  fsPath — invariant whether the user opens the main repo or the worktree directly. */
	'graph:wipDrafts': Record<string, StoredGraphWipDraft>;
	/** Unified onboarding/dismissible UI state (workspace-scoped items) */
	'onboarding:state': OnboardingStorage;
	'starred:repositories': StoredStarred;
	'views:commitDetails:pullRequestExpanded': boolean;
	'views:commitDetails:showSearchBox': boolean;
	'views:commitDetails:searchBoxFilter': boolean;
	'views:repositories:autoRefresh': boolean;
	'views:searchAndCompare:pinned': StoredSearchAndCompareItems;
	'views:scm:grouped:selected': GroupableTreeViewTypes;
}

/**
 * Repository filter values:
 * - `undefined` or `'all'` - show all repositories (new code should set `'all'`)
 * - `'exclude-worktrees'` - show all except linked worktrees (worktrees whose main repo is also open)
 * - `string[]` - show only the specified repository IDs
 */
export type RepositoryFilterValue = 'all' | 'exclude-worktrees' | string[] | undefined;

type WorkspaceStorageDynamic = Record<`views:${TreeViewTypes}:repositoryFilter`, RepositoryFilterValue> &
	Record<`graph:searchHistory:${string}`, StoredGraphSearchHistory[]>;

export type WorkspaceStorage = WorkspaceStorageCore & WorkspaceStorageDynamic;

export interface Stored<T, SchemaVersion extends number = 1> {
	v: SchemaVersion;
	data: T;
	timestamp?: number;
}

export interface StoredJiraOrganization {
	key: string;
	id: string;
	name: string;
	url: string;
	avatarUrl: string;
}

export interface StoredJiraProject {
	key: string;
	id: string;
	name: string;
	resourceId: string;
}

export interface StoredAzureAccount {
	id: string;
	name: string | undefined;
	username: string | undefined;
	email: string | undefined;
	avatarUrl: string | undefined;
}

export interface StoredAzureOrganization {
	key: string;
	id: string;
	name: string;
}

export interface StoredAzureProject {
	key: string;
	id: string;
	name: string;
	resourceId: string;
	resourceName: string;
}

export interface StoredBitbucketAccount {
	id: string;
	name: string | undefined;
	username: string | undefined;
	email: string | undefined;
	avatarUrl: string | undefined;
}

export interface StoredBitbucketWorkspace {
	key: string;
	id: string;
	name: string;
	slug: string;
}

export interface StoredAvatar {
	uri: string;
	timestamp: number;
}

export type StoredRepositoryVisibility = 'private' | 'public' | 'local';

export interface StoredRepoVisibilityInfo {
	visibility: StoredRepositoryVisibility;
	timestamp: number;
	remotesHash?: string;
}

export interface StoredBranchComparison {
	ref: string;
	label?: string;
	notation: GitRevisionRangeNotation | undefined;
	type: Exclude<ViewShowBranchComparison, false> | undefined;
	checkedFiles?: string[];
}

export type StoredBranchComparisons = Record<string, string | StoredBranchComparison>;

export interface StoredDeepLinkContext {
	url?: string | undefined;
	repoPath?: string | undefined;
	targetSha?: string | undefined;
	secondaryTargetSha?: string | undefined;
	useProgress?: boolean | undefined;
	state?: DeepLinkServiceState | undefined;
	prData?: string | undefined;
	issueData?: string | undefined;
	instructions?: string | undefined;
	/** Agent descriptor for Start Work / Start Review with `showOpenInAgent`. Plain JSON shape. */
	agent?: unknown;
	/** Worktree path for CLI dispatch `cwd`. */
	worktreePath?: string | undefined;
}

/** The column-mode vocabulary persisted by previous Graph versions. */
export type StoredGraphColumnMode = 'numbers' | 'squares' | 'bar' | 'bipolar' | 'compact';

export interface StoredGraphColumn {
	isHidden?: boolean;
	mode?: StoredGraphColumnMode;
	width?: number;
	/** Column↔grouped placement. `graph`: `true` = grouped. `ref`: host zone id = grouped, `false` = column. */
	grouped?: boolean | string;
}

export interface StoredGraphState {
	displayMode?: GraphDisplayMode;
	visualizationMode?: VisualizationMode;
	panels?: {
		details?: {
			visible?: boolean;
			position?: number;
			bottomPosition?: number;
			/** Whether the file-tree search box is visible. */
			showSearchBox?: boolean;
			/** How the file-tree search box presents non-matches: `true` hides them (filter), `false` dims them (highlight). */
			searchBoxFilter?: boolean;
		};
		sidebar?: {
			visible?: boolean;
			position?: number;
			activePanel?: GraphSidebarPanel;
			/** How the sidebar's filter input presents non-matches: `true` hides them (filter), `false` dims them (highlight). */
			searchBoxFilter?: boolean;
			/** Whether the agents panel shows completed sessions. Defaults to false (hidden). */
			showCompletedAgentSessions?: boolean;
		};
		minimap?: {
			visible?: boolean;
			position?: number;
		};
	};
	overview?: {
		recentThreshold?: OverviewRecentThreshold;
	};
	timeline?: {
		period?: TimelinePeriod;
		sliceBy?: TimelineSliceBy;
		showAllBranches?: boolean;
	};
	treemap?: {
		mode?: GraphTreemapMode;
	};
}

export interface StoredGraphWipDraft {
	/** The commit message currently in the WIP commit input. */
	message: string;
	/** `true` when the message is user-authored (typed, AI-generated, or restored from an undone
	 *  commit) and must not be dropped by the HEAD-move auto-clear path. Mirrors the in-memory
	 *  `commitMessageDirty` signal on the details panel. */
	messageDirty: boolean;
	/** Present iff amend mode was active when the draft was saved. `baseSha` records the worktree
	 *  HEAD the amend was bound to so the existing HEAD-move auto-clear (in
	 *  `gl-graph-details-panel.ts`) can detect a stale amend on restore. */
	amend?: { baseSha: string };
}

export type StoredGraphExcludeTypes = 'remotes' | 'stashes' | 'tags';

export interface StoredGraphFilters {
	branchesVisibility?: GraphBranchesVisibility;
	includeOnlyRefs?: Record<string, StoredGraphIncludeOnlyRef>;
	excludeRefs?: Record<string, StoredGraphExcludedRef>;
	excludeTypes?: Record<StoredGraphExcludeTypes, boolean>;
	pinnedRef?: StoredGraphPinnedRef;
}

export type StoredGraphRefType = 'head' | 'remote' | 'tag';

export type StoredGraphSearchHistory = {
	query: string;
	matchAll: boolean | undefined;
	matchCase: boolean | undefined;
	matchRegex: boolean | undefined;
	matchWholeWord: boolean | undefined;
	naturalLanguage: boolean | undefined;
	/** For NL queries, store the last known structured form to show in history */
	nlStructuredQuery?: string;
};

export type StoredGraphSearchMode = 'normal' | 'filter';

export interface StoredGraphExcludedRef {
	id: string;
	type: StoredGraphRefType;
	name: string;
	owner?: string;
}

export interface StoredGraphIncludeOnlyRef {
	id: string;
	type: StoredGraphRefType;
	name: string;
	owner?: string;
}

export interface StoredGraphPinnedRef {
	id: string;
	type: StoredGraphRefType;
	name: string;
	owner?: string;
}

export interface StoredNamedRef {
	label?: string;
	ref: string;
}

export interface StoredComparison {
	type: 'comparison';
	timestamp: number;
	path: string;
	ref1: StoredNamedRef;
	ref2: StoredNamedRef;
	notation?: GitRevisionRangeNotation;

	checkedFiles?: string[];
}

export interface StoredSearch {
	type: 'search';
	timestamp: number;
	path: string;
	labels: {
		label: string;
		queryLabel:
			| string
			| {
					label: string;
					resultsType?: { singular: string; plural: string };
			  };
	};
	search: StoredSearchQuery;
}

export interface StoredSearchQuery {
	pattern: string;
	matchAll?: boolean;
	matchCase?: boolean;
	matchRegex?: boolean;
	matchWholeWord?: boolean;
	naturalLanguage?: boolean | { query: string; processedQuery?: string };
}

export type StoredSearchAndCompareItem = StoredComparison | StoredSearch;
export type StoredSearchAndCompareItems = Record<string, StoredSearchAndCompareItem>;
export type StoredStarred = Record<string, boolean>;
export type StoredRecentUsage = Record<string, number>;
