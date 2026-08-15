import { IpcNotification } from '../ipc/models/ipc.js';

export const scope = 'graph';

export type GraphPaging = {
	readonly hasMore: boolean;
};

/** The bounded subset of a graph row consumed by the cleanroom graph renderer. */
export type GraphWebviewRow = {
	readonly sha: string;
	readonly parents: readonly string[];
	readonly author: string;
	readonly email: string;
	readonly date: number;
	readonly commitDate?: number;
	readonly message: string;
	readonly kind: 'commit' | 'merge' | 'stash' | 'workdir';
	readonly heads?: readonly { readonly name: string }[];
	readonly remotes?: readonly { readonly name: string; readonly owner: string }[];
	readonly tags?: readonly { readonly name: string }[];
};

export type GraphBootstrapMessage = {
	readonly type: 'graph/bootstrap';
	readonly rows: readonly GraphWebviewRow[];
	readonly paging: GraphPaging;
	readonly selection: string | undefined;
};

export type GraphAppendMessage = {
	readonly type: 'graph/append';
	readonly rows: readonly GraphWebviewRow[];
	readonly paging: GraphPaging;
};

export type GraphReplaceMessage = {
	readonly type: 'graph/replace';
	readonly rows: readonly GraphWebviewRow[];
	readonly paging: GraphPaging;
};

export type GraphWorkspaceRef = {
	readonly type: 'head' | 'branch' | 'remote' | 'tag';
	readonly name: string;
};

export type GraphWorkspaceContext = {
	readonly repository: {
		readonly name: string;
		readonly branch?: string;
	};
	readonly refs: readonly GraphWorkspaceRef[];
};

export type GraphContextMessage = GraphWorkspaceContext & {
	readonly type: 'graph/context';
};

export type GraphCommitFile = {
	readonly path: string;
	readonly status: string;
};

export type GraphCommitDetails = {
	readonly sha: string;
	readonly author: string;
	readonly date: number;
	readonly message: string;
	readonly refs: readonly GraphWorkspaceRef[];
	readonly files?: readonly GraphCommitFile[];
};

export type GraphDetailsMessage = GraphCommitDetails & {
	readonly type: 'graph/details';
};

/** Host-to-webview graph data messages. */
export type GraphHostMessage =
	| GraphBootstrapMessage
	| GraphAppendMessage
	| GraphReplaceMessage
	| GraphContextMessage
	| GraphDetailsMessage;
export const GraphDidChangeNotification = new IpcNotification<GraphHostMessage>(scope, 'didChange');

export type GraphMoreRequest = {
	readonly type: 'graph/more';
	readonly limit: number;
	readonly targetId?: string;
};

export type GraphSelectionUpdate = {
	readonly type: 'graph/selection/update';
	readonly selection: readonly string[];
};

export type GraphRowAction = {
	readonly type: 'graph/row/action';
	readonly action: 'copy-sha' | 'open-local' | 'open-remote';
	readonly sha: string;
};

export type GraphFilterRequest = {
	readonly type: 'graph/filter';
	readonly query: string;
};

export type GraphDetailsRequest = {
	readonly type: 'graph/details';
	readonly sha: string;
	readonly includeFiles: boolean;
};

export type GraphColumn = 'graph' | 'message' | 'refs' | 'author' | 'date' | 'sha';

export type GraphDisplayPreferences = {
	readonly columns: readonly GraphColumn[];
	readonly compact: boolean;
	readonly minimap: boolean;
};

/** Webview-to-host interaction messages. */
export type GraphWebviewMessage =
	| GraphMoreRequest
	| GraphSelectionUpdate
	| GraphRowAction
	| GraphFilterRequest
	| GraphDetailsRequest;

const graphPageSizeMax = 5000;
const graphSelectionMax = 1000;
const graphParentsMax = 64;
const graphRefsMax = 64;
const graphDetailFilesMax = 1000;
const graphDisplayColumnsMax = 6;
const graphAuthorMaxLength = 256;
const graphEmailMaxLength = 320;
const graphMessageMaxLength = 10000;
const graphQueryMaxLength = 10000;
const graphRefNameMaxLength = 1024;
const graphFilePathMaxLength = 4096;
const graphFileStatusMaxLength = 16;
const shaRegex = /^[0-9a-f]{5,64}$/i;
const rowActions = new Set<GraphRowAction['action']>(['copy-sha', 'open-local', 'open-remote']);
const graphColumns = new Set<GraphColumn>(['graph', 'message', 'refs', 'author', 'date', 'sha']);

export function parseGraphHostMessage(value: unknown): GraphHostMessage | undefined {
	if (!isRecord(value) || typeof value.type !== 'string') return undefined;

	switch (value.type) {
		case 'graph/context':
			return parseGraphWorkspaceContext(value);
		case 'graph/details':
			return parseGraphCommitDetails(value);
		case 'graph/bootstrap': {
			const rows = parseGraphRows(value.rows);
			const paging = parseGraphPaging(value.paging);
			if (rows == null || paging == null) return undefined;

			const selection = value.selection;
			if (selection !== undefined && !isSha(selection)) return undefined;

			return { type: 'graph/bootstrap', rows: rows, paging: paging, selection: selection };
		}
		case 'graph/append':
		case 'graph/replace': {
			const rows = parseGraphRows(value.rows);
			const paging = parseGraphPaging(value.paging);
			if (rows == null || paging == null) return undefined;

			return { type: value.type, rows: rows, paging: paging };
		}
		default:
			return undefined;
	}
}

export function parseGraphWebviewMessage(value: unknown): GraphWebviewMessage | undefined {
	if (!isRecord(value) || typeof value.type !== 'string') return undefined;

	switch (value.type) {
		case 'graph/details':
			return parseGraphDetailsRequest(value);
		case 'graph/filter':
			return parseGraphFilterRequest(value);
		case 'graph/more':
			return parseGraphMoreRequest(value);
		case 'graph/row/action':
			return parseGraphRowAction(value);
		case 'graph/selection/update':
			return parseGraphSelectionUpdate(value);
		default:
			return undefined;
	}
}

export function parseGraphDisplayPreferences(value: unknown): GraphDisplayPreferences | undefined {
	if (
		!isRecord(value) ||
		!Array.isArray(value.columns) ||
		value.columns.length > graphDisplayColumnsMax ||
		!value.columns.every(isGraphColumn) ||
		new Set(value.columns).size !== value.columns.length ||
		typeof value.compact !== 'boolean' ||
		typeof value.minimap !== 'boolean'
	) {
		return undefined;
	}

	return { columns: value.columns, compact: value.compact, minimap: value.minimap };
}

export function parseGraphRowAction(value: unknown): GraphRowAction | undefined {
	if (!isRecord(value) || value.type !== 'graph/row/action' || !isGraphRowAction(value)) {
		return undefined;
	}

	return { type: 'graph/row/action', action: value.action, sha: value.sha };
}

export function isGraphRowAction(value: unknown): value is Pick<GraphRowAction, 'action' | 'sha'> {
	return (
		isRecord(value) &&
		typeof value.action === 'string' &&
		rowActions.has(value.action as GraphRowAction['action']) &&
		isSha(value.sha)
	);
}

function parseGraphMoreRequest(value: Record<string, unknown>): GraphMoreRequest | undefined {
	if (
		typeof value.limit !== 'number' ||
		!Number.isSafeInteger(value.limit) ||
		value.limit <= 0 ||
		value.limit > graphPageSizeMax ||
		(value.targetId != null && !isSha(value.targetId))
	) {
		return undefined;
	}

	return {
		type: 'graph/more',
		limit: value.limit,
		targetId: value.targetId as string | undefined,
	};
}

function parseGraphFilterRequest(value: Record<string, unknown>): GraphFilterRequest | undefined {
	if (!isString(value.query, graphQueryMaxLength)) return undefined;

	return { type: 'graph/filter', query: value.query };
}

function parseGraphDetailsRequest(value: Record<string, unknown>): GraphDetailsRequest | undefined {
	if (!isSha(value.sha) || typeof value.includeFiles !== 'boolean') return undefined;

	return { type: 'graph/details', sha: value.sha, includeFiles: value.includeFiles };
}

function parseGraphSelectionUpdate(value: Record<string, unknown>): GraphSelectionUpdate | undefined {
	if (
		!Array.isArray(value.selection) ||
		value.selection.length > graphSelectionMax ||
		!value.selection.every(isSha)
	) {
		return undefined;
	}

	const selection = value.selection;
	if (new Set(selection.map(sha => sha.toLowerCase())).size !== selection.length) return undefined;

	return { type: 'graph/selection/update', selection: selection };
}

function parseGraphPaging(value: unknown): GraphPaging | undefined {
	if (!isRecord(value) || typeof value.hasMore !== 'boolean') return undefined;

	return { hasMore: value.hasMore };
}

function parseGraphWorkspaceContext(value: Record<string, unknown>): GraphContextMessage | undefined {
	if (!isRecord(value.repository) || !isString(value.repository.name, graphRefNameMaxLength)) return undefined;
	if (value.repository.branch !== undefined && !isString(value.repository.branch, graphRefNameMaxLength)) {
		return undefined;
	}

	const refs = parseGraphWorkspaceRefs(value.refs);
	if (refs == null) return undefined;

	return {
		type: 'graph/context',
		repository: {
			name: value.repository.name,
			...(value.repository.branch === undefined ? {} : { branch: value.repository.branch }),
		},
		refs: refs,
	};
}

function parseGraphCommitDetails(value: Record<string, unknown>): GraphDetailsMessage | undefined {
	if (
		!isSha(value.sha) ||
		!isString(value.author, graphAuthorMaxLength) ||
		!isFiniteNumber(value.date) ||
		!isString(value.message, graphMessageMaxLength)
	) {
		return undefined;
	}

	const refs = parseGraphWorkspaceRefs(value.refs);
	if (refs == null) return undefined;

	const files = parseGraphCommitFiles(value.files);
	if (files === false) return undefined;

	return {
		type: 'graph/details',
		sha: value.sha,
		author: value.author,
		date: value.date,
		message: value.message,
		refs: refs,
		...(files == null ? {} : { files: files }),
	};
}

function parseGraphRows(value: unknown): readonly GraphWebviewRow[] | undefined {
	if (!Array.isArray(value) || value.length > graphPageSizeMax) return undefined;

	const rows: GraphWebviewRow[] = [];
	for (const item of value) {
		const row = parseGraphRow(item);
		if (row == null) return undefined;

		rows.push(row);
	}

	return rows;
}

function parseGraphRow(value: unknown): GraphWebviewRow | undefined {
	if (
		!isRecord(value) ||
		!isSha(value.sha) ||
		!Array.isArray(value.parents) ||
		value.parents.length > graphParentsMax ||
		!value.parents.every(isSha) ||
		!isString(value.author, graphAuthorMaxLength) ||
		!isString(value.email, graphEmailMaxLength) ||
		!isFiniteNumber(value.date) ||
		(value.commitDate !== undefined && !isFiniteNumber(value.commitDate)) ||
		!isString(value.message, graphMessageMaxLength) ||
		!isGraphRowKind(value.kind)
	) {
		return undefined;
	}

	const heads = parseGraphRefs(value.heads);
	if (heads === false) return undefined;

	const remotes = parseGraphRemotes(value.remotes);
	if (remotes === false) return undefined;

	const tags = parseGraphRefs(value.tags);
	if (tags === false) return undefined;

	return {
		sha: value.sha,
		parents: [...value.parents],
		author: value.author,
		email: value.email,
		date: value.date,
		...(value.commitDate === undefined ? {} : { commitDate: value.commitDate }),
		message: value.message,
		kind: value.kind,
		...(heads == null ? {} : { heads: heads }),
		...(remotes == null ? {} : { remotes: remotes }),
		...(tags == null ? {} : { tags: tags }),
	};
}

function parseGraphRefs(value: unknown): readonly { readonly name: string }[] | undefined | false {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length > graphRefsMax) return false;

	const refs: { name: string }[] = [];
	for (const ref of value) {
		if (!isRecord(ref) || !isString(ref.name, graphRefNameMaxLength)) return false;

		refs.push({ name: ref.name });
	}

	return refs;
}

function parseGraphRemotes(
	value: unknown,
): readonly { readonly name: string; readonly owner: string }[] | undefined | false {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length > graphRefsMax) return false;

	const remotes: { name: string; owner: string }[] = [];
	for (const ref of value) {
		if (
			!isRecord(ref) ||
			!isString(ref.name, graphRefNameMaxLength) ||
			!isString(ref.owner, graphRefNameMaxLength)
		) {
			return false;
		}

		remotes.push({ name: ref.name, owner: ref.owner });
	}

	return remotes;
}

function parseGraphWorkspaceRefs(value: unknown): readonly GraphWorkspaceRef[] | undefined {
	if (!Array.isArray(value) || value.length > graphRefsMax) return undefined;

	const refs: GraphWorkspaceRef[] = [];
	for (const ref of value) {
		if (!isRecord(ref) || !isGraphWorkspaceRefType(ref.type) || !isString(ref.name, graphRefNameMaxLength)) {
			return undefined;
		}

		refs.push({ type: ref.type, name: ref.name });
	}

	return refs;
}

function parseGraphCommitFiles(value: unknown): readonly GraphCommitFile[] | undefined | false {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length > graphDetailFilesMax) return false;

	const files: GraphCommitFile[] = [];
	for (const file of value) {
		if (
			!isRecord(file) ||
			!isString(file.path, graphFilePathMaxLength) ||
			!isString(file.status, graphFileStatusMaxLength)
		) {
			return false;
		}

		files.push({ path: file.path, status: file.status });
	}

	return files;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isGraphRowKind(value: unknown): value is GraphWebviewRow['kind'] {
	return value === 'commit' || value === 'merge' || value === 'stash' || value === 'workdir';
}

function isGraphWorkspaceRefType(value: unknown): value is GraphWorkspaceRef['type'] {
	return value === 'head' || value === 'branch' || value === 'remote' || value === 'tag';
}

function isGraphColumn(value: unknown): value is GraphColumn {
	return typeof value === 'string' && graphColumns.has(value as GraphColumn);
}

function isSha(value: unknown): value is string {
	return typeof value === 'string' && shaRegex.test(value);
}

function isString(value: unknown, maxLength: number): value is string {
	return typeof value === 'string' && value.length <= maxLength;
}
