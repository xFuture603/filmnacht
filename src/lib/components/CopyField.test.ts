import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import CopyField from './CopyField.svelte';

describe('CopyField', () => {
	it('shows the value read-only, named, with a copy button', () => {
		const { body } = render(CopyField, {
			props: {
				value: 'https://f.example/join/abc',
				label: 'Invite link',
				copyLabel: 'Copy',
				copiedLabel: 'Copied'
			}
		});
		expect(body).toContain('value="https://f.example/join/abc"');
		expect(body).toContain('readonly');
		expect(body).toContain('aria-label="Invite link"');
		expect(body).toContain('>Copy<');
	});

	// A plain btn now fills with the page grey, invisible on a white card; and
	// in a join its capsule end clashed with the field's 12px corner.
	it('uses an outlined copy button whose corners match the field', () => {
		const { body } = render(CopyField, {
			props: { value: 'x', label: 'Invite link', copyLabel: 'Copy', copiedLabel: 'Copied' }
		});
		const button = body.match(/<button[^>]*class="([^"]*)"/)![1].split(' ');
		expect(button).toEqual(expect.arrayContaining(['btn-outline', 'rounded-e-xl']));
	});
});
