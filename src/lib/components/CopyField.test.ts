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
});
