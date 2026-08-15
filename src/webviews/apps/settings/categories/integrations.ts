import type { SettingsCategory } from '../model.js';

export const integrationsCategories: SettingsCategory[] = [
	{
		id: 'remotes',
		settingsSearch: 'gitlens.remotes',
		name: 'Custom Remotes',
		group: 'Integrations',
		icon: 'remote',
		hint: 'Match your Git remotes to a provider so GitLens can open files, commits, and pull requests on self-hosted or custom Git hosts.',
		controls: [{ kind: 'remotes', label: 'Custom remotes' }],
	},
	{
		id: 'autolinks',
		settingsSearch: 'gitlens.autolinks',
		name: 'Autolinks',
		group: 'Integrations',
		icon: 'link',
		hint: 'Use autolinks to linkify external references in commit messages.',
		controls: [{ kind: 'autolinks', label: 'Custom autolinks' }],
	},
	{
		id: 'terminal-links',
		name: 'Terminal Links',
		group: 'Integrations',
		icon: 'terminal',
		hint: 'Adds links for branches, tags, commits, and commit ranges in the integrated terminal.',
		master: { kind: 'check', key: 'terminalLinks.enabled', label: 'Terminal Links' },
		controls: [
			{
				kind: 'select',
				key: 'terminalLinks.showIn',
				label: 'Open commit and ref links in',
				enabledWhen: 'terminalLinks.enabled',
				options: [
					{ value: 'graph', label: 'the Commit Graph (default)' },
					{ value: 'inspect', label: 'the Inspect view' },
					{ value: 'quickpick', label: 'a quick pick' },
				],
			},
		],
	},
];
