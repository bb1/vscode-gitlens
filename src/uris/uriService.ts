import type { Event, Uri, UriHandler } from 'vscode';
import { Disposable, EventEmitter, window } from 'vscode';
import { debug } from '@gitlens/utils/decorators/log.js';
import type { Container } from '../container.js';

// This service is in charge of registering a URI handler and handling/emitting URI events received by GitLens.
// URI events to GitLens take the form of: vscode://bb1.offline-gitlense/... and are handled by the UriEventHandler.
// The UriEventHandler is responsible for parsing the URI and emitting the event to the UriService.
export class UriService implements Disposable, UriHandler {
	private _onDidReceiveUri: EventEmitter<Uri> = new EventEmitter<Uri>();
	get onDidReceiveUri(): Event<Uri> {
		return this._onDidReceiveUri.event;
	}

	private _disposable: Disposable;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(this._onDidReceiveUri, window.registerUriHandler(this));
	}

	dispose(): void {
		this._disposable.dispose();
	}

	@debug({ args: uri => ({ uri: uri.with({ query: '' }).toString(true) }) })
	handleUri(uri: Uri): void {
		this._onDidReceiveUri.fire(uri);
	}
}
