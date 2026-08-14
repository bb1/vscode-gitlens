import type { Container } from '../../../container.js';
import type { FeatureAccess, PlusFeatures, RepoFeatureAccess } from '../../../features.js';
import type { GlRepository } from '../../../git/models/repository.js';
import type { AsyncStepResultGenerator, PartialStepState } from '../models/steps.js';
import type { StepController } from '../stepsController.js';

export async function getAccessGateErrorMessage(
	container: Container,
	feature: PlusFeatures,
	repoPath: string | undefined,
	action: string,
): Promise<string> {
	const access = await container.git.access(feature, repoPath);
	return access.allowed ? '' : `Unable to ${action}.`;
}

export async function* ensureAccessStep<
	State extends PartialStepState & { repo?: GlRepository },
	Context extends { title: string },
>(
	container: Container,
	feature: PlusFeatures,
	state: State,
	_context: Context,
	parentStep: StepController<any>,
	_interactive: boolean = true,
): AsyncStepResultGenerator<FeatureAccess | RepoFeatureAccess> {
	const access = await container.git.access(feature, state.repo?.path);
	parentStep.skip();
	const yieldNothing = false;
	if (yieldNothing) yield undefined as never;

	return access;
}
