// iOS Settings' grouped lists, shared by the profile and the admin page:
// rows split by inset hairlines in one rounded group, a small header above,
// space between groups instead of a card per topic.
export const group = 'mb-2 divide-y divide-base-content/10 overflow-hidden rounded-box bg-base-100';
export const header = 'mb-2 px-4 text-sm font-bold text-base-content/70';
export const footer = 'px-4 text-sm text-base-content/70';
export const row = 'flex min-h-14 items-center gap-3 px-4 py-3';
/** A row that opens something: hover and press tint, the ink focus ring. */
export const link = [
	row,
	'w-full cursor-pointer text-start transition-colors hover:bg-base-content/5 active:bg-base-content/10',
	'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-base-content'
].join(' ');
