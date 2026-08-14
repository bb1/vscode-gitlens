import type { Disposable } from 'vscode';
import type { Source, TelemetryEvents, TelemetryGlobalContext } from '../constants.telemetry.js';

type TimeInput = number | Date | [number, number];

export class TelemetryService implements Disposable {
	get enabled(): boolean {
		return false;
	}

	constructor(_container: unknown) {
		void _container;
	}

	dispose(): void {}

	sendEvent<T extends keyof TelemetryEvents>(
		_name: T,
		..._args: TelemetryEvents[T] extends void
			? [data?: never, source?: Source, startTime?: TimeInput, endTime?: TimeInput]
			: [data: TelemetryEvents[T], source?: Source, startTime?: TimeInput, endTime?: TimeInput]
	): void {}

	startEvent<T extends keyof TelemetryEvents>(
		_name: T,
		..._args: TelemetryEvents[T] extends void
			? [data?: never, source?: Source, startTime?: TimeInput]
			: [data: TelemetryEvents[T], source?: Source, startTime?: TimeInput]
	): Disposable | undefined {
		return undefined;
	}

	setGlobalAttribute<T extends keyof TelemetryGlobalContext>(
		_key: T,
		_value: TelemetryGlobalContext[T] | null | undefined,
	): void {}

	setGlobalAttributes(_attributes: Partial<TelemetryGlobalContext>): void {}

	deleteGlobalAttribute(_key: keyof TelemetryGlobalContext): void {}
}
