export type GraphSelectionOptions = {
	readonly range?: boolean;
	readonly toggle?: boolean;
};

export function selectGraphRows(
	rows: readonly string[],
	selected: readonly string[],
	row: string,
	options: GraphSelectionOptions = {},
): readonly string[] {
	if (options.range) {
		const active = selected.at(-1);
		const activeIndex = active == null ? -1 : rows.indexOf(active);
		const rowIndex = rows.indexOf(row);

		if (activeIndex !== -1 && rowIndex !== -1) {
			return rows.slice(Math.min(activeIndex, rowIndex), Math.max(activeIndex, rowIndex) + 1);
		}
	}

	if (options.toggle) {
		return selected.includes(row) ? selected.filter(selectedRow => selectedRow !== row) : [...selected, row];
	}

	return [row];
}
