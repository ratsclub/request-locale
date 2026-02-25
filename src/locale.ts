/**
 * Minimal locale shape. Structurally compatible with Hydrogen's I18nLocale.
 */
export interface Locale {
	language: string;
	country: string;
	[key: string]: unknown;
}

/**
 * Context passed to every strategy and predicate.
 * The URL is parsed once and shared across all callbacks.
 */
export interface RequestContext {
	request: Request;
	url: URL;
}

/**
 * A strategy function that attempts to resolve a locale from the request.
 * Return a Locale if resolved, or null/undefined to fall through.
 */
export type LocaleStrategy = (
	ctx: RequestContext,
) => Locale | null | undefined | Promise<Locale | null | undefined>;

export type RequestPredicate = (
	ctx: RequestContext,
) => boolean | Promise<boolean>;

export type GetLocaleFromRequestOptions = {
	/**
	 * Ordered list of strategies. The first one to return a non-null
	 * locale wins. Strategies are evaluated in array order (index 0 = highest priority).
	 */
	strategies: LocaleStrategy[];
	/**
	 * Fallback locale returned when no strategy resolves.
	 */
	defaultLocale: Locale;
};

/**
 * Resolves a locale from the request by evaluating strategies in priority order.
 *
 * @example
 * const locales = {
 *   fr: {language: 'FR', country: 'FR'},
 *   de: {language: 'DE', country: 'DE'},
 * };
 *
 * getLocaleFromRequest({
 *   strategies: [
 *     fromCookie('locale', locales),
 *     fromSubdomain(locales),
 *     fromAcceptLanguageHeader(locales),
 *   ],
 *   defaultLocale: {language: 'EN', country: 'US'},
 * });
 */
export function getLocaleFromRequest(options: GetLocaleFromRequestOptions) {
	const { strategies, defaultLocale } = options;

	return async (request: Request): Promise<Locale> => {
		const ctx: RequestContext = { request, url: new URL(request.url) };
		for (const strategy of strategies) {
			const result = await strategy(ctx);
			if (result) return result;
		}
		return defaultLocale;
	};
}

/**
 * Normalizes map keys to lowercase so lookups are case-insensitive.
 * Allows maps like `{'en-US': locale, 'fr-CA': locale}` to work
 * regardless of how the input is cased.
 */
function normalizeKeys(map: Record<string, Locale>): Record<string, Locale> {
	const normalized: Record<string, Locale> = {};
	for (const key of Object.keys(map)) {
		normalized[key.toLowerCase()] = map[key];
	}
	return normalized;
}

/**
 * Resolves locale from a subdomain.
 *
 * @example
 * // fr.my-store.com → FR
 * // de.my-store.com → DE
 * getLocaleFromRequest({
 *   strategies: [fromSubdomain({fr: FR, de: DE})],
 *   defaultLocale: US,
 * });
 */
export function fromSubdomain(
	subdomainMap: Record<string, Locale>,
): LocaleStrategy {
	const map = normalizeKeys(subdomainMap);
	return ({ url }) => {
		const parts = url.hostname.split(".");
		if (parts.length < 2) return null;
		return map[parts[0].toLowerCase()] ?? null;
	};
}

/**
 * Resolves locale from the domain TLD / suffix.
 * Supports multi-part TLDs like `co.uk` or `com.br`.
 * Keys are matched longest-first so `co.uk` takes priority over `uk`.
 *
 * @example
 * // my-store.fr     → FR
 * // my-store.co.uk  → GB
 * // my-store.com.br → BR
 * getLocaleFromRequest({
 *   strategies: [fromDomainTLD({fr: FR, 'co.uk': GB, 'com.br': BR})],
 *   defaultLocale: US,
 * });
 */
export function fromDomainTLD(tldMap: Record<string, Locale>): LocaleStrategy {
	const map = normalizeKeys(tldMap);
	const sorted = Object.keys(map).sort((a, b) => b.length - a.length);

	return ({ url }) => {
		const host = url.hostname.toLowerCase();
		for (const tld of sorted) {
			if (host === tld || host.endsWith(`.${tld}`)) {
				return map[tld];
			}
		}
		return null;
	};
}

/**
 * Resolves locale from a specific cookie value.
 * The cookie value should match a key in the provided map.
 *
 * @example
 * // Cookie: locale=fr → FR
 * // Cookie: locale=de → DE
 * getLocaleFromRequest({
 *   strategies: [fromCookie('locale', {fr: FR, de: DE})],
 *   defaultLocale: US,
 * });
 */
export function fromCookie(
	cookieName: string,
	valueMap: Record<string, Locale>,
): LocaleStrategy {
	const map = normalizeKeys(valueMap);
	return ({ request }) => {
		const cookies = request.headers.get("Cookie") ?? "";
		const match = cookies.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
		const value = match?.[1]?.trim().toLowerCase();
		return value ? (map[value] ?? null) : null;
	};
}

/**
 * Resolves locale from the `Accept-Language` header.
 * Picks the first accepted language that exists in `supportedLocales`.
 *
 * @example
 * // Accept-Language: fr-CA;q=0.9, de;q=0.8 → FR (prefix match)
 * // Accept-Language: de;q=1                 → DE
 * getLocaleFromRequest({
 *   strategies: [fromAcceptLanguageHeader({fr: FR, de: DE})],
 *   defaultLocale: US,
 * });
 */
export function fromAcceptLanguageHeader(
	supportedLocales: Record<string, Locale>,
): LocaleStrategy {
	const map = normalizeKeys(supportedLocales);
	return ({ request }) => {
		const header = request.headers.get("Accept-Language");
		if (!header) return null;

		const languages = header
			.split(",")
			.map((part) => {
				const [lang, q] = part.trim().split(";q=");
				return { lang: lang.trim().toLowerCase(), q: q ? parseFloat(q) : 1 };
			})
			.sort((a, b) => b.q - a.q);

		for (const { lang } of languages) {
			if (map[lang]) return map[lang];
			const prefix = lang.split("-")[0];
			if (map[prefix]) return map[prefix];
		}
		return null;
	};
}

/**
 * Resolves locale from a custom request header.
 *
 * @example
 * // X-Storefront-Locale: fr → FR
 * getLocaleFromRequest({
 *   strategies: [fromHeader('x-storefront-locale', {fr: FR, de: DE})],
 *   defaultLocale: US,
 * });
 */
export function fromHeader(
	headerName: string,
	valueMap: Record<string, Locale>,
): LocaleStrategy {
	const map = normalizeKeys(valueMap);
	return ({ request }) => {
		const value = request.headers.get(headerName)?.trim().toLowerCase();
		return value ? (map[value] ?? null) : null;
	};
}

/**
 * Resolves locale from a URL path prefix.
 *
 * @example
 * // /fr/products/hat → FR
 * // /de/collections  → DE
 * getLocaleFromRequest({
 *   strategies: [fromPathPrefix({fr: FR, de: DE})],
 *   defaultLocale: US,
 * });
 */
export function fromPathPrefix(
	prefixMap: Record<string, Locale>,
): LocaleStrategy {
	const map = normalizeKeys(prefixMap);
	return ({ url }) => {
		const prefix = url.pathname.split("/")[1].toLowerCase();
		return map[prefix] ?? null;
	};
}

/**
 * Resolves locale from a URL query parameter.
 *
 * @example
 * // ?locale=fr → FR
 * // ?locale=de → DE
 * getLocaleFromRequest({
 *   strategies: [fromQueryParam('locale', {fr: FR, de: DE})],
 *   defaultLocale: US,
 * });
 */
export function fromQueryParam(
	paramName: string,
	valueMap: Record<string, Locale>,
): LocaleStrategy {
	const map = normalizeKeys(valueMap);
	return ({ url }) => {
		const value = url.searchParams.get(paramName)?.toLowerCase();
		return value ? (map[value] ?? null) : null;
	};
}

/**
 * Guards a strategy so it only runs when the predicate returns true.
 * When the predicate is false, the strategy is skipped (returns null).
 *
 * @example
 * // On localhost: /fr/products → FR (path prefix used)
 * // In production: /fr/products → US (path prefix skipped)
 * getLocaleFromRequest({
 *   strategies: [when(isLocal, fromPathPrefix({fr: FR, de: DE}))],
 *   defaultLocale: US,
 * });
 */
export function when(
	predicate: RequestPredicate,
	strategy: LocaleStrategy,
): LocaleStrategy {
	return async (ctx) => {
		if (await predicate(ctx)) return strategy(ctx);
		return null;
	};
}

/**
 * Inverse of `when` — runs the strategy when the predicate is false.
 *
 * @example
 * // On localhost: fr.my-store.com → US (subdomain ignored)
 * // In production: fr.my-store.com → FR (subdomain used)
 * getLocaleFromRequest({
 *   strategies: [whenNot(isLocal, fromSubdomain({fr: FR, de: DE}))],
 *   defaultLocale: US,
 * });
 */
export function whenNot(
	predicate: RequestPredicate,
	strategy: LocaleStrategy,
): LocaleStrategy {
	return when(async (ctx) => !(await predicate(ctx)), strategy);
}

/**
 * Matches localhost, 127.0.0.1, and [::1].
 *
 * @example
 * getLocaleFromRequest({
 *   strategies: [
 *     when(isLocal, fromPathPrefix({fr: FR, de: DE})),
 *     whenNot(isLocal, fromSubdomain({fr: FR, de: DE})),
 *   ],
 *   defaultLocale: US,
 * });
 */
export const isLocal: RequestPredicate = ({ url }) => {
	const host = url.hostname;
	return (
		host === "localhost" ||
		host === "127.0.0.1" ||
		host === "[::1]" ||
		host.endsWith(".localhost")
	);
};

/**
 * Matches common preview/staging URL patterns (customize as needed).
 *
 * @example
 * // abc123.oxygen.run/fr/products → FR
 * // my-store.vercel.app/de/products → DE
 * getLocaleFromRequest({
 *   strategies: [when(isPreviewDomain(), fromPathPrefix({fr: FR, de: DE}))],
 *   defaultLocale: US,
 * });
 *
 * @example
 * // Custom patterns
 * getLocaleFromRequest({
 *   strategies: [
 *     when(
 *       isPreviewDomain([/^staging\./, /\.preview\.my-store\.com$/]),
 *       fromPathPrefix({fr: FR, de: DE}),
 *     ),
 *   ],
 *   defaultLocale: US,
 * });
 */
export function isPreviewDomain(
	patterns: (string | RegExp)[] = [/\.trycloudflare\.com$/, /\.ngrok\.app$/],
): RequestPredicate {
	return ({ url }) => {
		const host = url.hostname;
		return patterns.some((p) =>
			typeof p === "string" ? host.includes(p) : p.test(host),
		);
	};
}

/**
 * Combines multiple predicates with OR logic.
 *
 * @example
 * // Path prefix on localhost OR preview URLs, subdomain otherwise
 * const isDev = anyOf(isLocal, isPreviewDomain());
 *
 * getLocaleFromRequest({
 *   strategies: [
 *     when(isDev, fromPathPrefix({fr: FR, de: DE})),
 *     whenNot(isDev, fromSubdomain({fr: FR, de: DE})),
 *   ],
 *   defaultLocale: US,
 * });
 */
export function anyOf(...predicates: RequestPredicate[]): RequestPredicate {
	return async (ctx) => {
		for (const p of predicates) {
			if (await p(ctx)) return true;
		}
		return false;
	};
}

/**
 * Combines multiple predicates with AND logic.
 *
 * @example
 * // Only use cookie when on localhost AND behind an ngrok tunnel
 * const isLocalTunnel = allOf(isLocal, isPreviewDomain([/\.ngrok\.io$/]));
 *
 * getLocaleFromRequest({
 *   strategies: [
 *     when(isLocalTunnel, fromCookie('locale', {fr: FR, de: DE})),
 *     fromPathPrefix({fr: FR, de: DE}),
 *   ],
 *   defaultLocale: US,
 * });
 */
export function allOf(...predicates: RequestPredicate[]): RequestPredicate {
	return async (ctx) => {
		for (const p of predicates) {
			if (!(await p(ctx))) return false;
		}
		return true;
	};
}
