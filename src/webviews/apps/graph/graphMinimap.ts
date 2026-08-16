export function getMinimapTargetIndex(offset: number, height: number, rowCount: number): number {
	if (rowCount === 0 || height <= 0) return 0;

	return Math.min(rowCount - 1, Math.max(0, Math.floor((offset / height) * rowCount)));
}

export function getMinimapViewport(first: number, last: number, rowCount: number): { start: number; size: number } {
	if (rowCount === 0) return { start: 0, size: 0 };

	const start = Math.min(rowCount - 1, Math.max(0, first));
	const end = Math.min(rowCount - 1, Math.max(start, last));
	return { start: (start / rowCount) * 100, size: ((end - start + 1) / rowCount) * 100 };
}

export function getMinimapMarkerPosition(index: number, rowCount: number): number {
	if (rowCount === 0) return 0;

	return ((Math.min(rowCount - 1, Math.max(0, index)) + 0.5) / rowCount) * 100;
}

export function getMinimapRowMarkers(rowCount: number, maximum: number = 100): readonly number[] {
	if (rowCount === 0 || maximum <= 0) return [];

	const count = Math.min(rowCount, maximum);
	return Array.from({ length: count }, (_, index) => Math.floor((index / count) * rowCount));
}
