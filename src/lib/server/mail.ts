import { env } from '$env/dynamic/private';
import nodemailer from 'nodemailer';

/**
 * Half-configured counts as unconfigured. A host with no From address is
 * rejected by most servers, and discovering that once per reset attempt is
 * worse than saying plainly on the form that this instance cannot send mail.
 */
export function isMailConfigured(): boolean {
	return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}

/**
 * Resolves true on a successful send and false on ANY failure. It never throws.
 *
 * The caller is an enumeration-safe route that must answer identically whether
 * the address existed, whether this instance can send mail at all, and whether
 * the server was reachable. A caller given the ability to tell those apart will
 * eventually leak one of them, so the distinction is destroyed here rather than
 * passed up and carefully ignored at every call site.
 */
export async function sendMail(
	to: string,
	subject: string,
	body: string,
	calendar?: { method: 'REQUEST' | 'CANCEL'; content: string }
): Promise<boolean> {
	if (!isMailConfigured()) return false;

	try {
		await transport().sendMail({
			from: env.SMTP_FROM,
			to,
			subject,
			text: body,
			// Shown by mail clients as an invite with Accept/Decline, or as a cancellation.
			...(calendar ? { icalEvent: { method: calendar.method, content: calendar.content } } : {})
		});
		return true;
	} catch {
		// Bare catch, deliberately: the error object carries the host, the user
		// and sometimes the password, in `.response` among other places. Plan 2
		// hit this exact class with the TMDB key embedded in a request URL. The
		// operator gets the one fact they can act on and nothing they must not
		// paste into a bug report.
		console.error('SMTP send failed. Check SMTP_HOST, SMTP_PORT and credentials.');
		return false;
	}
}

function smtpPort(): number {
	const parsed = Number(env.SMTP_PORT ?? 587);
	return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 587;
}

function transport() {
	const port = smtpPort();
	return nodemailer.createTransport({
		host: env.SMTP_HOST,
		port,
		// Implicit TLS on 465, STARTTLS everywhere else — the convention every
		// provider's documentation assumes, so an operator who copies their
		// host and port from it gets a working instance without a third knob.
		secure: port === 465,
		auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
		// Without this a dead host holds the request open for the OS default,
		// which is minutes. The caller cannot distinguish slow from broken and
		// neither should the member waiting on the page.
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 20_000
	});
}

/**
 * What the admin page may show about the mail setup: whether it works and
 * where it points, never the login or the password. This object is
 * serialised into the page.
 */
export function mailStatus(): {
	configured: boolean;
	host: string | null;
	port: number;
	from: string | null;
	login: boolean;
} {
	return {
		configured: isMailConfigured(),
		host: env.SMTP_HOST || null,
		port: smtpPort(),
		from: env.SMTP_FROM || null,
		login: Boolean(env.SMTP_USER)
	};
}

/**
 * The admin's "send a test email". Unlike sendMail, the admin needs to know
 * WHY it failed, so this reports nodemailer's error code (EAUTH, ECONNECTION,
 * ETIMEDOUT, …). Only the code: the message and `.response` can quote the
 * server's reply, which can echo the login.
 */
export async function sendTestMail(
	to: string
): Promise<{ ok: true } | { ok: false; code: string }> {
	if (!isMailConfigured()) return { ok: false, code: 'NOT_CONFIGURED' };
	try {
		await transport().sendMail({
			from: env.SMTP_FROM,
			to,
			subject: 'Filmnacht test email',
			text: 'This is a test email from your Filmnacht instance. If you can read it, sending mail works.'
		});
		return { ok: true };
	} catch (err) {
		const code = (err as { code?: unknown }).code;
		const safe = typeof code === 'string' && /^[A-Z_]{2,32}$/.test(code) ? code : 'UNKNOWN';
		console.error(`SMTP test failed (${safe}). Check SMTP_HOST, SMTP_PORT and credentials.`);
		return { ok: false, code: safe };
	}
}
