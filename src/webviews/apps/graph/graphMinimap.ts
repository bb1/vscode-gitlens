export function getMinimapTargetIndex(offset: number, height: number, rowCount: number): number {
	if (rowCount === 0 || height <= 0) return 0;

	return Math.min(rowCount - 1, Math.max(0, Math.floor((offset / height) * rowCount)));
}
