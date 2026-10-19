/**
 * Which deploy path a push takes (spec/domains/09-backend-ops.md section 2, step 3; CI-R03).
 *
 * A Durable Object lifecycle change (migrations / durable_objects / exports in a wrangler.jsonc) cannot be uploaded as a
 * version, so it must go through `wrangler deploy`. On a pull request the label `do-lifecycle` says so; on a push to main
 * (and on a tag or manual run) there is no label, so the decision is taken from the commits being deployed: the same
 * `check:do-migrations` evaluation, run over `<previously deployed commit>..HEAD`.
 *
 * This module is pure: git and the evaluation are injected, so the decision is tested without a repository.
 */

export interface GitResult {
  status: number;
  out: string;
}
export type GitRun = (args: readonly string[]) => GitResult;

export interface DecideInputs {
  /** `--do-lifecycle` or DV_DO_LIFECYCLE=1: the pull-request label path; no detection. */
  explicit: boolean;
  /** `--auto-lifecycle`: decide from the commits being deployed. */
  auto: boolean;
  /** `--base` / DV_DEPLOY_BASE: a ref to compare against, chosen by the operator. */
  base?: string | undefined;
  /** `github.event.before` of a push; all zeros on the first push of a branch. */
  eventBefore?: string | undefined;
  /** GITHUB_REF_TYPE: `tag` for a production tag. */
  refType?: string | undefined;
  /** GITHUB_EVENT_NAME. */
  eventName?: string | undefined;
}

export type BaseSource = 'explicit' | 'event-before' | 'previous-tag' | 'parent';

export interface BaseChoice {
  base: string;
  source: BaseSource;
}

export interface Decision {
  doLifecycle: boolean;
  base?: string;
  source: BaseSource | 'label' | 'off';
  reason: string;
}

const ZERO_SHA = /^0{7,64}$/;

function isCommit(git: GitRun, ref: string): boolean {
  return git(['cat-file', '-e', `${ref}^{commit}`]).status === 0;
}

/**
 * The commit to compare HEAD with. Order: the operator's base, the push's `before` when it is a real commit, the previous
 * `v*` tag (tag and manual production runs), the parent of HEAD. Null when nothing is available (a root commit).
 */
export function resolveBase(inp: Pick<DecideInputs, 'base' | 'eventBefore' | 'refType' | 'eventName'>, git: GitRun): BaseChoice | null {
  const explicit = inp.base?.trim();
  if (explicit) {
    if (!isCommit(git, explicit)) throw new Error(`--base ${explicit} is not a commit in this checkout (fetch it; actions/checkout fetch-depth: 0)`);
    return { base: explicit, source: 'explicit' };
  }
  const before = inp.eventBefore?.trim();
  if (before && !ZERO_SHA.test(before) && isCommit(git, before)) return { base: before, source: 'event-before' };
  if (inp.refType === 'tag' || inp.eventName === 'workflow_dispatch') {
    const tag = git(['describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD^']);
    const name = tag.out.trim();
    if (tag.status === 0 && name) return { base: name, source: 'previous-tag' };
  }
  if (isCommit(git, 'HEAD^')) return { base: 'HEAD^', source: 'parent' };
  return null;
}

/**
 * The deploy path. `lifecycleIn(base)` reports whether `base..HEAD` holds a Durable Object lifecycle change (the
 * `check:do-migrations` verdict's `lifecycle`; a range that also holds runtime changes still needs `wrangler deploy`, so
 * `ok` is not consulted).
 */
export function decideDoLifecycle(inp: DecideInputs, git: GitRun, lifecycleIn: (base: string) => boolean): Decision {
  if (inp.explicit) return { doLifecycle: true, source: 'label', reason: 'do-lifecycle was requested (pull-request label)' };
  if (!inp.auto) return { doLifecycle: false, source: 'off', reason: 'no lifecycle detection requested' };
  const choice = resolveBase(inp, git);
  if (!choice) {
    if (git(['rev-parse', '--is-shallow-repository']).out.trim() === 'true') {
      throw new Error('shallow checkout and no previous commit to compare with: use actions/checkout with fetch-depth: 0');
    }
    return { doLifecycle: false, source: 'off', reason: 'no previous commit (root commit): versions path' };
  }
  const lifecycle = lifecycleIn(choice.base);
  return {
    doLifecycle: lifecycle,
    base: choice.base,
    source: choice.source,
    reason: lifecycle
      ? `Durable Object lifecycle change in ${choice.base}..HEAD (${choice.source}): wrangler deploy`
      : `no Durable Object lifecycle change in ${choice.base}..HEAD (${choice.source}): versions upload`,
  };
}
