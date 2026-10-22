import type { CompiledSoul, NPCDialogueContext, PlayerIntent } from '@dv/shared/contracts/c10-npc';
import type { NpcTurnOutput } from '@dv/shared/npc';

/**
 * Types of the in-character evaluation harness (04-npc-builder.md section C6, M06a4). The harness is pure over its ports: the soul, the rules
 * block, the suites and the recordings are handed in by `tools/soul/src/eval.ts`, which owns the file system and the network.
 */
export type SuiteName = 'redteam' | 'golden' | 'probes';
export type EvalMode = 'replay' | 'live' | 'record';

/** What the harness needs of a compiled soul: block B exactly as the Worker sends it, and the compiled facts the checks read. */
export interface EvalSoul {
  id: string;
  /** `soul.prompt.txt` bytes (block B). */
  promptB: string;
  compiled: CompiledSoul;
  /** The public persona the judge sees. */
  persona: { name: string; shortBio: string; register: string[]; lexicon: string[]; catchphrases: string[]; avoid: string[] };
}

/** The reply a synthetic recording carries for a turn: a full `npc-turn-1.0` object, or a name of one of the soul's stock lines. */
export type ReplyDef = ('deflect' | 'ai' | 'care' | 'greet') | Partial<NpcTurnOutput>;

export interface Expect {
  /** The action must be `none`. */
  actionNone?: boolean;
  /** `end_conversation` must be true. */
  endConversation?: boolean;
  /** The line must admit it is an AI character and not deny it. */
  admitsAi?: boolean;
  /** Regular expressions (case-insensitive) the line must not match. */
  mustNotMatch?: string[];
  /** Regular expressions (case-insensitive) the line must match. */
  mustMatch?: string[];
}

export interface TurnDef {
  say: { text?: string; intent?: PlayerIntent };
  /** Fields of the scene context to override (offers, events, mode, relation ...). */
  context?: Partial<NPCDialogueContext>;
  reply?: ReplyDef;
  expect?: Expect;
}

export interface ProbeDef {
  id: string;
  category: string;
  say: { text?: string; intent?: PlayerIntent };
  context?: Partial<NPCDialogueContext>;
  reply: ReplyDef;
  expect?: Expect;
}

export interface RedteamFile {
  schema: 'npc-evals-redteam/1';
  probes: ProbeDef[];
}

export interface ProbesFile {
  schema: 'npc-evals-builder-probes/1';
  probes: ProbeDef[];
}

export interface ConversationDef {
  id: string;
  turns: TurnDef[];
}

export interface GoldenFile {
  schema: 'npc-evals-golden/1';
  npc: string;
  /** The soul's stock replies: used for every probe of the shared suites in synthetic recordings. */
  lines: { deflect: string; ai: string; care: string; greet: string };
  /** Place names the soul must not mention (districts other than its own). */
  outside: string[];
  /** Words and phrases of the soul's forbidden topics that a line must not contain. */
  forbidden: string[];
  /** Default scene context of the soul's conversations (offers it can make). */
  context?: Partial<NPCDialogueContext>;
  conversations: ConversationDef[];
}

export interface Suites {
  redteam: ProbeDef[];
  probes: ProbeDef[];
  golden: Map<string, GoldenFile>;
}

/** One stored model answer. `synthetic: true` marks a hand-written one (the harness never claims it came from a model). */
export interface Recording {
  label: string;
  synthetic: boolean;
  model: string;
  /** The `npc-turn-1.0` object the model answered, or the raw text when it was not JSON. */
  response: unknown;
  recordedAt?: string;
}

export interface RecordingFile {
  schema: 'npc-eval-recordings/1';
  npcId: string;
  entries: Record<string, Recording>;
}

export interface RecordingStore {
  get(npcId: string, key: string): Recording | undefined;
  put(npcId: string, key: string, rec: Recording): void;
}

/** The model call of `--live` and `--record`: one non-streamed Messages request. Null when the call failed. */
export interface ModelPort {
  complete(body: Record<string, unknown>): Promise<{ text: string; model: string } | null>;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  /** Why it failed (never the player's or the model's text beyond a short excerpt of the line). */
  detail?: string;
  /** True for a check that could not run (no real-name list mounted). */
  skipped?: boolean;
}

export interface TurnReport {
  suite: SuiteName;
  /** `redteam/rt01`, `golden/g03#1`. */
  id: string;
  category: string;
  /** Request body hash: the key of the recording. */
  key: string;
  source: 'recording' | 'synthetic-recording' | 'model';
  line: string;
  checks: CheckResult[];
  ok: boolean;
  judge?: JudgeScores;
}

export interface JudgeScores {
  in_voice: number;
  rails: number;
  no_real_person_claims: number;
  action_plausible: number;
  scene_consistent: number;
}

export interface ConversationReport {
  id: string;
  turns: number;
  /** Lines that used a lexicon term or catchphrase. */
  lexiconLines: number;
  lexiconOk: boolean;
  /** Golden expectations of the conversation: [passed, total]. */
  expectations: [number, number];
}

export interface SuiteReport {
  suite: SuiteName;
  turns: number;
  deterministicOk: number;
  failures: { id: string; check: string; detail: string }[];
  conversations?: ConversationReport[];
  /** Golden: share of expectations that held, 0..1. */
  goldenExpectationRate?: number;
}

export interface GateReport {
  name: string;
  pass: boolean;
  value: string;
  /** `blocking` gates change the exit code; `report` gates are printed only (judge gates before M10c). */
  kind: 'blocking' | 'report';
}

export interface SoulReport {
  npcId: string;
  mode: EvalMode;
  synthetic: boolean;
  suites: SuiteReport[];
  gates: GateReport[];
  judge: { ran: boolean; reason?: string; turns?: number; means?: Partial<JudgeScores> };
  ok: boolean;
}

export interface RunReport {
  run: string;
  mode: EvalMode;
  souls: SoulReport[];
  ok: boolean;
  exitCode: 0 | 1;
}
