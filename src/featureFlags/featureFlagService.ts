export type FeatureFlagValue = boolean | string | number;
export enum FeatureFlagKey {
	WelcomeTitleVariant = 'glensWelcomeTitleVariant',
}
export type FeatureFlagMap = Readonly<Partial<Record<FeatureFlagKey, FeatureFlagValue>>>;

export interface FeatureFlagService {
	dispose(): void;
	getFlag<T extends FeatureFlagValue>(key: FeatureFlagKey, defaultValue: T): T;
	getAllFlags(): FeatureFlagMap;
}

export class LocalFeatureFlagService implements FeatureFlagService {
	dispose(): void {}

	getFlag<T extends FeatureFlagValue>(_key: FeatureFlagKey, defaultValue: T): T {
		return defaultValue;
	}

	getAllFlags(): FeatureFlagMap {
		return {};
	}
}
