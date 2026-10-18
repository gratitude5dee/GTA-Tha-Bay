import type { Env } from './env.ts';
import { apiError } from './errors.ts';

export interface Ctx {
  request: Request;
  env: Env;
  url: URL;
  requestId: string;
}

export type Handler = (ctx: Ctx) => Response | Promise<Response>;

export interface Route {
  /** Methods the route answers; GET also answers HEAD. `'*'` answers every method. */
  methods: readonly string[] | '*';
  /** Exact path, or a path prefix when `prefix` is true. */
  path: string;
  prefix?: boolean;
  handler: Handler;
}

export function pathMatches(route: Route, pathname: string): boolean {
  if (!route.prefix) return pathname === route.path;
  return pathname === route.path || pathname.startsWith(`${route.path}/`);
}

function methodMatches(route: Route, method: string): boolean {
  if (route.methods === '*') return true;
  return route.methods.includes(method) || (method === 'HEAD' && route.methods.includes('GET'));
}

/** Method plus path table, no framework. Unknown path: 404 not_found. Known path, wrong method: 405 with Allow. */
export async function dispatch(routes: readonly Route[], ctx: Ctx): Promise<Response> {
  const method = ctx.request.method.toUpperCase();
  const pathRoutes = routes.filter((r) => pathMatches(r, ctx.url.pathname));
  if (pathRoutes.length === 0) {
    return apiError('not_found', 'No such route.', ctx.requestId);
  }
  const route = pathRoutes.find((r) => methodMatches(r, method));
  if (!route) {
    const allow = [...new Set(pathRoutes.flatMap((r) => (r.methods === '*' ? [] : r.methods)))].join(', ');
    return apiError('bad_request', 'Method not allowed.', ctx.requestId, { status: 405, headers: { Allow: allow } });
  }
  return route.handler(ctx);
}
