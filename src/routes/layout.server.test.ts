import { describe, expect, it } from 'vitest';
import { load } from './+layout.server';

describe('root layout', () => {
	it('tells the page which origin the server believes it serves', async () => {
		const data = (await load({
			locals: { locale: 'en', user: null },
			url: new URL('https://filmnacht.example.org/groups')
		} as never)) as { serverOrigin: string };
		expect(data.serverOrigin).toBe('https://filmnacht.example.org');
	});
});
