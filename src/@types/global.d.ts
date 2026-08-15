export {};

declare global {
	const DEBUG: boolean;

	type PartialDeep<T> = T extends Record<string, unknown> ? { [K in keyof T]?: PartialDeep<T[K]> } : T;
	type Optional<T, K extends keyof T> = Omit<T, K> & { [P in K]?: T[P] };
	type PickPartialDeep<T, K extends keyof T> = Omit<Partial<T>, K> & { [P in K]?: Partial<T[P]> };

	type Mutable<T> = { -readonly [P in keyof T]: T[P] };
	type MutableDeep<T> = { -readonly [P in keyof T]: MutableDeep<T[P]> };
	type PickMutable<T, K extends keyof T> = Omit<T, K> & { -readonly [P in K]: T[P] };

	type EntriesType<T> = T extends Record<infer K, infer V> ? [K, V] : never;

	type ExcludeSome<T, K extends keyof T, R> = Omit<T, K> & { [P in K]-?: Exclude<T[P], R> };

	type ExtractAll<T, U> = { [K in keyof T]: T[K] extends U ? T[K] : never };
	type ExtractPrefixes<T extends string, SEP extends string> = T extends `${infer Prefix}${SEP}${infer Rest}`
		? Prefix | `${Prefix}${SEP}${ExtractPrefixes<Rest, SEP>}`
		: T;
	type ExtractSome<T, K extends keyof T, R> = Omit<T, K> & { [P in K]-?: Extract<T[P], R> };

	type NarrowRepo<T extends { repo?: unknown }> = ExcludeSome<T, 'repo', string | undefined>;
	type NarrowRepos<T extends { repos?: unknown }> = ExcludeSome<T, 'repos', string | string[] | undefined>;

	// Note this is more complex to deal with function overloads
	type OmitFirstArg<F> = F extends {
		(first: any, ...args: infer A1): infer R1;
		(first: any, ...args: infer A2): infer R2;
		(first: any, ...args: infer A3): infer R3;
		(first: any, ...args: infer A4): infer R4;
	}
		? ((...args: A1) => R1) & ((...args: A2) => R2) & ((...args: A3) => R3) & ((...args: A4) => R4)
		: F extends {
					(first: any, ...args: infer A1): infer R1;
					(first: any, ...args: infer A2): infer R2;
					(first: any, ...args: infer A3): infer R3;
			  }
			? ((...args: A1) => R1) & ((...args: A2) => R2) & ((...args: A3) => R3)
			: F extends {
						(first: any, ...args: infer A1): infer R1;
						(first: any, ...args: infer A2): infer R2;
				  }
				? ((...args: A1) => R1) & ((...args: A2) => R2)
				: F extends {
							(first: any, ...args: infer A1): infer R1;
					  }
					? (...args: A1) => R1
					: never;

	type RequireNonNullable<T> = { [P in keyof T]-?: NonNullable<T[P]> };
	type RequireSome<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: T[P] };
	type RequireSomeNonNullable<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
	type RequireSomeWithProps<T, K extends keyof T, Props extends keyof T[K]> = Omit<T, K> & {
		[P in K]-?: RequireSome<T[P], Props>;
	};

	type Replace<T, K extends keyof T, R> = Omit<T, K> & { [P in K]: R };

	type FilterByPrefix<
		P extends string,
		T extends string,
		S extends string = '',
	> = T extends `${P}${S}${string}` ? T : never;
	type StripPrefix<P extends string, T extends string, S extends string = ''> = T extends `${P}${S}${infer R}`
		? R
		: never;

	type UnwrapCustomEvent<T> = T extends { detail: infer U } ? U : never;

	type UnionKeys<T> = T extends T ? keyof T : never;
	type PartialUnionValues<T> = T extends T ? { [K in keyof T]: Partial<T[K]> } : never;
}
