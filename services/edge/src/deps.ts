/**
 * Dependencies the account handlers take by injection (M00e, DL-611): tests pass a stub admin path, a clock and a log
 * sink; production code uses `defaultDeps()` and never overrides `ADMIN_PATH`.
 */

/** Which Supabase Auth admin calls are recorded as verified in spec/03 section 7 (U-ACCT-3, U-ACCT-6). */
export interface AdminPath {
  /** Create a user with app-level metadata in the same call. */
  create: boolean;
  /** Update a user's app-level metadata. */
  updateMeta: boolean;
  /** Read and delete one user. */
  getDelete: boolean;
}

export interface AppDeps {
  adminPath: AdminPath;
  /** One log line. Never receives a password, token, username or network address. */
  log: (line: string) => void;
  /** Logs `line` the first time `key` is seen for this app instance (once per isolate in production). */
  logOnce: (key: string, line: string) => void;
  /** Epoch ms. */
  now: () => number;
}

export function makeDeps(adminPath: AdminPath, overrides: Partial<Omit<AppDeps, 'adminPath'>> = {}): AppDeps {
  const log = overrides.log ?? ((line: string) => console.log(line));
  const seen = new Set<string>();
  return {
    adminPath,
    log,
    logOnce:
      overrides.logOnce ??
      ((key, line) => {
        if (seen.has(key)) return;
        seen.add(key);
        log(line);
      }),
    now: overrides.now ?? (() => Date.now()),
  };
}
