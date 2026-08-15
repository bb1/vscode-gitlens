import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import type { MaybePausedResult } from '@gitlens/utils/promise.js';
import type { Container } from '../../../container.js';

export async function getAssociatedIssuesForBranch(
	_container: Container,
	_branch: GitBranch,
	options?: {
		cancellation?: AbortSignal;
		timeout?: number;
		/** Only return issues already in the local cache. No remote fetch — uncached entries are skipped. */
		cached?: boolean;
	},
): Promise<MaybePausedResult<Issue[] | undefined>> {
	return { value: undefined, paused: false };
}

export async function removeAssociatedIssueFromBranch(
	_container: Container,
	_branch: GitBranchReference,
	_id: string,
	options?: {
		cancellation?: AbortSignal;
	},
): Promise<void> {}
