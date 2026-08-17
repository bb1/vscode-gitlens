import { EventEmitter, Uri } from 'vscode';
import { fetch } from '@env/fetch.js';
import { base64 } from '@gitlens/utils/base64.js';
import { md5 } from '@gitlens/utils/crypto.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { filterMap } from '@gitlens/utils/iterable.js';
import type { GravatarDefaultStyle } from './config.js';
import type { StoredAvatar } from './constants.storage.js';
import { Container } from './container.js';
import { getHostingProviderDescriptor } from './git/utils/-webview/remote.utils.js';
import type { ContactPresenceStatus } from './vsls/vsls.js';

let avatarCache: Map<string, Avatar> | undefined;
const avatarQueue = new Map<string, Promise<Uri>>();
const providerAvatarUrls = new Set<string>();

const _onDidFetchAvatar = new EventEmitter<{ email: string }>();
const storeAvatars = debounce(() => {
	const avatars =
		avatarCache != null
			? [
					...filterMap(avatarCache, ([key, avatar]) =>
						avatar.uri != null
							? ([
									key,
									{
										uri: avatar.uri.toString(),
										timestamp: avatar.timestamp,
									},
								] as [string, StoredAvatar])
							: undefined,
					),
				]
			: undefined;
	void Container.instance.storage.store('avatars', avatars).catch();
}, 1000);
_onDidFetchAvatar.event(storeAvatars);

export const onDidFetchAvatar = _onDidFetchAvatar.event;

interface Avatar {
	uri?: Uri;
	fallback?: Uri;
	timestamp: number;
	retries: number;
}

const missingGravatarHash = '00000000000000000000000000000000';

const presenceCache = new Map<ContactPresenceStatus, string>();

const millisecondsPerMinute = 60 * 1000;
const millisecondsPerHour = 60 * 60 * 1000;
const millisecondsPerDay = 24 * 60 * 60 * 1000;

const retryDecay = [
	millisecondsPerDay * 7, // First item is cache expiration (since retries will be 0)
	millisecondsPerMinute,
	millisecondsPerMinute * 5,
	millisecondsPerMinute * 10,
	millisecondsPerHour,
	millisecondsPerDay,
	millisecondsPerDay * 7,
];

export function getAvatarUri(
	email: string | undefined,
	repoPathOrCommit?: undefined,
	options?: { defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri;
export function getAvatarUri(
	email: string | undefined,
	repoPathOrCommit: string | { ref: string; repoPath: string },
	options?: { defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri | Promise<Uri>;
export function getAvatarUri(
	email: string | undefined,
	repoPathOrCommit: string | { ref: string; repoPath: string } | undefined,
	options?: { defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri | Promise<Uri> {
	return getAvatarUriCore(email, repoPathOrCommit, options);
}

export function getCachedAvatarUri(email: string | undefined, options?: { size?: number }): Uri | undefined {
	return getAvatarUriCore(email, undefined, { ...options, cached: true });
}

function getAvatarUriCore(
	email: string | undefined,
	repoPathOrCommit: string | { ref: string; repoPath: string } | undefined,
	options?: { cached: true; defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri | undefined;
function getAvatarUriCore(
	email: string | undefined,
	repoPathOrCommit: string | { ref: string; repoPath: string } | undefined,
	options?: { defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri | Promise<Uri>;
function getAvatarUriCore(
	email: string | undefined,
	repoPathOrCommit: string | { ref: string; repoPath: string } | undefined,
	options?: { cached?: boolean; defaultStyle?: GravatarDefaultStyle; size?: number },
): Uri | Promise<Uri> | undefined {
	ensureAvatarCache(avatarCache);

	// Double the size to avoid blurring on the retina screen
	const size = (options?.size ?? 16) * 2;

	if (!email) {
		const avatar = createOrUpdateAvatar(
			`${missingGravatarHash}:${size}`,
			size,
			missingGravatarHash,
			options?.defaultStyle,
		);
		return avatar.uri ?? avatar.fallback!;
	}

	const hash = md5(email.trim().toLowerCase());
	const key = `${hash}:${size}`;

	const avatar = createOrUpdateAvatar(key, size, hash, options?.defaultStyle);
	if (avatar.uri != null) return avatar.uri;

	if (!options?.cached && repoPathOrCommit != null) {
		let query = avatarQueue.get(key);
		if (query == null && hasAvatarExpired(avatar)) {
			query = getAvatarUriFromRemoteProvider(avatar, email, repoPathOrCommit).then(
				uri => uri ?? avatar.uri ?? avatar.fallback!,
			);
			avatarQueue.set(
				key,
				query.finally(() => avatarQueue.delete(key)),
			);
		}

		return query ?? avatar.fallback!;
	}

	return options?.cached ? avatar.uri : (avatar.uri ?? avatar.fallback!);
}

function createOrUpdateAvatar(key: string, size: number, hash: string, defaultStyle?: GravatarDefaultStyle): Avatar {
	let avatar = avatarCache!.get(key);
	if (avatar == null) {
		avatar = {
			fallback: getGeneratedAvatarUri(hash, size, defaultStyle),
			timestamp: 0,
			retries: 0,
		};
		avatarCache!.set(key, avatar);
	} else {
		avatar.fallback ??= getGeneratedAvatarUri(hash, size, defaultStyle);
	}
	return avatar;
}

function ensureAvatarCache(cache: Map<string, Avatar> | undefined): asserts cache is Map<string, Avatar> {
	if (cache == null) {
		const avatars: [string, Avatar][] | undefined = Container.instance.storage
			.get('avatars')
			?.map<[string, Avatar]>(([key, avatar]) => [
				key,
				{
					uri: Uri.parse(avatar.uri),
					timestamp: avatar.timestamp,
					retries: 0,
				},
			]);
		avatarCache = new Map<string, Avatar>(avatars);
	}
}

function hasAvatarExpired(avatar: Avatar) {
	return Date.now() >= avatar.timestamp + retryDecay[Math.min(avatar.retries, retryDecay.length - 1)];
}

function getGeneratedAvatarUri(hash: string, size: number, _defaultStyle?: GravatarDefaultStyle): Uri {
	const color = `#${hash.slice(0, 6)}`;
	const initials = hash.slice(6, 8).toUpperCase();
	const contents = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" fill="${color}"/><text x="16" y="21" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="12">${initials}</text></svg>`;
	return Uri.parse(`data:image/svg+xml;base64,${base64(contents)}`);
}

export function getAvatarUriFromGravatarEmail(email: string, size: number, defaultStyle?: GravatarDefaultStyle): Uri {
	return getGeneratedAvatarUri(md5(email.trim().toLowerCase()), size, defaultStyle);
}

async function getAvatarUriFromRemoteProvider(
	avatar: Avatar,
	email: string,
	repoPathOrCommit: string | { ref: string; repoPath: string },
) {
	ensureAvatarCache(avatarCache);

	try {
		if (typeof repoPathOrCommit === 'string') return undefined;

		const remote = await Container.instance.git
			.getRepositoryService(repoPathOrCommit.repoPath)
			.remotes.getBestRemoteWithProvider();
		const descriptor = remote?.provider == null ? undefined : getHostingProviderDescriptor(remote.provider);
		const account =
			descriptor == null
				? undefined
				: await Container.instance.hosting.get(descriptor.id, descriptor.repository.domain)?.getAccount?.();
		if (account == null || 'authenticationRequired' in account || account.avatarUrl == null) return undefined;

		const accountAvatar = new URL(account.avatarUrl);
		if (accountAvatar.protocol !== 'https:') return undefined;

		avatar.uri = Uri.parse(account.avatarUrl);
		providerAvatarUrls.add(account.avatarUrl);
		avatar.timestamp = Date.now();
		avatar.retries = 0;

		_onDidFetchAvatar.fire({ email: email });

		return avatar.uri;
	} catch {
		avatar.uri = undefined;
		avatar.timestamp = Date.now();
		avatar.retries++;

		return undefined;
	}
}

const maxAvatarProxyBytes = 512 * 1024; // 512 KB
const rasterImageTypes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);

export async function fetchAvatarImageAsDataUri(url: string): Promise<Uri | undefined> {
	try {
		if (!providerAvatarUrls.has(url)) return undefined;

		const rsp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		if (!rsp.ok) {
			void rsp.body?.cancel();
			return undefined;
		}
		if (!rsp.url.startsWith('https://')) {
			void rsp.body?.cancel();
			return undefined;
		}

		const contentType = rsp.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
		if (!rasterImageTypes.has(contentType ?? '')) {
			void rsp.body?.cancel();
			return undefined;
		}

		const contentLength = rsp.headers.get('content-length');
		if (contentLength != null && parseInt(contentLength, 10) > maxAvatarProxyBytes) {
			void rsp.body?.cancel();
			return undefined;
		}

		const buffer = await rsp.arrayBuffer();
		if (buffer.byteLength > maxAvatarProxyBytes) return undefined;

		const data = base64(new Uint8Array(buffer));
		return Uri.parse(`data:${contentType};base64,${data}`);
	} catch {
		return undefined;
	}
}

const presenceStatusColorMap = new Map<ContactPresenceStatus, string>([
	['online', '#28ca42'],
	['away', '#cecece'],
	['busy', '#ca5628'],
	['dnd', '#ca5628'],
	['offline', '#cecece'],
]);

export function getPresenceDataUri(status: ContactPresenceStatus): string {
	let dataUri = presenceCache.get(status);
	if (dataUri == null) {
		const contents = base64(`<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="4" height="16" viewBox="0 0 4 16">
	<circle cx="2" cy="14" r="2" fill="${presenceStatusColorMap.get(status)!}"/>
</svg>`);
		dataUri = encodeURI(`data:image/svg+xml;base64,${contents}`);
		presenceCache.set(status, dataUri);
	}

	return dataUri;
}

export function resetApprovedAvatarTemplates(): Promise<void> {
	resetAvatarCache('failed');
	return Promise.resolve();
}

export function resetAvatarCache(reset: 'all' | 'failed' | 'fallback'): void {
	switch (reset) {
		case 'all':
			storeAvatars.cancel();
			void Container.instance.storage.delete('avatars');
			avatarCache?.clear();
			avatarQueue.clear();
			providerAvatarUrls.clear();
			break;

		case 'failed':
			for (const avatar of avatarCache?.values() ?? []) {
				// Reset failed requests
				if (avatar.uri == null) {
					avatar.timestamp = 0;
					avatar.retries = 0;
				}
			}
			break;

		case 'fallback':
			for (const avatar of avatarCache?.values() ?? []) {
				avatar.fallback = undefined;
			}
			break;
	}
}

export function setDefaultGravatarsStyle(style: GravatarDefaultStyle): void {
	void style;
	resetAvatarCache('fallback');
}
