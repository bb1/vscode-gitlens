import type { LocalAccess } from './features.js';

export class LocalSubscriptionService {
	getAccess(): Promise<LocalAccess> {
		return Promise.resolve({ available: true });
	}
}
