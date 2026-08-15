import { html, nothing } from 'lit';
import { createCommandLink } from '../../../../../system/commands.js';
import './action-chip.js';

export function renderLearnAboutAutolinks(opts: {
	hasIntegrationsConnected: boolean;
	hasAccount: boolean;
	showLabel?: boolean;
	slotName?: 'prefix' | 'suffix';
}) {
	const autolinkSettingsLink = createCommandLink('gitlens.showSettingsPage!autolinks', {
		showOptions: { preserveFocus: true },
	});

	void opts.hasAccount;
	const label =
		'Configure autolinks to linkify external references, like Jira or Zendesk tickets, in commit messages.';

	return html`<gl-action-chip
		slot=${opts.slotName ?? nothing}
		href=${autolinkSettingsLink}
		data-action="autolink-settings"
		icon="info"
		.label=${label}
		truncate
		overlay="tooltip"
		>${opts.showLabel ? html`<span class="mq-hide-sm">&nbsp;No autolinks found</span>` : nothing}</gl-action-chip
	>`;
}
