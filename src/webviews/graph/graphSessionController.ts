import type { GitGraphSession, GitGraphSessionRefreshOptions } from '@gitlens/git/models/graphSession.js';
import type { GraphHostMessage } from './protocol.js';

export type GraphSessionControllerOptions = {
	readonly open: (cancellation: AbortSignal) => Promise<GitGraphSession>;
	readonly postMessage: (message: GraphHostMessage) => Promise<void>;
	readonly selection?: string;
};

/**
 * Owns one graph session and serializes its mutations. Calls made after `dispose()` reject with
 * `GraphSessionController is disposed`; work already in flight is cancelled and produces no later message.
 */
export class GraphSessionController {
	private readonly cancellation = new AbortController();
	private readonly openSession: (cancellation: AbortSignal) => Promise<GitGraphSession>;
	private readonly postMessage: (message: GraphHostMessage) => Promise<void>;
	private session: GitGraphSession | undefined;
	private opening: Promise<void> | undefined;
	private operations: Promise<void> = Promise.resolve();
	private disposed = false;
	private selection: string | undefined;

	constructor(options: GraphSessionControllerOptions) {
		this.openSession = options.open;
		this.postMessage = options.postMessage;
		this.selection = options.selection;
	}

	open(): Promise<void> {
		if (this.disposed) return Promise.reject(disposedError());

		if (this.opening != null) return this.opening;

		const opening = this.doOpen();
		this.opening = opening;
		void opening.catch(() => {
			if (!this.disposed && this.opening === opening) {
				this.opening = undefined;
			}
		});
		return opening;
	}

	more(limit?: number, targetId?: string): Promise<void> {
		if (this.disposed) return Promise.reject(disposedError());

		return this.enqueue(async () => {
			await this.ensureOpen();
			if (this.disposed) return;

			const session = this.getSession();
			let gotMore: boolean;
			try {
				gotMore = await session.more(limit, targetId, this.cancellation.signal);
			} catch (error) {
				if (this.disposed) return;

				throw error;
			}
			if (!gotMore || this.disposed || this.session !== session) return;

			await this.send({
				type: 'graph/append',
				rows: session.current.rows,
				paging: pagingOf(session),
			});
		});
	}

	refresh(options?: GitGraphSessionRefreshOptions): Promise<void> {
		if (this.disposed) return Promise.reject(disposedError());

		return this.enqueue(async () => {
			await this.ensureOpen();
			if (this.disposed) return;

			const session = this.getSession();
			try {
				await session.refresh(options, this.cancellation.signal);
			} catch (error) {
				if (this.disposed) return;

				throw error;
			}
			if (this.disposed || this.session !== session) return;

			await this.send({
				type: 'graph/replace',
				rows: session.window,
				paging: pagingOf(session),
			});
		});
	}

	dispose(): void {
		if (this.disposed) return;

		this.disposed = true;
		this.cancellation.abort();
		this.session?.dispose();
		this.session = undefined;
	}

	private async doOpen(): Promise<void> {
		let session: GitGraphSession;
		try {
			session = await this.openSession(this.cancellation.signal);
		} catch (error) {
			if (this.disposed) return;

			throw error;
		}
		if (this.disposed) {
			session.dispose();
			return;
		}

		this.session = session;
		try {
			await this.send({
				type: 'graph/bootstrap',
				rows: session.window,
				paging: pagingOf(session),
				selection: this.selection,
			});
		} catch (error) {
			if (this.session === session) {
				this.session = undefined;
				session.dispose();
			}

			throw error;
		}
	}

	private enqueue(operation: () => Promise<void>): Promise<void> {
		const result = this.operations.then(operation, operation);
		this.operations = result.catch(() => {});
		return result;
	}

	private getSession(): GitGraphSession {
		if (this.session == null) throw new Error('GraphSessionController is not open');

		return this.session;
	}

	private async ensureOpen(): Promise<void> {
		await this.open().catch((error: unknown) => {
			if (!this.disposed) throw error;
		});
	}

	private async send(message: GraphHostMessage): Promise<void> {
		if (this.disposed) return;

		await this.postMessage(message);
	}
}

function pagingOf(session: GitGraphSession): { hasMore: boolean } {
	return { hasMore: session.current.paging?.hasMore ?? false };
}

function disposedError(): Error {
	return new Error('GraphSessionController is disposed');
}
