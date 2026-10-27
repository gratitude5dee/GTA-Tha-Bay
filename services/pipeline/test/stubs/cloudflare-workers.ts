/**
 * Node stand-in for the `cloudflare:workers` module (vitest alias, M05c4): lets the pipeline scenarios construct the real CutsceneJobDO class
 * of services/edge over a fake `DurableObjectState`. Only what that class touches is here.
 */
export class DurableObject<E = unknown> {
  ctx: unknown;
  env: E;
  constructor(ctx: unknown, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkflowEntrypoint<E = unknown> {
  ctx: unknown;
  env: E;
  constructor(ctx: unknown, env: E) {
    this.ctx = ctx;
    this.env = env;
  }
}
