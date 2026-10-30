import type { RequestHandler } from './$types';

/** Asked before each background refresh: is the app reachable right now? */
export const GET: RequestHandler = () => new Response('ok');
