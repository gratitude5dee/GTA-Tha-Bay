// Types the `env` of `cloudflare:test` (and any `Cloudflare.Env` consumer) with the Worker's own bindings.
import type { Env as WorkerEnv } from './env.ts';

declare global {
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- an alias that adds nothing
    interface Env extends WorkerEnv {}
  }
}
