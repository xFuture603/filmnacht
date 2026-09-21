import de from './de.json';
import en from './en.json';

export const locales = ['en', 'de'] as const;
export type Locale = (typeof locales)[number];

const dictionaries: Record<Locale, Record<string, string>> = { en, de };

function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
	const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (match, name) =>
		name in params ? String(params[name]) : match
	);
}

export function resolveLocale(acceptLanguage: string | null, cookie?: string | null): Locale {
	if (isLocale(cookie)) return cookie;
	const ranked = (acceptLanguage ?? '')
		.split(',')
		.map((part) => {
			const [tag, ...params] = part.split(';');
			const q = params.find((p) => p.trim().startsWith('q='))?.split('=')[1];
			const weight = q === undefined || !Number.isFinite(Number(q)) ? 1 : Number(q);
			return { tag: tag.trim().slice(0, 2).toLowerCase(), weight };
		})
		// q=0 means "not acceptable", so it is a filter, not just a low rank.
		.filter((entry) => isLocale(entry.tag) && entry.weight > 0)
		.sort((a, b) => b.weight - a.weight);
	return ranked.length ? (ranked[0].tag as Locale) : 'en';
}
