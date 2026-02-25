import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Locale, RequestContext } from "./locale";
import {
	allOf,
	anyOf,
	fromAcceptLanguageHeader,
	fromCookie,
	fromDomainTLD,
	fromHeader,
	fromPathPrefix,
	fromQueryParam,
	fromSubdomain,
	getLocaleFromRequest,
	isLocal,
	isPreviewDomain,
	when,
	whenNot,
} from "./locale";

// ── Helpers ────────────────────────────────────────────────────────
const US: Locale = { language: "EN", country: "US" };
const FR: Locale = { language: "FR", country: "FR" };
const DE: Locale = { language: "DE", country: "DE" };
const GB: Locale = { language: "EN", country: "GB" };
const BR: Locale = { language: "PT", country: "BR" };

const EN_US: Locale = { language: "EN", country: "US" };
const EN_DE: Locale = { language: "EN", country: "DE" };
const FR_CA: Locale = { language: "FR", country: "CA" };

function req(url: string, headers: Record<string, string> = {}): Request {
	return new Request(url, { headers });
}

function ctx(
	url: string,
	headers: Record<string, string> = {},
): RequestContext {
	const request = req(url, headers);
	return { request, url: new URL(request.url) };
}

describe("getLocaleFromRequest", () => {
	it("returns defaultLocale when no strategies are provided", async () => {
		const resolve = getLocaleFromRequest({ strategies: [], defaultLocale: US });
		assert.deepEqual(await resolve(req("https://example.com")), US);
	});

	it("returns defaultLocale when no strategy matches", async () => {
		const resolve = getLocaleFromRequest({
			strategies: [() => null, () => undefined],
			defaultLocale: US,
		});
		assert.deepEqual(await resolve(req("https://example.com")), US);
	});

	it("returns the first matching strategy", async () => {
		const resolve = getLocaleFromRequest({
			strategies: [() => null, () => FR, () => DE],
			defaultLocale: US,
		});
		assert.deepEqual(await resolve(req("https://example.com")), FR);
	});

	it("does not evaluate strategies after a match", async () => {
		let called = false;
		const resolve = getLocaleFromRequest({
			strategies: [
				() => FR,
				() => {
					called = true;
					return DE;
				},
			],
			defaultLocale: US,
		});
		await resolve(req("https://example.com"));
		assert.equal(called, false);
	});

	it("supports async strategies", async () => {
		const resolve = getLocaleFromRequest({
			strategies: [async () => FR],
			defaultLocale: US,
		});
		assert.deepEqual(await resolve(req("https://example.com")), FR);
	});
});

describe("fromSubdomain", () => {
	const strategy = fromSubdomain({ fr: FR, de: DE });

	it("matches a known subdomain", () => {
		assert.deepEqual(strategy(ctx("https://fr.example.com")), FR);
	});

	it("returns null for an unknown subdomain", () => {
		assert.equal(strategy(ctx("https://jp.example.com")), null);
	});

	it("returns null for a single-part hostname", () => {
		assert.equal(strategy(ctx("https://localhost:3000")), null);
	});

	it("returns null when there is no subdomain", () => {
		assert.equal(strategy(ctx("https://example.com")), null);
	});

	it("matches compound locale keys like en-US", () => {
		const s = fromSubdomain({ "en-US": EN_US, "fr-CA": FR_CA });
		assert.deepEqual(s(ctx("https://en-us.example.com")), EN_US);
		assert.deepEqual(s(ctx("https://fr-ca.example.com")), FR_CA);
	});
});

describe("fromDomainTLD", () => {
	const strategy = fromDomainTLD({
		fr: FR,
		"co.uk": GB,
		"com.br": BR,
		com: US,
	});

	it("matches a single-part TLD", () => {
		assert.deepEqual(strategy(ctx("https://example.fr")), FR);
	});

	it("matches co.uk", () => {
		assert.deepEqual(strategy(ctx("https://example.co.uk")), GB);
	});

	it("matches com.br", () => {
		assert.deepEqual(strategy(ctx("https://store.com.br")), BR);
	});

	it("prefers longer TLD over shorter", () => {
		assert.deepEqual(strategy(ctx("https://store.com.br")), BR);
	});

	it("falls back to shorter TLD when no longer match exists", () => {
		assert.deepEqual(strategy(ctx("https://store.com")), US);
	});

	it("matches when hostname is exactly the TLD", () => {
		const s = fromDomainTLD({ fr: FR });
		assert.deepEqual(s(ctx("https://fr")), FR);
	});

	it("returns null for an unknown TLD", () => {
		assert.equal(strategy(ctx("https://example.jp")), null);
	});
});

describe("fromCookie", () => {
	const strategy = fromCookie("locale", { fr: FR, de: DE });

	it("matches a cookie value", () => {
		assert.deepEqual(
			strategy(ctx("https://x.com", { Cookie: "locale=fr" })),
			FR,
		);
	});

	it("matches a cookie among multiple cookies", () => {
		const c = ctx("https://x.com", {
			Cookie: "session=abc; locale=de; theme=dark",
		});
		assert.deepEqual(strategy(c), DE);
	});

	it("returns null when cookie is missing", () => {
		assert.equal(strategy(ctx("https://x.com")), null);
	});

	it("returns null when cookie value is unknown", () => {
		assert.equal(strategy(ctx("https://x.com", { Cookie: "locale=jp" })), null);
	});

	it("matches compound locale keys like en-US", () => {
		const s = fromCookie("locale", { "en-US": EN_US, "fr-CA": FR_CA });
		assert.deepEqual(
			s(ctx("https://x.com", { Cookie: "locale=en-US" })),
			EN_US,
		);
		assert.deepEqual(
			s(ctx("https://x.com", { Cookie: "locale=en-us" })),
			EN_US,
		);
	});
});

describe("fromAcceptLanguageHeader", () => {
	const strategy = fromAcceptLanguageHeader({ fr: FR, de: DE });

	it("picks the highest quality match", () => {
		const c = ctx("https://x.com", {
			"Accept-Language": "de;q=0.8, fr;q=0.9",
		});
		assert.deepEqual(strategy(c), FR);
	});

	it("defaults to q=1 when no quality is specified", () => {
		const c = ctx("https://x.com", { "Accept-Language": "fr, de;q=0.5" });
		assert.deepEqual(strategy(c), FR);
	});

	it("falls back to language prefix (fr-CA → fr)", () => {
		const c = ctx("https://x.com", { "Accept-Language": "fr-CA;q=1" });
		assert.deepEqual(strategy(c), FR);
	});

	it("returns null when no language matches", () => {
		const c = ctx("https://x.com", { "Accept-Language": "ja;q=1" });
		assert.equal(strategy(c), null);
	});

	it("returns null when header is missing", () => {
		assert.equal(strategy(ctx("https://x.com")), null);
	});

	it("matches compound locale keys like en-US", () => {
		const s = fromAcceptLanguageHeader({ "en-US": EN_US, "en-DE": EN_DE });
		const c = ctx("https://x.com", {
			"Accept-Language": "en-DE;q=0.9, en-US;q=0.8",
		});
		assert.deepEqual(s(c), EN_DE);
	});
});

describe("fromHeader", () => {
	const strategy = fromHeader("x-locale", { fr: FR, de: DE });

	it("matches a header value", () => {
		assert.deepEqual(strategy(ctx("https://x.com", { "x-locale": "fr" })), FR);
	});

	it("is case-insensitive", () => {
		assert.deepEqual(strategy(ctx("https://x.com", { "x-locale": "FR" })), FR);
	});

	it("returns null when header is missing", () => {
		assert.equal(strategy(ctx("https://x.com")), null);
	});

	it("returns null when header value is unknown", () => {
		assert.equal(strategy(ctx("https://x.com", { "x-locale": "jp" })), null);
	});
});

describe("fromPathPrefix", () => {
	const strategy = fromPathPrefix({ fr: FR, de: DE });

	it("matches a path prefix", () => {
		assert.deepEqual(strategy(ctx("https://x.com/fr/products/hat")), FR);
	});

	it("matches a prefix-only path", () => {
		assert.deepEqual(strategy(ctx("https://x.com/de")), DE);
	});

	it("is case-insensitive", () => {
		assert.deepEqual(strategy(ctx("https://x.com/FR/products")), FR);
	});

	it("returns null for an unknown prefix", () => {
		assert.equal(strategy(ctx("https://x.com/jp/products")), null);
	});

	it("returns null when path has no prefix", () => {
		assert.equal(strategy(ctx("https://x.com/")), null);
	});

	it("matches compound locale keys like en-US", () => {
		const s = fromPathPrefix({ "en-US": EN_US, "fr-CA": FR_CA });
		assert.deepEqual(s(ctx("https://x.com/en-us/products")), EN_US);
		assert.deepEqual(s(ctx("https://x.com/EN-US/products")), EN_US);
		assert.deepEqual(s(ctx("https://x.com/fr-CA/products")), FR_CA);
	});
});

describe("fromQueryParam", () => {
	const strategy = fromQueryParam("locale", { fr: FR, de: DE });

	it("matches a query parameter", () => {
		assert.deepEqual(strategy(ctx("https://x.com?locale=fr")), FR);
	});

	it("is case-insensitive", () => {
		assert.deepEqual(strategy(ctx("https://x.com?locale=DE")), DE);
	});

	it("returns null when param is missing", () => {
		assert.equal(strategy(ctx("https://x.com")), null);
	});

	it("returns null when param value is unknown", () => {
		assert.equal(strategy(ctx("https://x.com?locale=jp")), null);
	});

	it("matches compound locale keys like en-US", () => {
		const s = fromQueryParam("locale", { "en-US": EN_US, "fr-CA": FR_CA });
		assert.deepEqual(s(ctx("https://x.com?locale=en-US")), EN_US);
		assert.deepEqual(s(ctx("https://x.com?locale=EN-US")), EN_US);
	});
});

describe("isLocal", () => {
	it("matches localhost", () => {
		assert.equal(isLocal(ctx("http://localhost:3000")), true);
	});

	it("matches 127.0.0.1", () => {
		assert.equal(isLocal(ctx("http://127.0.0.1:3000")), true);
	});

	it("matches ::1", () => {
		assert.equal(isLocal(ctx("http://[::1]:3000")), true);
	});

	it("matches localhost with subdomain", () => {
		assert.equal(isLocal(ctx("http://fr.localhost:3000")), true);
	});

	it("rejects production hosts", () => {
		assert.equal(isLocal(ctx("https://example.com")), false);
	});
});

describe("isPreviewDomain", () => {
	const check = isPreviewDomain();

	it("matches trycloudflare.com", () => {
		assert.equal(check(ctx("https://abc.trycloudflare.com")), true);
	});

	it("matches ngrok.app", () => {
		assert.equal(check(ctx("https://abc.ngrok.app")), true);
	});

	it("rejects production hosts", () => {
		assert.equal(check(ctx("https://my-store.com")), false);
	});

	it("supports custom string patterns", () => {
		const custom = isPreviewDomain([".staging.com"]);
		assert.equal(custom(ctx("https://my-store.staging.com")), true);
		assert.equal(custom(ctx("https://my-store.com")), false);
	});

	it("supports custom regex patterns", () => {
		const custom = isPreviewDomain([/^staging\./]);
		assert.equal(custom(ctx("https://staging.my-store.com")), true);
		assert.equal(custom(ctx("https://my-store.com")), false);
	});
});

describe("when", () => {
	it("runs strategy when predicate is true", async () => {
		const s = when(
			() => true,
			() => FR,
		);
		assert.deepEqual(await s(ctx("https://x.com")), FR);
	});

	it("skips strategy when predicate is false", async () => {
		const s = when(
			() => false,
			() => FR,
		);
		assert.equal(await s(ctx("https://x.com")), null);
	});

	it("supports async predicates", async () => {
		const s = when(
			async () => true,
			() => FR,
		);
		assert.deepEqual(await s(ctx("https://x.com")), FR);
	});
});

describe("whenNot", () => {
	it("runs strategy when predicate is false", async () => {
		const s = whenNot(
			() => false,
			() => FR,
		);
		assert.deepEqual(await s(ctx("https://x.com")), FR);
	});

	it("skips strategy when predicate is true", async () => {
		const s = whenNot(
			() => true,
			() => FR,
		);
		assert.equal(await s(ctx("https://x.com")), null);
	});
});

describe("anyOf", () => {
	it("returns true when any predicate matches", async () => {
		const p = anyOf(
			() => false,
			() => true,
		);
		assert.equal(await p(ctx("https://x.com")), true);
	});

	it("returns false when no predicate matches", async () => {
		const p = anyOf(
			() => false,
			() => false,
		);
		assert.equal(await p(ctx("https://x.com")), false);
	});

	it("short-circuits on first true", async () => {
		let called = false;
		const p = anyOf(
			() => true,
			() => {
				called = true;
				return false;
			},
		);
		await p(ctx("https://x.com"));
		assert.equal(called, false);
	});
});

describe("allOf", () => {
	it("returns true when all predicates match", async () => {
		const p = allOf(
			() => true,
			() => true,
		);
		assert.equal(await p(ctx("https://x.com")), true);
	});

	it("returns false when any predicate fails", async () => {
		const p = allOf(
			() => true,
			() => false,
		);
		assert.equal(await p(ctx("https://x.com")), false);
	});

	it("short-circuits on first false", async () => {
		let called = false;
		const p = allOf(
			() => false,
			() => {
				called = true;
				return true;
			},
		);
		await p(ctx("https://x.com"));
		assert.equal(called, false);
	});
});

describe("subdomain leak on dev: with vs without whenNot", () => {
	const locales = { fr: FR, de: DE };
	const isDev = anyOf(isLocal, isPreviewDomain());

	const devRequestWithSubdomain = req("http://fr.localhost:3000/products");

	describe("WITH whenNot — subdomain is blocked on dev", () => {
		const resolve = getLocaleFromRequest({
			strategies: [
				when(isDev, fromPathPrefix(locales)),
				whenNot(isDev, fromSubdomain(locales)),
				fromCookie("locale", locales),
				fromAcceptLanguageHeader(locales),
			],
			defaultLocale: US,
		});

		it("does not resolve from subdomain on dev, falls to default", async () => {
			assert.deepEqual(await resolve(devRequestWithSubdomain), US);
		});
	});

	describe("WITHOUT whenNot — subdomain leaks through on dev", () => {
		const resolve = getLocaleFromRequest({
			strategies: [
				when(isDev, fromPathPrefix(locales)),
				fromSubdomain(locales),
				fromCookie("locale", locales),
				fromAcceptLanguageHeader(locales),
			],
			defaultLocale: US,
		});

		it("resolves FR from subdomain even on dev", async () => {
			assert.deepEqual(await resolve(devRequestWithSubdomain), FR);
		});
	});
});

describe("integration: dev vs production", () => {
	const locales = { fr: FR, de: DE };
	const isDev = anyOf(isLocal, isPreviewDomain());

	const resolve = getLocaleFromRequest({
		strategies: [
			when(isDev, fromPathPrefix(locales)),
			whenNot(isDev, fromSubdomain(locales)),
			fromCookie("locale", locales),
			fromAcceptLanguageHeader(locales),
		],
		defaultLocale: US,
	});

	it("uses path prefix on localhost", async () => {
		assert.deepEqual(
			await resolve(req("http://localhost:3000/fr/products")),
			FR,
		);
	});

	it("uses path prefix on preview domain", async () => {
		assert.deepEqual(
			await resolve(req("https://abc.ngrok.app/de/products")),
			DE,
		);
	});

	it("uses subdomain in production", async () => {
		assert.deepEqual(
			await resolve(req("https://fr.my-store.com/products")),
			FR,
		);
	});

	it("ignores subdomain on localhost", async () => {
		assert.deepEqual(await resolve(req("http://localhost:3000/products")), US);
	});

	it("ignores path prefix in production", async () => {
		assert.deepEqual(
			await resolve(req("https://my-store.com/fr/products")),
			US,
		);
	});

	it("falls back to cookie on any environment", async () => {
		const r = req("https://my-store.com/products", { Cookie: "locale=de" });
		assert.deepEqual(await resolve(r), DE);
	});

	it("falls back to accept-language on any environment", async () => {
		const r = req("https://my-store.com/products", {
			"Accept-Language": "fr;q=1",
		});
		assert.deepEqual(await resolve(r), FR);
	});

	it("cookie takes priority over accept-language", async () => {
		const r = req("https://my-store.com/products", {
			Cookie: "locale=de",
			"Accept-Language": "fr;q=1",
		});
		assert.deepEqual(await resolve(r), DE);
	});

	it("returns defaultLocale when nothing matches", async () => {
		assert.deepEqual(await resolve(req("https://my-store.com/products")), US);
	});
});
