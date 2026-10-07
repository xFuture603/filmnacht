/**
 * One movie night as an iCalendar file (RFC 5545): the email invite, its
 * cancellation, and the "Add to calendar" download. The UID is fixed per
 * night so a cancellation removes the very event the invite created. The
 * film is never named: nothing is drawn yet when a night is scheduled, and a
 * surprise must stay one.
 */

export type IcsMethod = 'REQUEST' | 'CANCEL' | 'PUBLISH';

export function nightIcs(input: {
	nightId: string;
	method: IcsMethod;
	groupName: string;
	start: Date;
	end: Date;
	location: string | null;
	url: string | null;
	now?: Date;
}): string {
	const cancel = input.method === 'CANCEL';
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Filmnacht//Movie nights//EN',
		'CALSCALE:GREGORIAN',
		`METHOD:${input.method}`,
		'BEGIN:VEVENT',
		`UID:night-${input.nightId}@filmnacht`,
		`SEQUENCE:${cancel ? 1 : 0}`,
		`STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`,
		`DTSTAMP:${utc(input.now ?? new Date())}`,
		`DTSTART:${utc(input.start)}`,
		`DTEND:${utc(input.end)}`,
		`SUMMARY:${text(`Filmnacht: ${input.groupName}`)}`,
		...(input.location ? [`LOCATION:${text(input.location)}`] : []),
		...(input.url ? [`URL:${input.url}`, `DESCRIPTION:${text(input.url)}`] : []),
		'END:VEVENT',
		'END:VCALENDAR'
	];
	return lines.map(fold).join('\r\n') + '\r\n';
}

/** 2030-07-01T18:00:00.000Z → 20300701T180000Z */
const utc = (at: Date) =>
	at
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');

const text = (value: string) =>
	value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** At most 75 octets per line; continuation lines start with a space (§3.1). */
function fold(line: string): string {
	const bytes = new TextEncoder().encode(line);
	if (bytes.length <= 75) return line;
	const decoder = new TextDecoder();
	const parts: string[] = [];
	let start = 0;
	let room = 75;
	while (start < bytes.length) {
		let end = Math.min(start + room, bytes.length);
		// Never cut a UTF-8 sequence: back off over continuation bytes.
		while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
		parts.push(decoder.decode(bytes.slice(start, end)));
		start = end;
		room = 74; // the leading space takes one octet
	}
	return parts.join('\r\n ');
}
