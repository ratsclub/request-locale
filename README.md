# hydrogen-locale

A configurable locale resolution for
[Request](https://developer.mozilla.org/en-US/docs/Web/API/Request).
Define strategies to extract a locale from the incoming request and
control their precedence.

## Install

Just copy the [locate.ts](./src/locale.ts) file into your project.

## Usage

Strategies are evaluated in array order. The first one to return a
non-null locale wins. If none match, defaultLocale is returned.

```typescript
const locales = {
  fr: {language: 'FR', country: 'FR'},
  de: {language: 'DE', country: 'DE'},
};

const isDev = anyOf(isLocal, isPreviewDomain());

const resolve = getLocaleFromRequest({
    strategies: [
        // Use path prefixes during development
        when(isDev, fromPathPrefix(locales)),
        // Only use subdomain locales in production
        whenNot(isDev, fromSubdomain(locales)),
        // Get locale from cookies
        fromCookie("locale", locales),
        // Get locale from Accept-Language header
        fromAcceptLanguageHeader(locales),
    ],
    defaultLocale: US,
});

// When using Hydrogen
const i18n = await resolveLocale(request);
const hydrogenContext = createHydrogenContext({
  storefront: {i18n},
  // ...
});
```

## Strategies

| Function                        | Resolves from            | Example match           |
|---------------------------------|--------------------------|-------------------------|
| `fromSubdomain(map)`            | Subdomain                | `fr.my-store.com`       |
| `fromDomainTLD(map)`            | Domain suffix            | `my-store.co.uk`        |
| `fromPathPrefix(map)`           | URL path prefix          | `/fr/products/hat`      |
| `fromQueryParam(name, map)`     | Query parameter          | `?locale=fr`            |
| `fromCookie(name, map)`         | Cookie value             | `Cookie: locale=fr`     |
| `fromAcceptLanguageHeader(map)` | `Accept-Language` header | `fr-CA;q=0.9, de;q=0.8` |
| `fromHeader(name, map)`         | Any request header       | `X-Locale: fr`          |

All strategies take a `Record<string, Locale>` map that maps string
keys to locale objects. Keys are case-insensitive and support compound
formats:

```typescript
const locales = {
  'en-US': {language: 'EN', country: 'US'},
  'en-DE': {language: 'EN', country: 'DE'},
  'fr-CA': {language: 'FR', country: 'CA'},
  de:      {language: 'DE', country: 'DE'},
};
```

## Conditional strategies

Use `when` and `whenNot` to restrict strategies to specific environments:

```typescript
const isDev = anyOf(isLocal, isPreviewDomain());

getLocaleFromRequest({
  strategies: [
    when(isDev, fromPathPrefix(locales)),
    whenNot(isDev, fromSubdomain(locales)),
    fromAcceptLanguageHeader(locales),
  ],
  defaultLocale: {language: 'EN', country: 'US'},
});
```

### Predicates

| Predicate                   | Matches                                                                                   |
|-----------------------------|-------------------------------------------------------------------------------------------|
| `isLocal`                   | `localhost`, `*.localhost`, `127.0.0.1`, `::1`                                            |
| `isPreviewDomain()`         | `*.oxygen.run`, `*.myshopify.com`, `*.vercel.app`, `*.netlify.app`, `*.trycloudflare.com` |
| `isPreviewDomain(patterns)` | Custom list of strings or RegExp patterns                                                 |
| `anyOf(...predicates)`      | At least one predicate is true                                                            |
| `allOf(...predicates)`      | All predicates are true                                                                   |

## Custom strategies

A strategy is a function that receives a `RequestContext` and returns
a `Locale` or `null`:

```typescript
const fromCloudflareCountry: LocaleStrategy = ({request}) => {
  const country = request.headers.get('CF-IPCountry')?.toUpperCase();
  if (country === 'FR') return {language: 'FR', country: 'FR'};
  if (country === 'DE') return {language: 'DE', country: 'DE'};
  return null;
};

getLocaleFromRequest({
  strategies: [fromCloudflareCountry, fromAcceptLanguageHeader(locales)],
  defaultLocale: {language: 'EN', country: 'US'},
});
```

Async strategies are also supported.

