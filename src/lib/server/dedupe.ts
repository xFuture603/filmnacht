/**
 * A film's identity within one group's pool, unique per group.
 *
 * A TMDB id is authoritative when present. Without one — a hand-entered film —
 * the title has to do the work, so it is normalised hard: diacritics folded,
 * punctuation collapsed, case and spacing ignored. Two people typing "Amélie"
 * and "Amelie" mean the same film, and the pool must say so rather than
 * quietly holding both (PRD §5).
 */
export function dedupeKey(input: {
	tmdbId?: number | null;
	title: string;
	year?: number | null;
}): string {
	if (input.tmdbId != null) return `tmdb:${input.tmdbId}`;
	const slug = input.title
		.normalize('NFD')
		// Strip combining marks (U+0300-U+036F), so "e-acute" becomes "e".
		// Written as escapes on purpose: the literal characters are invisible
		// in source and get eaten by tooling that is not escape-safe.
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `manual:${slug}:${input.year ?? ''}`;
}
