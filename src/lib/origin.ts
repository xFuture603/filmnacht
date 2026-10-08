/**
 * Whether the browser is at a different origin than the server believes it
 * serves. SvelteKit refuses every form post across that gap ("Cross-site POST
 * form submissions are forbidden"), so the layout warns before anyone types.
 *
 * Compared in the browser on purpose: behind Traefik or NGINX the server sees
 * plain http and often an upstream host name, while `location.origin` is the
 * address people actually use. `serverOrigin` is the request's `url.origin`,
 * which adapter-node takes from ORIGIN, the same value the CSRF check uses.
 */
export function originMismatch(serverOrigin: string, browserOrigin: string): boolean {
	try {
		return new URL(serverOrigin).origin !== new URL(browserOrigin).origin;
	} catch {
		return false; // nothing to compare against; no false alarm
	}
}
