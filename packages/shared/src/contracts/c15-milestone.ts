/**
 * C15 1.1: milestone file and acceptance-criterion format (spec/domains/13-qa.md section 4.1, DL-214).
 * Pure types and constants; consumed by tools/ci/milestone-lint.ts and tools/ci/trace.ts.
 */
export const C15_VERSION = '1.1.0';
export const MILESTONE_ID_RE = /^M\d{2}(?:[a-z]\d?)?$/; // DL-037: letter = scope, digit = session split
export const MILESTONE_HEADINGS = [
  'Goal',
  'Requirements',
  'Depends on',
  'Scope in',
  'Scope out',
  'Deliverables',
  'Interfaces',
  'Acceptance criteria',
  'Test plan',
  'Demo script',
  'Effort',
  'Risks & fallbacks',
  'Notes for the Builder',
] as const;
export type MilestoneStatus = 'PENDING' | 'READY' | 'frozen'; // recorded in spec/07-milestones/README.md
export type OracleKind =
  | 'unit'
  | 'golden'
  | 'state-hash'
  | 'replay'
  | 'bot-run'
  | 'e2e'
  | 'workers'
  | 'db'
  | 'static-gate'
  | 'perf-cpu'
  | 'staging'
  | 'ops'
  | 'load'
  | 'device-perf'
  | 'device-check';
export type Evidence = 'implemented' | 'tested' | 'seen-on-device' | 'unverified';
export interface CommandProof {
  kind: 'command';
  /** Each starts with `pnpm ` after optional `env -u VAR ...` or `VAR=value` prefixes. */
  commands: string[];
  /** Explicit `[oracle: x]` suffix, else inferred (13-qa section 4.2). */
  oracle: OracleKind;
  /** Secret env var names or `staging`; absent = runs offline in a clean checkout. */
  needs?: string[];
}
export interface ManualProof {
  kind: 'manual';
  /** 'desktop browser' | 'operator workstation' | 'iPhone 15...' | 'Quest 3...' | 'Vision Pro...' | 'desktop <class>' */
  device: string;
  steps: string;
  /** tools/ci/checklists/<M##>-<device>.json */
  checklist?: string;
  /** Commands run on the uploaded output, e.g. `pnpm perf:verify -- perf.json --tier mobile-low`. */
  followUp?: string[];
  /** UNVERIFIED ids this run records (never asserted). */
  records?: string[];
}
export interface AcceptanceCriterion {
  id: `AC-${number}`;
  given: string;
  when: string;
  then: string;
  proof: CommandProof | ManualProof;
}
export interface MilestoneDoc {
  id: string;
  slug: string;
  requirements: { rid: string; clause: string }[];
  dependsOn: string[];
  contracts: { id: `C${number}`; version: string }[];
  acs: AcceptanceCriterion[];
  /** As READY files write it. */
  effort: { sessions: number; files: number; risk: 'low' | 'low-medium' | 'medium' | 'medium-high' | 'high' };
}
