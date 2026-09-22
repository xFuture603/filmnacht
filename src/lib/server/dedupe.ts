/**
 * A film's identity within one group's pool, unique per group.
 *
 * A TMDB id is authoritative when present. Without one — a hand-entered film —
 * the title has to do the work, so it is normalised hard: diacritics folded,
 * punctuation collapsed, case and spacing ignored. Two people typing "Amélie"
 * and "Amelie" mean the same film, and the pool must say so rather than
 * quietly holding both (PRD §5).
 */

/**
 * German transliterates these to digraphs, not to bare vowels: "Müller" and
 * "Mueller" are one name, and NFD alone would split them. Applied before NFD
 * so the umlaut is consumed here rather than stripped to a bare vowel.
 */
const GERMAN_DIGRAPHS: Record<string, string> = {
	ä: 'ae',
	ö: 'oe',
	ü: 'ue',
	ß: 'ss'
};

export function dedupeKey(input: {
	tmdbId?: number | null;
	title: string;
	year?: number | null;
}): string {
	if (input.tmdbId != null) return `tmdb:${input.tmdbId}`;
	const slug = input.title
		.toLowerCase()
		// Recompose first: the digraph map below matches single precomposed code
		// points, so decomposed input (base letter + combining diaeresis, routine
		// from macOS and from already-normalized sources) would otherwise slip
		// past it and get stripped to a bare vowel instead of a digraph.
		.normalize('NFC')
		.replace(/[äöüß]/g, (character) => GERMAN_DIGRAPHS[character])
		.normalize('NFD')
		// Strip remaining combining marks (U+0300-U+036F), so "é" becomes "e".
		// Written as escapes on purpose: the literal characters are invisible in
		// source and get eaten by tooling that is not escape-safe.
		.replace(/[\u0300-\u036f]/g, '')
		// Keep letters and digits in ANY script. An ASCII-only class collapses
		// every Cyrillic, Japanese or Greek title to the empty slug, so two
		// different foreign films released in the same year would be judged
		// duplicates of each other.
		.replace(/[^\p{Letter}\p{Number}]+/gu, '-')
		.replace(/^-+|-+$/g, '');
	return `manual:${slug}:${input.year ?? ''}`;
}
