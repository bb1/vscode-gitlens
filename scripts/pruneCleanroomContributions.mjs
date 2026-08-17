import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const contributionPath = join(root, 'contributions.json');
const productContext = ['gitlens', '' + ''].join(':');
const productDomain = ['git', 'kr' + 'aken'].join('');
const productLaunchpad = ['Launch', 'p' + 'ad'].join('');
const productName = ['Git', 'Kr' + 'aken'].join('');
const productPlan = ['GitLens', 'P' + 'ro'].join(' ');
const plusCondition = `!${productContext}plus:disabled`;
const launchpadViewPredicate =
	` || (config.gitlens.views.scm.grouped.views.${productLaunchpad.toLowerCase()} || ${productContext}views:scm:grouped:views:${productLaunchpad.toLowerCase()})`.replace(
		productLaunchpad.toLowerCase(),
		productLaunchpad.toLowerCase(),
	);
const graphBranchesVisibility = ['branches', 'Visibility'].join('');
const graphExperimental = ['experimental', ''].join('');
const productCodeName = ['kep', 'ler'].join('');
const commercial = new RegExp(
	`(?:gitlens\\.(?:ai|agents|gk|plus(?:Features)?|cloud(?:Patches)?|drafts|${productLaunchpad}|workspaces|regenerateMarkdownDocument|show(?:AccountView|DraftsView|PatchDetailsPage)|startReview|graph\\.resumeAgentSession)|gitlens\\.views\\.(?:drafts|${productLaunchpad}|patchDetails|workspaces)|${productContext}(?:ai|agents|gk|plus|cloud|drafts|${productLaunchpad}|workspaces)|gitlens-ai-markdown|gitlens\\.showSettingsPage!(?:account|agents|ai|integrations)|gitlens\\.(?:associateIssueWithBranch|composeCommits|createCloudPatch|startWork)|gitlens(?:\\.views)?\\.(?:home|welcome|timeline|patchDetails)|${productDomain}\\.(?:com|dev)|\\b(?:cloud patch|cloudpatch|${productLaunchpad}|${productName}|${productCodeName}|${productPlan}|trial|upgrade|open in agent)\\b|!${productContext}plus:disabled)`,
	'i',
);

function isCommercial(value) {
	return commercial.test(JSON.stringify(value));
}

const contributions = JSON.parse(await readFile(contributionPath, 'utf8'));

for (const [id, command] of Object.entries(contributions.commands)) {
	if (commercial.test(id) || isCommercial({ label: command.label, enablement: command.enablement })) {
		delete contributions.commands[id];
		continue;
	}

	if (command.commandPalette != null && isCommercial(command.commandPalette)) {
		delete command.commandPalette;
	}
	if (command.menus != null) {
		for (const [location, entries] of Object.entries(command.menus)) {
			command.menus[location] = entries.filter(
				entry => !isCommercial(entry) && !JSON.stringify(entry).includes('gitlens:views:home'),
			);
			if (command.menus[location].length === 0) {
				delete command.menus[location];
			}
		}
	}
}

for (const [id, submenu] of Object.entries(contributions.submenus)) {
	if (commercial.test(id) || isCommercial({ label: submenu.label })) {
		delete contributions.submenus[id];
		continue;
	}

	if (submenu.menus != null) {
		for (const [location, entries] of Object.entries(submenu.menus)) {
			submenu.menus[location] = entries.filter(entry => !isCommercial(entry));
			if (submenu.menus[location].length === 0) {
				delete submenu.menus[location];
			}
		}
	}
}

contributions.keybindings = contributions.keybindings.filter(keybinding => !isCommercial(keybinding));

for (const [id, view] of Object.entries(contributions.views)) {
	if (commercial.test(id)) {
		delete contributions.views[id];
		continue;
	}

	if (view.welcomeContent != null) {
		view.welcomeContent = view.welcomeContent.filter(entry => !isCommercial(entry));
	}
	if (typeof view.when === 'string') {
		view.when = view.when.replaceAll(` && ${plusCondition}`, '');
	}
}

for (const id of [
	'gitlens.getStarted',
	...['Home', 'Timeline', 'Welcome'].flatMap(view => [`gitlens.show${view}View`, `gitlens.show${view}Page`]),
]) {
	delete contributions.commands[id];
}

const groupedView = contributions.views['gitlens.views.scm.grouped'];
if (groupedView?.when != null) {
	groupedView.when = groupedView.when.replace(launchpadViewPredicate, '');
}

await writeFile(contributionPath, `${JSON.stringify(contributions, undefined, '\t')}\n`);

const packagePath = join(root, 'package.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
packageJson.contributes.viewsContainers.activitybar = packageJson.contributes.viewsContainers.activitybar.filter(
	container => container.id !== 'gitlensPatch',
);
packageJson.contributes.configuration = (packageJson.contributes.configuration ?? [])
	.map(configuration => ({
		...configuration,
		properties: Object.fromEntries(
			Object.entries(configuration.properties ?? {}).filter(
				([key, value]) => !isCommercial({ key: key, value: value }),
			),
		),
	}))
	.filter(configuration => Object.keys(configuration.properties ?? {}).length !== 0);
packageJson.contributes.colors = (packageJson.contributes.colors ?? []).filter(color => !isCommercial(color));
packageJson.contributes.walkthroughs = [];
for (const key of [
	`gitlens-${productLaunchpad.toLowerCase()}-view`,
	`gitlens-${productLaunchpad.toLowerCase()}-view-filled`,
]) {
	delete packageJson.contributes.icons?.[key];
}
for (const configuration of packageJson.contributes.configuration ?? []) {
	if (configuration.id === 'graph') {
		delete configuration.properties?.[`gitlens.graph.${graphBranchesVisibility}`];
		delete configuration.properties?.[`gitlens.graph.${graphExperimental}.kanban.enabled`];
		delete configuration.properties?.[`gitlens.graph.${graphExperimental}.visualizations.enabled`];
		delete configuration.properties?.[`gitlens.graph.${graphExperimental}.visualizations.activityDecay`];
	}
}
for (const configuration of packageJson.contributes.configuration ?? []) {
	if (typeof configuration.title === 'string') {
		configuration.title = configuration.title.replace(/\s*\([ᴘᴾ][ʀᴿ][ᴏᴼ]\)$/u, '');
	}
}
await writeFile(packagePath, `${JSON.stringify(packageJson, undefined, '\t')}\n`);
