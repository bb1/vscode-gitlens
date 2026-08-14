import type { HostingAccount, HostingRepositoryDescriptor } from '@gitlens/hosting-integrations/models.js';
import type {
	GitHubAnnotatedTag,
	GitHubBlob,
	GitHubBranch,
	GitHubCommit,
	GitHubComparison,
	GitHubContent,
	GitHubContentOptions,
	GitHubContributor,
	GitHubListCommitsOptions,
	GitHubListOptions,
	GitHubRef,
	GitHubTag,
	GitHubTree,
} from './gitDataModels.js';

export type GitHubRequest = {
	method: 'GET' | 'POST';
	url: string;
	headers: Readonly<Record<string, string>>;
	body?: string;
};

export type GitHubResponse = {
	status: number;
	body: unknown;
	headers?: Readonly<Record<string, string>>;
};

export type GitHubRequestTransport = (request: GitHubRequest) => Promise<GitHubResponse>;

export type GitHubRepositoryReference = HostingRepositoryDescriptor;

export type GitHubRepository = {
	id: string;
	owner: string;
	name: string;
	url: string;
	defaultBranch: string;
	isPrivate: boolean;
};

export type GitHubPage<T> = {
	values: readonly T[];
	nextPage: number | undefined;
};

export type GitHubPullRequest = {
	id: string;
	number: number;
	title: string;
	url: string;
	state: 'open' | 'closed' | 'merged';
};

export type CreateGitHubPullRequestInput = {
	base: string;
	head: string;
	title: string;
	body?: string;
};

const apiUrl = 'https://api.github.com';
const apiVersion = '2022-11-28';
const githubRequestErrorKind = 'gitlens.github-request-error';
const githubResponseTooLargeErrorKind = 'gitlens.github-response-too-large-error';
const maxPageSize = 100;
const maxListResults = 1000;
const maxTreeEntries = 100000;
const maxContentBytes = 1024 * 1024;
const maxComparisonFiles = 300;
const maxCommitFiles = 3000;
const defaultDomain = 'github.com';

export class GitHubRequestError extends Error {
	static is(error: unknown): error is GitHubRequestError {
		return (
			error instanceof GitHubRequestError ||
			(isRecord(error) &&
				error.kind === githubRequestErrorKind &&
				typeof error.status === 'number' &&
				Number.isFinite(error.status))
		);
	}

	constructor(readonly status: number) {
		super('GitHub request failed');
		Object.defineProperty(this, 'kind', { value: githubRequestErrorKind });
	}
}

export class GitHubResponseTooLargeError extends Error {
	static is(error: unknown): error is GitHubResponseTooLargeError {
		return (
			error instanceof GitHubResponseTooLargeError ||
			(isRecord(error) && error.kind === githubResponseTooLargeErrorKind)
		);
	}

	constructor() {
		super('GitHub response exceeded configured limit');
		Object.defineProperty(this, 'kind', { value: githubResponseTooLargeErrorKind });
	}
}

export class GitHubClient {
	private readonly domain: string | undefined;

	constructor(
		private readonly accessToken: string,
		private readonly request: GitHubRequestTransport,
		domain?: string,
	) {
		if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
			throw new Error('Invalid GitHub access token');
		}

		this.domain = domain == null ? undefined : normalizeDomain(domain);
	}

	async getRepository(repository: GitHubRepositoryReference): Promise<GitHubRepository> {
		const response = await this.send({
			method: 'GET',
			url: this.repositoryUrl(repository),
			headers: this.headers(),
		});

		return getRepository(response.body);
	}

	async getAccount(): Promise<HostingAccount> {
		const response = await this.send({
			method: 'GET',
			url: `${this.apiUrl(defaultDomain)}/user`,
			headers: this.headers(),
		});

		return getAccount(response.body);
	}

	async getDefaultBranch(repository: GitHubRepositoryReference): Promise<{ name: string }> {
		const metadata = await this.getRepository(repository);
		if (!isGitReference(metadata.defaultBranch)) {
			throw new Error('GitHub response was invalid');
		}

		return { name: metadata.defaultBranch };
	}

	async listBranches(
		repository: GitHubRepositoryReference,
		options?: GitHubListOptions,
	): Promise<readonly GitHubBranch[]> {
		return this.listPages(options?.limit, 'branch', (perPage, page) =>
			this.listBranchesPage(repository, { limit: perPage, page: page }).then(result => result.values),
		);
	}

	async listBranchesPage(
		repository: GitHubRepositoryReference,
		options: { limit: number; page: number },
	): Promise<GitHubPage<GitHubBranch>> {
		const { limit, page } = getPageOptions(options, 'branch');
		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/branches${getQuery({ per_page: limit, page: page })}`,
			headers: this.headers(),
		});
		const values = getBranches(response.body);
		return { values: values, nextPage: values.length === limit ? page + 1 : undefined };
	}

	async getBranch(repository: GitHubRepositoryReference, name: string): Promise<GitHubBranch> {
		if (!isGitReference(name)) {
			throw new Error('Invalid GitHub ref');
		}

		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/branches/${encodePathSegment(name)}`,
			headers: this.headers(),
		});

		return getBranch(response.body);
	}

	async listCommits(
		repository: GitHubRepositoryReference,
		options?: GitHubListCommitsOptions,
	): Promise<readonly GitHubCommit[]> {
		if (options?.ref != null && !isGitReference(options.ref)) {
			throw new Error('Invalid GitHub ref');
		}
		if (options?.path != null && !isGitContentPath(options.path)) {
			throw new Error('Invalid GitHub content path');
		}

		return this.listPages(options?.limit, 'commit', (perPage, page) =>
			this.listCommitsPage(repository, { ...options, limit: perPage, page: page }).then(result => result.values),
		);
	}

	async listCommitsPage(
		repository: GitHubRepositoryReference,
		options: GitHubListCommitsOptions & { limit: number; page: number },
	): Promise<GitHubPage<GitHubCommit>> {
		if (options.ref != null && !isGitReference(options.ref)) {
			throw new Error('Invalid GitHub ref');
		}
		if (options.path != null && !isGitContentPath(options.path)) {
			throw new Error('Invalid GitHub content path');
		}

		const { limit, page } = getPageOptions(options, 'commit');
		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/commits${getQuery({
				per_page: limit,
				page: page,
				sha: options.ref,
				path: options.path,
			})}`,
			headers: this.headers(),
		});
		const values = getCommits(response.body);
		return { values: values, nextPage: values.length === limit ? page + 1 : undefined };
	}

	async getCommit(repository: GitHubRepositoryReference, ref: string): Promise<GitHubCommit> {
		if (!isGitReference(ref)) {
			throw new Error('Invalid GitHub ref');
		}

		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/commits/${encodePathSegment(ref)}`,
			headers: this.headers(),
		});

		const commit = getCommit(response.body);
		if (commit.files == null) {
			throw new Error('GitHub response was invalid');
		}
		if (getNextPage(response) == null) return commit;

		const files = [...commit.files];
		let next = this.getNextCommitFilesPage(repository, response);
		while (next != null) {
			const page = await this.send({ method: 'GET', url: next, headers: this.headers() });
			const pageCommit = getCommit(page.body);
			if (
				pageCommit.sha !== commit.sha ||
				pageCommit.files == null ||
				files.length + pageCommit.files.length > maxCommitFiles
			) {
				throw new GitHubResponseTooLargeError();
			}

			files.push(...pageCommit.files);
			next = this.getNextCommitFilesPage(repository, page);
		}

		return { ...commit, files: files };
	}

	async compareCommits(repository: GitHubRepositoryReference, base: string, head: string): Promise<GitHubComparison> {
		if (!isGitReference(base) || !isGitReference(head)) {
			throw new Error('Invalid GitHub ref');
		}

		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/compare/${encodePathSegment(base)}...${encodePathSegment(head)}`,
			headers: this.headers(),
		});

		return getComparison(response.body);
	}

	async listRefs(repository: GitHubRepositoryReference, options?: GitHubListOptions): Promise<readonly GitHubRef[]> {
		return this.listPages(options?.limit, 'ref', (perPage, page) =>
			this.listRefsPage(repository, { limit: perPage, page: page }).then(result => result.values),
		);
	}

	async listRefsPage(
		repository: GitHubRepositoryReference,
		options: { limit: number; page: number },
	): Promise<GitHubPage<GitHubRef>> {
		const { limit, page } = getPageOptions(options, 'ref');
		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/git/matching-refs/${getQuery({ per_page: limit, page: page })}`,
			headers: this.headers(),
		});
		const values = getRefs(response.body);
		return { values: values, nextPage: values.length === limit ? page + 1 : undefined };
	}

	async getRef(repository: GitHubRepositoryReference, name: string): Promise<GitHubRef | undefined> {
		if (!isGitReference(name)) {
			throw new Error('Invalid GitHub ref');
		}

		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/git/matching-refs/${encodeGitContentPath(name)}`,
			headers: this.headers(),
		});
		return getRefs(response.body).find(ref => ref.name === name);
	}

	async listTags(repository: GitHubRepositoryReference, options?: GitHubListOptions): Promise<readonly GitHubTag[]> {
		return this.listPages(options?.limit, 'tag', (perPage, page) =>
			this.listTagsPage(repository, { limit: perPage, page: page }).then(result => result.values),
		);
	}

	async listTagsPage(
		repository: GitHubRepositoryReference,
		options: { limit: number; page: number },
	): Promise<GitHubPage<GitHubTag>> {
		const { limit, page } = getPageOptions(options, 'tag');
		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/tags${getQuery({ per_page: limit, page: page })}`,
			headers: this.headers(),
		});
		const values = getTags(response.body);
		return { values: values, nextPage: values.length === limit ? page + 1 : undefined };
	}

	async getAnnotatedTag(repository: GitHubRepositoryReference, sha: string): Promise<GitHubAnnotatedTag> {
		if (!isGitObjectId(sha)) {
			throw new Error('Invalid GitHub object id');
		}

		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/git/tags/${encodePathSegment(sha)}`,
			headers: this.headers(),
		});

		return getAnnotatedTag(response.body);
	}

	async getTree(repository: GitHubRepositoryReference, ref: string): Promise<GitHubTree> {
		if (!isGitReference(ref)) {
			throw new Error('Invalid GitHub ref');
		}

		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/git/trees/${encodePathSegment(ref)}?recursive=1`,
			headers: this.headers(),
		});

		return getTree(response.body);
	}

	async getBlob(repository: GitHubRepositoryReference, sha: string): Promise<GitHubBlob> {
		if (!isGitObjectId(sha)) {
			throw new Error('Invalid GitHub object id');
		}

		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/git/blobs/${encodePathSegment(sha)}`,
			headers: this.headers(),
		});

		return getBlob(response.body);
	}

	async getContent(
		repository: GitHubRepositoryReference,
		path: string,
		options?: GitHubContentOptions,
	): Promise<GitHubContent> {
		if (!isGitContentPath(path)) {
			throw new Error('Invalid GitHub content path');
		}
		if (options?.ref != null && !isGitReference(options.ref)) {
			throw new Error('Invalid GitHub ref');
		}

		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/contents/${encodeGitContentPath(path)}${getQuery({ ref: options?.ref })}`,
			headers: this.headers(),
		});

		return getContent(response.body);
	}

	async listContributors(
		repository: GitHubRepositoryReference,
		options?: GitHubListOptions,
	): Promise<readonly GitHubContributor[]> {
		return this.listPages(options?.limit, 'contributor', (perPage, page) =>
			this.listContributorsPage(repository, { limit: perPage, page: page }).then(result => result.values),
		);
	}

	async listContributorsPage(
		repository: GitHubRepositoryReference,
		options: { limit: number; page: number },
	): Promise<GitHubPage<GitHubContributor>> {
		const { limit, page } = getPageOptions(options, 'contributor');
		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/contributors${getQuery({ per_page: limit, page: page })}`,
			headers: this.headers(),
		});
		const values = getContributors(response.body);
		return { values: values, nextPage: values.length === limit ? page + 1 : undefined };
	}

	async getPullRequests(repository: GitHubRepositoryReference, perPage = 100): Promise<readonly GitHubPullRequest[]> {
		if (!Number.isSafeInteger(perPage) || perPage < 1) {
			throw new Error('Invalid GitHub pull request page size');
		}

		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/pulls?state=open&per_page=${Math.min(perPage, 100)}`,
			headers: this.headers(),
		});

		return getPullRequests(response.body);
	}

	async getPullRequestForCommit(
		repository: GitHubRepositoryReference,
		commit: string,
	): Promise<GitHubPullRequest | undefined> {
		if (!isGitReference(commit)) {
			throw new Error('Invalid GitHub commit');
		}

		const response = await this.send({
			method: 'GET',
			url: `${this.repositoryUrl(repository)}/commits/${encodeURIComponent(commit)}/pulls`,
			headers: this.headers(),
		});

		return getPullRequests(response.body)[0];
	}

	async createPullRequest(
		repository: GitHubRepositoryReference,
		input: CreateGitHubPullRequestInput,
	): Promise<GitHubPullRequest> {
		const body = validatePullRequestInput(input);
		const response = await this.send({
			method: 'POST',
			url: `${this.repositoryUrl(repository)}/pulls`,
			headers: { ...this.headers(), 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		return getPullRequest(response.body);
	}

	private headers(): Readonly<Record<string, string>> {
		return {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${this.accessToken}`,
			'X-GitHub-Api-Version': apiVersion,
		};
	}

	private repositoryUrl(repository: GitHubRepositoryReference): string {
		validateRepository(repository);

		const domain = normalizeDomain(repository.domain);
		if (this.domain != null && domain !== this.domain) {
			throw new Error('Invalid GitHub repository domain');
		}

		return `${this.apiUrl(domain)}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
	}

	private apiUrl(domain: string): string {
		return getApiUrl(this.domain ?? domain);
	}

	private getNextCommitFilesPage(
		repository: GitHubRepositoryReference,
		response: GitHubResponse,
	): string | undefined {
		const next = getNextPage(response);
		if (next == null) return undefined;

		const expected = new URL(`${this.repositoryUrl(repository)}/commits/`);
		const target = new URL(next);
		if (target.origin !== expected.origin || !target.pathname.startsWith(expected.pathname)) {
			throw new Error('Invalid GitHub pagination link');
		}

		return target.toString();
	}

	private async listPages<T>(
		limit: number | undefined,
		label: string,
		getPage: (perPage: number, page: number) => Promise<readonly T[]>,
	): Promise<readonly T[]> {
		const resultLimit = getResultLimit(limit, label);
		const values: T[] = [];
		let page = 1;
		while (values.length < resultLimit) {
			const perPage = Math.min(maxPageSize, resultLimit - values.length);
			const valuesPage = await getPage(perPage, page);
			if (valuesPage.length > perPage) {
				throw new Error('GitHub response was invalid');
			}

			values.push(...valuesPage);
			if (valuesPage.length < perPage) {
				break;
			}

			page++;
		}

		return values;
	}

	private async send(request: GitHubRequest): Promise<GitHubResponse> {
		const response = await this.request(request).then(
			response => response,
			() => undefined,
		);
		if (response == null) {
			throw new Error('GitHub request failed', { cause: new Error('GitHub transport failed') });
		}

		if (response.status < 200 || response.status >= 300) {
			throw new GitHubRequestError(response.status);
		}

		return response;
	}
}

function getApiUrl(domain: string): string {
	const normalizedDomain = normalizeDomain(domain);
	return normalizedDomain === 'github.com' ? apiUrl : `https://${normalizedDomain}/api/v3`;
}

function normalizeDomain(domain: string): string {
	if (typeof domain !== 'string' || domain !== domain.trim()) {
		throw new Error('Invalid GitHub domain');
	}

	const normalizedDomain = domain.toLowerCase();
	if (
		!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
			normalizedDomain,
		)
	) {
		throw new Error('Invalid GitHub domain');
	}

	try {
		if (new URL(`https://${domain}`).hostname !== normalizedDomain) {
			throw new Error('Invalid GitHub domain');
		}
	} catch {
		throw new Error('Invalid GitHub domain');
	}

	return normalizedDomain;
}

function validateRepository(repository: GitHubRepositoryReference): void {
	if (!isGitHubOwner(repository.owner)) {
		throw new Error('Invalid GitHub repository owner');
	}

	if (!isGitHubRepositoryName(repository.name)) {
		throw new Error('Invalid GitHub repository name');
	}
}

function validatePullRequestInput(input: CreateGitHubPullRequestInput): CreateGitHubPullRequestInput {
	if (!isGitReference(input.base)) {
		throw new Error('Invalid GitHub base branch');
	}

	if (!isGitHubHead(input.head)) {
		throw new Error('Invalid GitHub head branch');
	}

	if (input.title.length === 0 || hasControlCharacter(input.title)) {
		throw new Error('Invalid GitHub pull request title');
	}

	if (input.body?.includes('\0') === true) {
		throw new Error('Invalid GitHub pull request body');
	}

	return input;
}

function isGitHubOwner(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value) && !value.endsWith('-');
}

function isGitHubRepositoryName(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) && !value.endsWith('.');
}

function isGitHubHead(value: string): boolean {
	const separator = value.indexOf(':');
	if (separator < 0) {
		return isGitReference(value);
	}

	return (
		separator === value.lastIndexOf(':') &&
		isGitHubOwner(value.slice(0, separator)) &&
		isGitReference(value.slice(separator + 1))
	);
}

function isGitReference(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
		!value.endsWith('.') &&
		!value.endsWith('.lock') &&
		!value.endsWith('/') &&
		!value.includes('..') &&
		!value.includes('//') &&
		!value.includes('/.')
	);
}

function isGitContentPath(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		!value.startsWith('/') &&
		!value.endsWith('/') &&
		!value.includes('\\') &&
		!hasControlCharacter(value) &&
		value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
	);
}

function isGitObjectId(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(value);
}

function encodePathSegment(value: string): string {
	return encodeURIComponent(value);
}

function encodeGitContentPath(path: string): string {
	return path.split('/').map(encodePathSegment).join('/');
}

function getQuery(values: Readonly<Record<string, string | number | undefined>>): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(values)) {
		if (value != null) {
			parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
		}
	}

	return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

function getResultLimit(limit: number | undefined, label: string): number {
	if (limit == null) {
		return maxListResults;
	}
	if (!Number.isSafeInteger(limit) || limit < 1) {
		throw new Error(`Invalid GitHub ${label} result limit`);
	}

	return Math.min(limit, maxListResults);
}

function getPageOptions(options: { limit: number; page: number }, label: string): { limit: number; page: number } {
	if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > maxPageSize) {
		throw new Error(`Invalid GitHub ${label} result limit`);
	}
	if (!Number.isSafeInteger(options.page) || options.page < 1) {
		throw new Error(`Invalid GitHub ${label} page`);
	}

	return options;
}

function hasControlCharacter(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) {
			return true;
		}
	}

	return false;
}

function getBranches(value: unknown): readonly GitHubBranch[] {
	if (!Array.isArray(value)) {
		throw new Error('GitHub response was invalid');
	}

	return value.map(getBranch);
}

function getBranch(value: unknown): GitHubBranch {
	if (!isRecord(value) || !isRecord(value.commit)) {
		throw new Error('GitHub response was invalid');
	}
	if (typeof value.name !== 'string' || !isGitReference(value.name) || !isGitObjectId(value.commit.sha)) {
		throw new Error('GitHub response was invalid');
	}
	if (typeof value.protected !== 'boolean') {
		throw new Error('GitHub response was invalid');
	}

	return { name: value.name, sha: value.commit.sha, isProtected: value.protected };
}

function getCommits(value: unknown): readonly GitHubCommit[] {
	if (!Array.isArray(value)) {
		throw new Error('GitHub response was invalid');
	}

	return value.map(getCommit);
}

function getCommit(value: unknown): GitHubCommit {
	if (!isRecord(value) || !isRecord(value.commit) || !Array.isArray(value.parents)) {
		throw new Error('GitHub response was invalid');
	}
	if (typeof value.sha !== 'string' || !isGitObjectId(value.sha) || typeof value.html_url !== 'string') {
		throw new Error('GitHub response was invalid');
	}
	if (typeof value.commit.message !== 'string') {
		throw new Error('GitHub response was invalid');
	}

	const author = getCommitSignature(value.commit.author);
	const committer = getCommitSignature(value.commit.committer);
	const parents = value.parents.map(getCommitParent);
	const stats = value.stats == null ? undefined : getCommitStats(value.stats);
	const files = value.files == null ? undefined : getCommitFiles(value.files);
	return {
		sha: value.sha,
		url: value.html_url,
		message: value.commit.message,
		author: author,
		committer: committer,
		parents: parents,
		additions: stats?.additions,
		deletions: stats?.deletions,
		changes: stats?.changes,
		files: files,
	};
}

function getCommitSignature(value: unknown): { name: string; email: string; date: string } {
	if (
		!isRecord(value) ||
		typeof value.name !== 'string' ||
		typeof value.email !== 'string' ||
		typeof value.date !== 'string'
	) {
		throw new Error('GitHub response was invalid');
	}

	return { name: value.name, email: value.email, date: value.date };
}

function getCommitParent(value: unknown): string {
	if (!isRecord(value) || !isGitObjectId(value.sha)) {
		throw new Error('GitHub response was invalid');
	}

	return value.sha;
}

function getCommitStats(value: unknown): { additions: number; deletions: number; changes: number } {
	if (!isRecord(value)) {
		throw new Error('GitHub response was invalid');
	}
	if (!isCount(value.additions) || !isCount(value.deletions) || !isCount(value.total)) {
		throw new Error('GitHub response was invalid');
	}

	return { additions: value.additions, deletions: value.deletions, changes: value.total };
}

function getCommitFiles(value: unknown): NonNullable<GitHubCommit['files']> {
	if (!Array.isArray(value)) {
		throw new Error('GitHub response was invalid');
	}

	return value.map(getCommitFile);
}

function getCommitFile(value: unknown): NonNullable<GitHubCommit['files']>[number] {
	if (!isRecord(value) || typeof value.filename !== 'string' || !isGitContentPath(value.filename)) {
		throw new Error('GitHub response was invalid');
	}
	if (
		!isCommitFileStatus(value.status) ||
		!isCount(value.additions) ||
		!isCount(value.deletions) ||
		!isCount(value.changes)
	) {
		throw new Error('GitHub response was invalid');
	}
	if (
		value.previous_filename != null &&
		(typeof value.previous_filename !== 'string' || !isGitContentPath(value.previous_filename))
	) {
		throw new Error('GitHub response was invalid');
	}
	if (value.patch != null && typeof value.patch !== 'string') {
		throw new Error('GitHub response was invalid');
	}

	return {
		path: value.filename,
		...(value.previous_filename == null ? undefined : { previousPath: value.previous_filename }),
		status: value.status,
		additions: value.additions,
		deletions: value.deletions,
		changes: value.changes,
		...(value.patch == null ? undefined : { patch: value.patch }),
	};
}

function isCommitFileStatus(value: unknown): value is NonNullable<GitHubCommit['files']>[number]['status'] {
	return (
		value === 'added' ||
		value === 'changed' ||
		value === 'copied' ||
		value === 'modified' ||
		value === 'removed' ||
		value === 'renamed' ||
		value === 'unchanged'
	);
}

function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function getComparison(value: unknown): GitHubComparison {
	if (!isRecord(value) || !isComparisonStatus(value.status)) {
		throw new Error('GitHub response was invalid');
	}
	if (
		!isCount(value.ahead_by) ||
		!isCount(value.behind_by) ||
		!isCount(value.total_commits) ||
		!Array.isArray(value.commits)
	) {
		throw new Error('GitHub response was invalid');
	}
	if (
		value.merge_base_commit != null &&
		(!isRecord(value.merge_base_commit) || !isGitObjectId(value.merge_base_commit.sha))
	) {
		throw new Error('GitHub response was invalid');
	}

	const mergeBaseSha =
		value.merge_base_commit != null &&
		isRecord(value.merge_base_commit) &&
		isGitObjectId(value.merge_base_commit.sha)
			? value.merge_base_commit.sha
			: undefined;

	if (value.files == null) {
		throw new Error('GitHub response was invalid');
	}

	const files = getCommitFiles(value.files);
	if (files.length >= maxComparisonFiles) {
		throw new GitHubResponseTooLargeError();
	}
	if (value.commits.length !== value.total_commits) {
		throw new GitHubResponseTooLargeError();
	}

	return {
		status: value.status,
		aheadBy: value.ahead_by,
		behindBy: value.behind_by,
		totalCommits: value.total_commits,
		...(mergeBaseSha == null ? undefined : { mergeBaseSha: mergeBaseSha }),
		commits: value.commits.map(getCommit),
		files: files,
	};
}

function getAnnotatedTag(value: unknown): GitHubAnnotatedTag {
	if (!isRecord(value) || !isRecord(value.object)) {
		throw new Error('GitHub response was invalid');
	}
	if (
		typeof value.tag !== 'string' ||
		!isGitReference(value.tag) ||
		!isGitObjectId(value.sha) ||
		!isGitObjectId(value.object.sha) ||
		value.object.type !== 'commit' ||
		typeof value.message !== 'string'
	) {
		throw new Error('GitHub response was invalid');
	}

	return {
		name: value.tag,
		sha: value.sha,
		message: value.message,
		tagger: getCommitSignature(value.tagger),
		targetSha: value.object.sha,
	};
}

function isComparisonStatus(value: unknown): value is GitHubComparison['status'] {
	return value === 'ahead' || value === 'behind' || value === 'diverged' || value === 'identical';
}

function getRefs(value: unknown): readonly GitHubRef[] {
	if (!Array.isArray(value)) {
		throw new Error('GitHub response was invalid');
	}

	return value.map(getRef);
}

function getRef(value: unknown): GitHubRef {
	if (
		!isRecord(value) ||
		!isRecord(value.object) ||
		typeof value.ref !== 'string' ||
		!value.ref.startsWith('refs/')
	) {
		throw new Error('GitHub response was invalid');
	}

	const name = value.ref.slice('refs/'.length);
	if (!isGitReference(name) || !isGitObjectId(value.object.sha) || !isGitObjectType(value.object.type)) {
		throw new Error('GitHub response was invalid');
	}

	return { name: name, sha: value.object.sha, type: value.object.type };
}

function isGitObjectType(value: unknown): value is GitHubRef['type'] {
	return value === 'blob' || value === 'commit' || value === 'tag' || value === 'tree';
}

function getTags(value: unknown): readonly GitHubTag[] {
	if (!Array.isArray(value)) {
		throw new Error('GitHub response was invalid');
	}

	return value.map(getTag);
}

function getTag(value: unknown): GitHubTag {
	if (!isRecord(value) || !isRecord(value.commit) || typeof value.name !== 'string' || !isGitReference(value.name)) {
		throw new Error('GitHub response was invalid');
	}
	if (!isGitObjectId(value.commit.sha)) {
		throw new Error('GitHub response was invalid');
	}

	return { name: value.name, sha: value.commit.sha };
}

function getTree(value: unknown): GitHubTree {
	if (
		!isRecord(value) ||
		!isGitObjectId(value.sha) ||
		typeof value.truncated !== 'boolean' ||
		!Array.isArray(value.tree)
	) {
		throw new Error('GitHub response was invalid');
	}

	if (value.truncated || value.tree.length > maxTreeEntries) {
		throw new GitHubResponseTooLargeError();
	}

	return { sha: value.sha, entries: value.tree.map(getTreeEntry) };
}

function getTreeEntry(value: unknown): GitHubTree['entries'][number] {
	if (!isRecord(value) || typeof value.path !== 'string' || !isGitContentPath(value.path)) {
		throw new Error('GitHub response was invalid');
	}
	if (
		typeof value.mode !== 'string' ||
		!/^[0-7]{6}$/.test(value.mode) ||
		!isGitTreeEntryType(value.type) ||
		!isGitObjectId(value.sha)
	) {
		throw new Error('GitHub response was invalid');
	}

	const size = value.size ?? undefined;
	if (size != null && !isCount(size)) {
		throw new Error('GitHub response was invalid');
	}

	return {
		path: value.path,
		mode: value.mode,
		type: value.type,
		sha: value.sha,
		...(size == null ? undefined : { size: size }),
	};
}

function isGitTreeEntryType(value: unknown): value is GitHubTree['entries'][number]['type'] {
	return value === 'blob' || value === 'commit' || value === 'tree';
}

function getBlob(value: unknown): GitHubBlob {
	if (!isRecord(value) || !isGitObjectId(value.sha)) {
		throw new Error('GitHub response was invalid');
	}

	return { sha: value.sha, bytes: getEncodedContent(value) };
}

function getContent(value: unknown): GitHubContent {
	if (!isRecord(value) || value.type !== 'file' || typeof value.path !== 'string' || !isGitContentPath(value.path)) {
		throw new Error('GitHub response was invalid');
	}
	if (!isGitObjectId(value.sha)) {
		throw new Error('GitHub response was invalid');
	}

	return { path: value.path, sha: value.sha, bytes: getEncodedContent(value) };
}

function getEncodedContent(value: Record<string, unknown>): Uint8Array {
	if (!isCount(value.size) || value.size > maxContentBytes) {
		throw new GitHubResponseTooLargeError();
	}
	if (value.encoding !== 'base64' || typeof value.content !== 'string') {
		throw new Error('GitHub response was invalid');
	}

	const content = value.content.replace(/[\r\n]/g, '');
	if (!isBase64(content)) {
		throw new Error('GitHub response was invalid');
	}

	try {
		const decoded = atob(content);
		const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
		if (bytes.byteLength !== value.size || bytes.byteLength > maxContentBytes) {
			throw new Error('GitHub response was invalid');
		}

		return bytes;
	} catch {
		throw new Error('GitHub response was invalid');
	}
}

function isBase64(value: string): boolean {
	return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function getContributors(value: unknown): readonly GitHubContributor[] {
	if (!Array.isArray(value)) {
		throw new Error('GitHub response was invalid');
	}

	return value.map(getContributor);
}

function getContributor(value: unknown): GitHubContributor {
	if (!isRecord(value) || !isCount(value.contributions)) {
		throw new Error('GitHub response was invalid');
	}
	if (value.login != null && typeof value.login !== 'string') {
		throw new Error('GitHub response was invalid');
	}
	if (value.avatar_url != null && typeof value.avatar_url !== 'string') {
		throw new Error('GitHub response was invalid');
	}
	if (value.html_url != null && typeof value.html_url !== 'string') {
		throw new Error('GitHub response was invalid');
	}

	return {
		login: value.login ?? undefined,
		avatarUrl: value.avatar_url ?? undefined,
		url: value.html_url ?? undefined,
		contributions: value.contributions,
	};
}

function getRepository(value: unknown): GitHubRepository {
	if (!isRecord(value) || !isRecord(value.owner)) {
		throw new Error('GitHub response was invalid');
	}

	if (
		typeof value.id !== 'number' ||
		typeof value.owner.login !== 'string' ||
		typeof value.name !== 'string' ||
		typeof value.html_url !== 'string' ||
		typeof value.default_branch !== 'string' ||
		typeof value.private !== 'boolean'
	) {
		throw new Error('GitHub response was invalid');
	}

	return {
		id: String(value.id),
		owner: value.owner.login,
		name: value.name,
		url: value.html_url,
		defaultBranch: value.default_branch,
		isPrivate: value.private,
	};
}

function getAccount(value: unknown): HostingAccount {
	if (!isRecord(value)) {
		throw new Error('GitHub response was invalid');
	}

	const avatarUrl = getSafeUrl(value.avatar_url);
	if (typeof value.id !== 'number' || typeof value.login !== 'string' || value.login.length === 0) {
		throw new Error('GitHub response was invalid');
	}

	return { id: String(value.id), label: value.login, ...(avatarUrl == null ? {} : { avatarUrl: avatarUrl }) };
}

function getPullRequests(value: unknown): readonly GitHubPullRequest[] {
	if (!Array.isArray(value)) {
		throw new Error('GitHub response was invalid');
	}

	return value.map(getPullRequest);
}

function getPullRequest(value: unknown): GitHubPullRequest {
	if (!isRecord(value)) {
		throw new Error('GitHub response was invalid');
	}

	if (
		typeof value.id !== 'number' ||
		typeof value.number !== 'number' ||
		typeof value.title !== 'string' ||
		typeof value.html_url !== 'string' ||
		(value.state !== 'open' && value.state !== 'closed') ||
		(value.merged_at != null && typeof value.merged_at !== 'string')
	) {
		throw new Error('GitHub response was invalid');
	}

	return {
		id: String(value.id),
		number: value.number,
		title: value.title,
		url: value.html_url,
		state: value.merged_at == null ? value.state : 'merged',
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value != null;
}

function getSafeUrl(value: unknown): string | undefined {
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

function getNextPage(response: GitHubResponse): string | undefined {
	const link = response.headers?.link;
	if (link == null) return undefined;

	for (const value of link.split(',')) {
		const match = /<([^>]+)>;\s*rel="next"/.exec(value);
		if (match != null) return match[1];
	}

	return undefined;
}
