import type { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import type { AsyncStepResultGenerator, PartialStepState } from '../models/steps.js';
import type { StepController } from '../stepsController.js';

export async function getAccessGateErrorMessage(
	container: Container,
	_feature: string,
	repoPath: string | undefined,
	action: string,
): Promise<string> {
	const access = await container.git.getAccess();
	return access.available ? '' : `Unable to ${action}.`;
}

export async function* ensureAccessStep<
	State extends PartialStepState & { repo?: GlRepository },
	Context extends { title: string },
>(
	container: Container,
	_feature: string,
	state: State,
	_context: Context,
	parentStep: StepController<any>,
	_interactive: boolean = true,
): AsyncStepResultGenerator<void> {
	parentStep.skip();
	const yieldNothing = false;
	if (yieldNothing) yield undefined as never;

	return undefined;
}
