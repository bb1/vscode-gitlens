import type { GitGraphRow } from '@gitlens/git/models/graph.js';

export type GraphPaging = {
	readonly hasMore: boolean;
};

export type GraphBootstrapMessage = {
	readonly type: 'graph/bootstrap';
	readonly rows: readonly GitGraphRow[];
	readonly paging: GraphPaging;
	readonly selection: string | undefined;
};

export type GraphAppendMessage = {
	readonly type: 'graph/append';
	readonly rows: readonly GitGraphRow[];
	readonly paging: GraphPaging;
};

export type GraphReplaceMessage = {
	readonly type: 'graph/replace';
	readonly rows: readonly GitGraphRow[];
	readonly paging: GraphPaging;
};

/** Host-to-webview graph data messages. */
export type GraphHostMessage = GraphBootstrapMessage | GraphAppendMessage | GraphReplaceMessage;

export type GraphMoreRequest = {
	readonly type: 'graph/more';
	readonly limit?: number;
	readonly targetId?: string;
};

export type GraphSelectionUpdate = {
	readonly type: 'graph/selection/update';
	readonly selection: string | undefined;
};

/** Action identifiers remain open until Task 9 wires the supported local and remote actions. */
export type GraphRowAction = {
	readonly type: 'graph/row/action';
	readonly action: string;
	readonly sha: string;
};

/** Webview-to-host interaction messages. */
export type GraphWebviewMessage = GraphMoreRequest | GraphSelectionUpdate | GraphRowAction;
