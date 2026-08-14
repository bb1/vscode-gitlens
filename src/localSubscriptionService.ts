import type { AuthenticationSession, Event } from 'vscode';
import { EventEmitter } from 'vscode';
import { SubscriptionState } from './constants.subscription.js';
import type { FeaturePreview, FeaturePreviews } from './features.js';
import type { Subscription } from './plus/gk/models/subscription.js';
import type { SubscriptionChangeEvent } from './plus/gk/subscriptionService.js';
import { getCommunitySubscription } from './plus/gk/utils/subscription.utils.js';

export class LocalSubscriptionService {
	private readonly _onDidChange = new EventEmitter<SubscriptionChangeEvent>();
	readonly onDidChange: Event<SubscriptionChangeEvent> = this._onDidChange.event;
	private readonly _onDidChangeFeaturePreview = new EventEmitter<FeaturePreview>();
	readonly onDidChangeFeaturePreview: Event<FeaturePreview> = this._onDidChangeFeaturePreview.event;
	private readonly _onDidCheckIn = new EventEmitter<{ force?: boolean } | void>();
	readonly onDidCheckIn: Event<{ force?: boolean } | void> = this._onDidCheckIn.event;

	get etag(): number {
		return 0;
	}

	getSubscription(_force?: boolean): Promise<Subscription> {
		return Promise.resolve(getCommunitySubscription());
	}

	getFeaturePreview(feature: FeaturePreviews): FeaturePreview {
		return { feature: feature, usages: [] };
	}

	autoResetTrialIfEligible(_options?: unknown): Promise<false> {
		return Promise.resolve(false);
	}

	getAuthenticationSession(): Promise<AuthenticationSession | undefined> {
		return Promise.resolve(undefined);
	}

	loginOrSignUp(_signUp: boolean, _source?: unknown): Promise<false> {
		return Promise.resolve(false);
	}

	loginWithCode(_options: unknown, _source?: unknown): Promise<false> {
		return Promise.resolve(false);
	}

	resendVerification(_source?: unknown): Promise<false> {
		return Promise.resolve(false);
	}

	upgrade(_plan?: unknown, _source?: unknown): Promise<false> {
		return Promise.resolve(false);
	}

	manageSubscription(_source?: unknown): Promise<false> {
		return Promise.resolve(false);
	}

	aiAllAccessOptIn(_options?: unknown): Promise<false> {
		return Promise.resolve(false);
	}

	get state(): SubscriptionState {
		return SubscriptionState.Community;
	}
}
