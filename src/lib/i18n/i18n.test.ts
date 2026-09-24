import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX, PASSWORD_MIN } from '$lib/server/auth/password';
import de from './de.json';
import en from './en.json';
import { resolveLocale, t } from './index';

describe('t', () => {
	it('returns the string for the locale', () => {
		expect(t('en', 'nav.groups')).toBe('Groups');
		expect(t('de', 'nav.groups')).toBe('Gruppen');
	});

	it('falls back to English when a translation is missing', () => {
		expect(t('de', 'test.only_in_english')).toBe('Only in English');
	});

	it('returns the key itself when no dictionary has it', () => {
		expect(t('en', 'nope.not.here')).toBe('nope.not.here');
	});

	it('interpolates named parameters', () => {
		expect(t('en', 'test.greeting', { name: 'Ada' })).toBe('Hello Ada');
	});

	it('leaves unknown placeholders intact rather than printing undefined', () => {
		expect(t('en', 'test.greeting')).toBe('Hello {name}');
	});

	it('leaves a placeholder intact when params omits its key', () => {
		expect(t('en', 'test.greeting', {})).toBe('Hello {name}');
	});
});

describe('dictionary parity', () => {
	it('has a German counterpart for every non-test English key', () => {
		const missing = Object.keys(en)
			.filter((key) => !key.startsWith('test.'))
			.filter((key) => !(key in (de as Record<string, string>)));
		expect(missing).toEqual([]);
	});
});

describe('auth.error.password names the real bounds', () => {
	// Not interpolation — the page can't import from $lib/server, so tying the
	// string to the constant at build time isn't available here. This is the
	// cheap alternative: if PASSWORD_MIN/PASSWORD_MAX is ever bumped without
	// updating both locale strings, this fails loudly instead of the message
	// quietly lying again (the exact bug FIX 3 fixed).
	it('both locales mention the actual PASSWORD_MIN and PASSWORD_MAX', () => {
		for (const dict of [en, de] as Record<string, string>[]) {
			expect(dict['auth.error.password']).toContain(String(PASSWORD_MIN));
			expect(dict['auth.error.password']).toContain(String(PASSWORD_MAX));
		}
	});
});

describe('resolveLocale', () => {
	it('prefers a valid cookie over the header', () => {
		expect(resolveLocale('en-US,en;q=0.9', 'de')).toBe('de');
	});

	it('ignores an unsupported cookie', () => {
		expect(resolveLocale('de-DE,de;q=0.9', 'fr')).toBe('de');
	});

	it('picks the highest-weighted supported tag, skipping unsupported ones', () => {
		expect(resolveLocale('fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7')).toBe('de');
	});

	it('defaults to English', () => {
		expect(resolveLocale(null)).toBe('en');
		expect(resolveLocale('fr-FR,fr;q=0.9')).toBe('en');
	});

	it('ranks by quality value, not by position in the header', () => {
		expect(resolveLocale('en;q=0.5,de;q=0.9')).toBe('de');
	});

	it('treats q=0 as "not acceptable" rather than as a weak preference', () => {
		expect(resolveLocale('de;q=0,en')).toBe('en');
	});
});
