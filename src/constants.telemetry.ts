export type AttributeValue = string | number | boolean | Array<null | undefined | string | number | boolean>;

export type TelemetryEventData = Record<string, AttributeValue | null | undefined>;
export type TelemetryGlobalContext = Record<string, AttributeValue | null | undefined>;
export type TelemetryEvents = Record<string, TelemetryEventData>;
export type WebviewTelemetryEvents = TelemetryEvents;

export type Sources = string;
export type Source = {
	source: Sources;
	correlationId?: string;
	detail?: string | TelemetryEventData;
};

export type WebviewTelemetryContext = Record<`context.${string}`, string | number | boolean | undefined>;
export type InspectTelemetryContext = WebviewTelemetryContext;
export type InspectWebviewTelemetryContext = WebviewTelemetryContext;
export type RebaseEditorTelemetryContext = WebviewTelemetryContext;

export type TrackedUsage = {
	count: number;
	firstUsedAt: number;
	lastUsedAt: number;
};
export type TrackedGlActions = string;
export type TrackedUsageFeatures = string;
export type TrackedUsageKeys = string;
