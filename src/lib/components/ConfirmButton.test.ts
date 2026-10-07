import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ConfirmButton from './ConfirmButton.svelte';

const label = createRawSnippet(() => ({ render: () => '<span>Cancel this night</span>' }));

describe('ConfirmButton', () => {
	it('sends no confirmation until it is armed', () => {
		const { body } = render(ConfirmButton, {
			props: { armedLabel: 'Click again to confirm', children: label }
		});
		expect(body).toContain('Cancel this night');
		expect(body).not.toContain('name="confirm"');
	});

	it('asks for the second click, and sends the confirmation, once armed by the server', () => {
		const { body } = render(ConfirmButton, {
			props: { armed: true, armedLabel: 'Click again to confirm', children: label }
		});
		expect(body).toContain('Click again to confirm');
		expect(body).toContain('name="confirm"');
		expect(body).toContain('value="on"');
	});
});
