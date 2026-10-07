import { describe, expect, it } from 'vitest';
import { nightIcs } from './ics';

const base = {
	nightId: 'n1',
	groupName: 'Filmnacht',
	start: new Date('2030-07-01T18:00:00Z'),
	end: new Date('2030-07-01T21:00:00Z'),
	location: 'Sofa',
	url: 'https://f.example/groups/g/nights/n1',
	now: new Date('2030-06-01T10:00:00Z')
};
const lines = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n');

describe('nightIcs', () => {
	it('describes the night as an invite in UTC', () => {
		const ics = nightIcs({ ...base, method: 'REQUEST' });
		expect(lines(ics)).toEqual(
			expect.arrayContaining([
				'METHOD:REQUEST',
				'UID:night-n1@filmnacht',
				'SEQUENCE:0',
				'STATUS:CONFIRMED',
				'DTSTAMP:20300601T100000Z',
				'DTSTART:20300701T180000Z',
				'DTEND:20300701T210000Z',
				'SUMMARY:Filmnacht: Filmnacht',
				'LOCATION:Sofa',
				'URL:https://f.example/groups/g/nights/n1'
			])
		);
	});

	it('cancels the same event with a higher sequence', () => {
		expect(lines(nightIcs({ ...base, method: 'CANCEL' }))).toEqual(
			expect.arrayContaining([
				'METHOD:CANCEL',
				'UID:night-n1@filmnacht',
				'SEQUENCE:1',
				'STATUS:CANCELLED'
			])
		);
	});

	it('escapes commas, semicolons, backslashes and newlines in text', () => {
		const ics = nightIcs({
			...base,
			method: 'PUBLISH',
			location: 'Sofa; back room, up\\stairs\nleft'
		});
		expect(lines(ics)).toContain('LOCATION:Sofa\\; back room\\, up\\\\stairs\\nleft');
	});

	it('leaves out what is not set', () => {
		const ics = nightIcs({ ...base, method: 'PUBLISH', location: null, url: null });
		expect(ics).not.toContain('LOCATION');
		expect(ics).not.toContain('URL');
	});

	it('folds long lines at 75 octets without splitting characters, and ends lines in CRLF', () => {
		const groupName = 'Größte Filmnacht der Welt '.repeat(8);
		const ics = nightIcs({ ...base, method: 'PUBLISH', groupName });
		for (const line of ics.split('\r\n')) {
			expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
		}
		expect(ics.endsWith('\r\n')).toBe(true);
		expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
		expect(lines(ics)).toContain(`SUMMARY:Filmnacht: ${groupName}`);
	});

	it('never cuts a multi-byte character in half when folding', () => {
		// "SUMMARY:Filmnacht: x" is 20 octets and ö is 2, so a boundary at 75 lands inside one.
		const groupName = 'x' + 'ö'.repeat(80);
		const ics = nightIcs({ ...base, method: 'PUBLISH', groupName });
		expect(ics).not.toContain('\uFFFD');
		expect(lines(ics)).toContain(`SUMMARY:Filmnacht: ${groupName}`);
	});

	it('names the organizer and the one attendee on an invite or a cancellation', () => {
		for (const method of ['REQUEST', 'CANCEL'] as const) {
			const all = lines(
				nightIcs({ ...base, method, organizer: 'films@example.org', attendee: 'grace@example.org' })
			);
			expect(all).toContain('ORGANIZER;CN=Filmnacht:mailto:films@example.org');
			expect(all).toContain('ATTENDEE;RSVP=FALSE:mailto:grace@example.org');
		}
	});

	it('leaves organizer and attendee out of a download', () => {
		const ics = nightIcs({
			...base,
			method: 'PUBLISH',
			organizer: 'films@example.org',
			attendee: 'grace@example.org'
		});
		expect(ics).not.toContain('ORGANIZER');
		expect(ics).not.toContain('ATTENDEE');
	});
});
