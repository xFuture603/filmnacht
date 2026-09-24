import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

// No $lib/server/db mock needed: this route never touches the database.

function cookieSpy() {
	return { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
}

function formRequest(fields: Record<string, string>) {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	return new Request('http://localhost/locale', { method: 'POST', body: form });
}

// redirect() throws (see @sveltejs/kit's Redirect), so this always has to be
// awaited inside a try/catch.
async function post(origin: string) {
	const cookies = cookieSpy();
	try {
		await POST({
			request: formRequest({ locale: 'de' }),
			cookies,
			url: new URL('/locale', origin)
		} as never);
	} catch (err) {
		if (isRedirect(err)) return cookies;
		throw err;
	}
	throw new Error('expected POST to redirect, but it returned normally');
}

describe('locale cookie secure flag', () => {
	it('is not secure over plain http', async () => {
		const cookies = await post('http://localhost');

		expect(cookies.set).toHaveBeenCalledWith(
			'locale',
			'de',
			expect.objectContaining({ secure: false })
		);
	});

	it('is secure over https', async () => {
		const cookies = await post('https://filmnacht.example');

		expect(cookies.set).toHaveBeenCalledWith(
			'locale',
			'de',
			expect.objectContaining({ secure: true })
		);
	});
});
