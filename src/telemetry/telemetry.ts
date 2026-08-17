import type { Disposable } from 'vscode';
import type { Source, TelemetryEventData, TelemetryGlobalContext } from '../constants.telemetry.js';

type TimeInput = number | Date | [number, number];

export class TelemetryService implements Disposable {
	get enabled(): boolean {
		return false;
	}

	constructor(_container: unknown) {
		void _container;
	}

	dispose(): void {}

	sendEvent(
		_name: string,
		..._args: [data?: TelemetryEventData, source?: Source, startTime?: TimeInput, endTime?: TimeInput]
	): void {}

	startEvent(
		_name: string,
		..._args: [data?: TelemetryEventData, source?: Source, startTime?: TimeInput]
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
