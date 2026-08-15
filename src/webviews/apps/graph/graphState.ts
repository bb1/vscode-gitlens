export type GraphColumn = string;

export type GraphDisplayPreferences = {
	readonly columns: readonly GraphColumn[];
	readonly compact: boolean;
	readonly minimap: boolean;
};

export type GraphWorkspaceState = {
	readonly display: GraphDisplayPreferences;
};

export type GraphWorkspaceMessage = {
	readonly type: 'graph/display';
	readonly display: GraphDisplayPreferences;
};

export function applyGraphWorkspaceMessage(
	state: GraphWorkspaceState,
	message: GraphWorkspaceMessage,
): GraphWorkspaceState {
	return { ...state, display: { ...message.display, columns: [...message.display.columns] } };
}

export function toggleGraphColumn(display: GraphDisplayPreferences, column: GraphColumn): GraphDisplayPreferences {
	const columns = display.columns.includes(column)
		? display.columns.filter(current => current !== column)
		: [...display.columns, column];

	return { ...display, columns: columns };
}
