export function getManualRebaseModes(canRebase: boolean): { flags: '--interactive'[]; picked: boolean }[] {
	const modes: { flags: '--interactive'[]; picked: boolean }[] = [];
	if (canRebase) {
		modes.push({ flags: [], picked: true });
	}

	modes.push({ flags: ['--interactive'], picked: !canRebase });
	return modes;
}
