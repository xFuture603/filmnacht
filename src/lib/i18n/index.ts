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
	for (const part of (acceptLanguage ?? '').split(',')) {
		const tag = part.split(';')[0].trim().slice(0, 2).toLowerCase();
		if (isLocale(tag)) return tag;
	}
	return 'en';
}
