export type GraphTopologyRow = {
	readonly sha: string;
	readonly parents: readonly string[];
};

export type GraphLayoutRow = {
	readonly sha: string;
	readonly lane: number;
	readonly edges: readonly { readonly from: number; readonly to: number; readonly parent: string }[];
};

/**
 * Lays out display-ordered graph rows. The seed maps unresolved commits from a preceding page to their lanes;
 * it is never mutated.
 */
export function layoutGraphRows(
	rows: readonly GraphTopologyRow[],
	seed: ReadonlyMap<string, number> = new Map(),
): readonly GraphLayoutRow[] {
	validateSeed(seed);

	// Tracks only commits whose row has not yet been laid out.
	const lanes = new Map(seed);
	const layout: GraphLayoutRow[] = [];

	for (const row of rows) {
		const lane = lanes.get(row.sha) ?? firstFreeLane(lanes);

		lanes.delete(row.sha);

		const edges = row.parents.map(parent => {
			let parentLane = lanes.get(parent);

			if (parentLane == null) {
				parentLane = firstFreeLane(lanes);
				lanes.set(parent, parentLane);
			}

			return { from: lane, to: parentLane, parent: parent };
		});

		layout.push({ sha: row.sha, lane: lane, edges: edges });
	}

	return layout;
}

function validateSeed(seed: ReadonlyMap<string, number>): void {
	const occupied = new Set<number>();

	for (const [sha, lane] of seed) {
		if (!Number.isSafeInteger(lane) || lane < 0 || occupied.has(lane)) {
			throw new TypeError(`Invalid seed lane for "${sha}": lanes must be unique non-negative safe integers`);
		}

		occupied.add(lane);
	}
}

function firstFreeLane(lanes: ReadonlyMap<string, number>): number {
	const occupied = new Set(lanes.values());
	let lane = 0;

	while (occupied.has(lane)) {
		lane++;
	}

	return lane;
}
