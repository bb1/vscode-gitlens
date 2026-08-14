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

/** Host-to-webview graph data messages. */
export type GraphHostMessage = GraphBootstrapMessage | GraphAppendMessage | GraphReplaceMessage;
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

/** Webview-to-host interaction messages. */
export type GraphWebviewMessage = GraphMoreRequest | GraphSelectionUpdate | GraphRowAction;

const graphPageSizeMax = 5000;
const graphSelectionMax = 1000;
const graphParentsMax = 64;
const graphRefsMax = 64;
const graphAuthorMaxLength = 256;
const graphEmailMaxLength = 320;
const graphMessageMaxLength = 10000;
const graphRefNameMaxLength = 1024;
const shaRegex = /^[0-9a-f]{5,64}$/i;
const rowActions = new Set<GraphRowAction['action']>(['copy-sha', 'open-local', 'open-remote']);

export function parseGraphHostMessage(value: unknown): GraphHostMessage | undefined {
	if (!isRecord(value) || typeof value.type !== 'string') return undefined;
	if (value.type !== 'graph/bootstrap' && value.type !== 'graph/append' && value.type !== 'graph/replace') {
		return undefined;
	}

	const rows = parseGraphRows(value.rows);
	const paging = parseGraphPaging(value.paging);
	if (rows == null || paging == null) return undefined;

	switch (value.type) {
		case 'graph/bootstrap': {
			const selection = value.selection;
			if (selection !== undefined && !isSha(selection)) return undefined;

			return { type: 'graph/bootstrap', rows: rows, paging: paging, selection: selection };
		}
		case 'graph/append':
		case 'graph/replace':
			return { type: value.type, rows: rows, paging: paging };
	}
}

export function parseGraphWebviewMessage(value: unknown): GraphWebviewMessage | undefined {
	if (!isRecord(value) || typeof value.type !== 'string') return undefined;

	switch (value.type) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isGraphRowKind(value: unknown): value is GraphWebviewRow['kind'] {
	return value === 'commit' || value === 'merge' || value === 'stash' || value === 'workdir';
}

function isSha(value: unknown): value is string {
	return typeof value === 'string' && shaRegex.test(value);
}

function isString(value: unknown, maxLength: number): value is string {
	return typeof value === 'string' && value.length <= maxLength;
}
