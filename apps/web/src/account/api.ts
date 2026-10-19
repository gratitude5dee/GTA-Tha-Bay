/**
 * Client of the password-account routes 58-66 (M00e). The access token lives in this module's memory only; the refresh token
 * is an HttpOnly cookie (`dv-rt`) the page cannot read. Nothing here stores a token in localStorage, sessionStorage or IndexedDB.
 * The browser never calls Supabase: every call goes to the same-origin Worker.
 */
import type {
  ApiError,
  BootConfig,
  LegalDocRes,
  LoginReq,
  PasswordExportRes,
  PasswordMeRes,
  PasswordSessionRes,
  PasswordUser,
  SignupReq,
} from '@dv/shared';

/** The access token is refreshed this long before it expires. */
export const REFRESH_LEAD_MS = 60_000;
const MIN_REFRESH_DELAY_MS = 5_000;

export interface SessionState {
  accessToken: string;
  expiresIn: number;
  user: PasswordUser;
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string; message: string; retryAfterMs?: number; termsRequired: { termsVersion: string } | null };

export interface ClientDeps {
  fetch: typeof fetch;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

export function browserDeps(): ClientDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
}

/** Removes the `dv-session` entry the merged PR #1 page wrote (tokens must not stay in localStorage). Safe to call on every load. */
export function purgeLegacySession(storage: Pick<Storage, 'removeItem'> | null): void {
  try {
    storage?.removeItem('dv-session');
  } catch {
    /* storage can be blocked */
  }
}

export function refreshDelayMs(expiresInSeconds: number): number {
  return Math.max(expiresInSeconds * 1000 - REFRESH_LEAD_MS, MIN_REFRESH_DELAY_MS);
}

export interface AccountApi {
  session(): SessionState | null;
  boot(): Promise<ApiResult<BootConfig>>;
  legal(doc: 'terms' | 'privacy'): Promise<ApiResult<LegalDocRes>>;
  signup(req: SignupReq): Promise<ApiResult<SessionState>>;
  login(req: LoginReq): Promise<ApiResult<SessionState>>;
  /** Route 60 with the cookie; clears the session when it fails. */
  refresh(): Promise<ApiResult<SessionState>>;
  logout(): Promise<void>;
  me(): Promise<ApiResult<PasswordMeRes>>;
  deleteAccount(): Promise<ApiResult<null>>;
  exportData(): Promise<ApiResult<PasswordExportRes>>;
  dispose(): void;
}

export function createAccountApi(deps: ClientDeps, onChange: (s: SessionState | null) => void): AccountApi {
  let current: SessionState | null = null;
  let timer: unknown = null;

  const setSession = (s: SessionState | null): void => {
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
    current = s;
    if (s) {
      timer = deps.setTimeout(() => {
        timer = null;
        void api.refresh();
      }, refreshDelayMs(s.expiresIn));
    }
    onChange(s);
  };

  async function request<T>(method: string, path: string, opts: { body?: unknown; auth?: boolean } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.auth && current) headers['Authorization'] = `Bearer ${current.accessToken}`;
    let res: Response;
    try {
      res = await deps.fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
    } catch {
      return { ok: false, status: 0, code: 'network', message: 'network', termsRequired: null };
    }
    if (res.ok) {
      if (res.status === 204) return { ok: true, status: 204, data: null as T };
      try {
        return { ok: true, status: res.status, data: (await res.json()) as T };
      } catch {
        return { ok: false, status: res.status, code: 'internal', message: 'bad response', termsRequired: null };
      }
    }
    let err: ApiError['error'] | null = null;
    try {
      err = ((await res.json()) as ApiError).error;
    } catch {
      /* not an envelope */
    }
    const details = err?.details;
    const termsRequired =
      err?.code === 'forbidden' && details?.['reason'] === 'terms_required' && typeof details['termsVersion'] === 'string'
        ? { termsVersion: details['termsVersion'] }
        : null;
    return {
      ok: false,
      status: res.status,
      code: err?.code ?? 'internal',
      message: err?.message ?? '',
      ...(err?.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}),
      termsRequired,
    };
  }

  const toSession = (r: ApiResult<PasswordSessionRes>): ApiResult<SessionState> => {
    if (!r.ok) return r;
    const s: SessionState = { accessToken: r.data.session.accessToken, expiresIn: r.data.session.expiresIn, user: r.data.user };
    setSession(s);
    return { ok: true, status: r.status, data: s };
  };

  /** Authenticated call; one refresh and one retry on a 401 (the access token may have expired). */
  async function authed<T>(method: string, path: string): Promise<ApiResult<T>> {
    let r = await request<T>(method, path, { auth: true });
    if (!r.ok && r.status === 401) {
      const refreshed = await api.refresh();
      if (refreshed.ok) r = await request<T>(method, path, { auth: true });
    }
    return r;
  }

  const api: AccountApi = {
    session: () => current,
    boot: () => request<BootConfig>('GET', '/api/v1/boot'),
    legal: (doc) => request<LegalDocRes>('GET', `/api/v1/legal/${doc}`),
    signup: async (req) => toSession(await request<PasswordSessionRes>('POST', '/api/v1/auth/signup', { body: req })),
    login: async (req) => toSession(await request<PasswordSessionRes>('POST', '/api/v1/auth/login', { body: req })),
    refresh: async () => {
      const r = await request<PasswordSessionRes>('POST', '/api/v1/auth/refresh');
      if (!r.ok) {
        setSession(null);
        return r;
      }
      return toSession(r);
    },
    logout: async () => {
      const token = current;
      if (token) await request('POST', '/api/v1/auth/logout', { auth: true });
      setSession(null);
    },
    me: () => authed<PasswordMeRes>('GET', '/api/v1/auth/me'),
    deleteAccount: async () => {
      const r = await authed<null>('DELETE', '/api/v1/auth/me');
      if (r.ok) setSession(null);
      return r;
    },
    exportData: () => authed<PasswordExportRes>('GET', '/api/v1/auth/me/export'),
    dispose: () => {
      if (timer !== null) deps.clearTimeout(timer);
      timer = null;
    },
  };
  return api;
}
