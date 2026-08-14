import type { CreatePullRequestInput } from '../models.js';

export type HostingRequest = {
	method: 'GET' | 'POST';
	url: string;
	headers: Readonly<Record<string, string>>;
	body?: string;
};

export type HostingResponse = {
	status: number;
	body: unknown;
};

export type HostingRequestTransport = (request: HostingRequest) => Promise<HostingResponse>;

const requestErrorKind = 'gitlens.hosting-request-error';

export class HostingRequestError extends Error {
	static is(error: unknown): error is HostingRequestError {
		return (
			error instanceof HostingRequestError ||
			(isRecord(error) &&
				error.kind === requestErrorKind &&
				typeof error.status === 'number' &&
				Number.isFinite(error.status))
		);
	}

	constructor(
		provider: string,
		readonly status: number,
	) {
		super(`${provider} request failed`);
		Object.defineProperty(this, 'kind', { value: requestErrorKind });
	}
}

export async function sendRequest(
	provider: string,
	transport: HostingRequestTransport,
	request: HostingRequest,
): Promise<HostingResponse> {
	let response: HostingResponse;
	try {
		response = await transport(request);
	} catch {
		throw new Error(`${provider} request failed`, { cause: new Error(`${provider} transport failed`) });
	}

	if (!isRecord(response) || typeof response.status !== 'number' || !Number.isFinite(response.status)) {
		throw new Error(`${provider} request failed`);
	}

	if (response.status < 200 || response.status >= 300) {
		throw new HostingRequestError(provider, response.status);
	}

	return response;
}

export function normalizeHostname(provider: string, domain: unknown): string {
	if (typeof domain !== 'string' || domain !== domain.trim()) {
		throw new Error(`Invalid ${provider} domain`);
	}

	const normalizedDomain = domain.toLowerCase();
	if (
		!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
			normalizedDomain,
		)
	) {
		throw new Error(`Invalid ${provider} domain`);
	}

	try {
		if (new URL(`https://${domain}`).hostname !== normalizedDomain) {
			throw new Error(`Invalid ${provider} domain`);
		}
	} catch {
		throw new Error(`Invalid ${provider} domain`);
	}

	return normalizedDomain;
}

export function validateRepositoryDomain(provider: string, configuredDomain: string, domain: unknown): string {
	const normalizedDomain = normalizeHostname(provider, domain);
	if (normalizedDomain !== configuredDomain) {
		throw new Error(`Invalid ${provider} repository domain`);
	}

	return normalizedDomain;
}

export function validateAccessToken(provider: string, accessToken: unknown): string {
	const token = typeof accessToken === 'string' ? accessToken.trim() : undefined;
	if (token == null || token.length === 0) {
		throw new Error(`Invalid ${provider} access token`);
	}

	return token;
}

export function validatePullRequestInput(provider: string, input: CreatePullRequestInput): CreatePullRequestInput {
	if (!isRecord(input)) {
		throw new Error(`Invalid ${provider} pull request input`);
	}

	if (!isGitReference(input.base)) {
		throw new Error(`Invalid ${provider} base branch`);
	}

	if (!isGitReference(input.head)) {
		throw new Error(`Invalid ${provider} head branch`);
	}

	if (typeof input.title !== 'string' || input.title.length === 0 || hasControlCharacter(input.title)) {
		throw new Error(`Invalid ${provider} pull request title`);
	}

	if (input.body != null && (typeof input.body !== 'string' || input.body.includes('\0'))) {
		throw new Error(`Invalid ${provider} pull request body`);
	}

	return input;
}

export function getSafeUrl(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;

	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' || url.username.length !== 0 || url.password.length !== 0) {
			return undefined;
		}

		return url.toString();
	} catch {
		return undefined;
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value != null;
}

export function isGitReference(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
		!value.endsWith('.') &&
		!value.endsWith('/') &&
		!value.includes('..') &&
		!value.includes('//') &&
		!value.includes('/.')
	);
}

export function hasControlCharacter(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) {
			return true;
		}
	}

	return false;
}
