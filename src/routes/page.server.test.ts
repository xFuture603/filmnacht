import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

// Both arms of `load` redirect, so it always throws. Four things route through
// / and depend on this staying true: /logout, +error.svelte's home button, the
// layout's brand link, and guardRedirect's post-setup bounce.
function loadRedirect(user: { id: string } | null) {
	try {
		load({ locals: { user, locale: 'en' } } as never);
	} catch (err) {
		if (isRedirect(err)) return err;
		throw err;
	}
	throw new Error('expected / to redirect, but load returned normally');
}

describe('GET /', () => {
	it('sends a signed-out visitor to the login form', () => {
		expect(loadRedirect(null).location).toBe('/login');
	});

	it('sends a signed-in visitor to their groups', () => {
		expect(loadRedirect({ id: 'u1' }).location).toBe('/groups');
	});
});
