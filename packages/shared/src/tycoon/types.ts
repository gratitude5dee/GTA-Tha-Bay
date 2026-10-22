/**
 * Business Tycoon state, commands and results (08-tycoon.md sections 4.2 to 4.5, verbatim where the spec gives a shape).
 * Additions beyond the spec text are recorded as BD rows (BD-M09a1-01 ...): `CompanyState.awaiting`, `MeetingState`, `CommandError`.
 * Money is integer cents; percentages are 0..100 except finance (basis points); time is in weeks (`week` starts at 0).
 */
import type { CapTable, Cents, RoundKind, Terms } from './finance/types.ts';
import type { FinanceConfig, TermSheetEnvelope, VcProfile } from './finance/envelope.ts';

export type { Cents, RoundKind, Terms, CapTable };
export type LocKey = string;
export type SectorId = 'b2b-saas' | 'consumer-app' | 'ai-tooling' | `mod:${string}`;
export type ThesisId = string;
export type RoleId = 'eng' | 'design' | 'growth' | 'sales' | 'ops';
export const ROLES: readonly RoleId[] = ['eng', 'design', 'growth', 'sales', 'ops'];
export type Phase = 'idea' | 'mvp' | 'launched' | 'ended';
export type FounderArchetype = 'engineer' | 'hustler' | 'designer';

export interface Employee {
  id: string;
  role: RoleId | 'founder';
  skill: number;
  salaryYr: Cents;
  optionShares: number;
  hiredWeek: number;
  morale: number;
  name: LocKey | string;
}
export interface Candidate {
  id: string;
  role: RoleId;
  skill: number;
  askYr: Cents;
  expiresWeek: number;
}
export interface PendingOffer {
  candidateId: string;
  salaryYr: Cents;
  optionBp: number;
  resolveWeek: number;
}
export interface Board {
  seats: ('founder' | 'independent' | `vc:${string}`)[];
  founderControl: boolean;
  missedTargets: number;
  nextMeetingWeek: number | null;
  lastTargetArrGrowth: number;
}

export type AwaitingKind = 'event' | 'meeting' | 'board' | 'bridge' | 'exitOffer';

export type MeetingPhase = 'offer' | 'closing' | 'closed' | 'withdrawn' | 'passed';
export interface MeetingState {
  id: string;
  raiseId: string;
  vcId: string;
  kind: RoundKind;
  phase: MeetingPhase;
  /** 0..100; the stub holds 50. */
  mood: number;
  startedWeek: number;
  envelope: TermSheetEnvelope | null;
  /** The terms on the table (the envelope midpoint in M09a1). */
  offer: Terms | null;
  /** Set when the offer was accepted: the week the money arrives and the table changes. */
  closeWeek: number | null;
  clamped: string[];
}
export interface RaiseProcess {
  id: string;
  kind: RoundKind;
  targetCents: Cents;
  startedWeek: number;
  meetingsHeld: number;
  vcPool: string[];
}
export interface EventState {
  /** Next event instance id; the event engine arrives in M09a2. */
  nextIid: number;
}

export interface RunSetup {
  seed: number;
  sector: SectorId;
  thesis: ThesisId;
  founder: FounderArchetype;
  coFounder: boolean;
  startWeekOfYear: number;
  hardcore: boolean;
  preset: 'standard' | 'mini8w' | 'daily';
  contentVersion: string;
  balanceVersion: string;
}

export interface CompanyState {
  v: 1;
  setup: RunSetup;
  week: number;
  phase: Phase;
  /** BD-M09a1-01: what the clock waits for; null = the next week may run. */
  awaiting: AwaitingKind | null;
  cash: Cents;
  users: number;
  payingUsers: number;
  mrr: Cents;
  arpuMonth: Cents;
  churnMonthly: number;
  cac: Cents;
  marketing: Cents;
  priceLevel: 'low' | 'standard' | 'premium';
  mvpProgress: number;
  featurePoints: number;
  productQuality: number;
  techDebt: number;
  hype: number;
  reputation: number;
  climate: number;
  morale: number;
  founderMorale: number;
  allocation: { features: number; refactor: number; infra: number };
  focus: 'product' | 'growth' | 'rest';
  crunch: boolean;
  office: 'garage' | 'cowork' | 'loft' | 'tower';
  team: Employee[];
  market: Candidate[];
  offers: PendingOffer[];
  capTable: CapTable;
  meetings: MeetingState[];
  termSheets: TermSheetEnvelope[];
  raise: RaiseProcess | null;
  board: Board;
  events: EventState;
  flags: Record<string, number | boolean>;
  mrrHistory: Cents[];
  profitableStreak: number;
  negativeCashWeeks: number;
  dividendEarnedCents: Cents;
  result: RunResult | null;
}

export type EndKind = 'acquisition' | 'unicorn' | 'ipo' | 'ramen' | 'insolvent' | 'ousted' | 'burnout' | 'quit' | 'miniWin' | 'miniLose';
export interface RunResult {
  kind: EndKind;
  win: boolean;
  week: number;
  founderPayoutCents: Cents;
  exitValueCents: Cents;
  score: number;
  tier: 'acq' | 'unicorn' | 'ipo' | 'ramen' | null;
  arrCents: Cents;
  headcountAtEnd: number;
  legacyTags: number;
  stateHash: string;
}

export type Command =
  | { t: 'setAllocation'; features: number; refactor: number; infra: number }
  | { t: 'setMarketing'; perWeek: Cents }
  | { t: 'setPrice'; level: CompanyState['priceLevel'] }
  | { t: 'setFocus'; focus: 'product' | 'growth' | 'rest' }
  | { t: 'setCrunch'; on: boolean }
  | { t: 'setOffice'; tier: CompanyState['office'] }
  | { t: 'hireOffer'; candidateId: string; salaryYr: Cents; optionBp: number }
  | { t: 'fire'; employeeId: string }
  | { t: 'startRaise'; kind: RoundKind; targetCents: Cents }
  | { t: 'scheduleMeeting'; vcId: string }
  | { t: 'answerQuestion'; meetingId: string; questionId: string; optionId: string }
  | { t: 'askMore'; meetingId: string; field: 'preMoney' | 'amount' | 'pool' | 'board' }
  | { t: 'counter'; meetingId: string; terms: Terms }
  | { t: 'bringCompetitor'; meetingId: string; termSheetId: string }
  | { t: 'accept'; meetingId: string }
  | { t: 'walk'; meetingId: string }
  | { t: 'sleepOnIt'; meetingId: string }
  | { t: 'vcSpoke'; meetingId: string; turnIx: number; emotion: string; proposal?: Terms; lineKey?: string }
  | { t: 'resolveEvent'; iid: number; choiceId: string }
  | { t: 'boardVote'; motion: 'approveBudget' | 'ignore' }
  | { t: 'exploreSale' }
  | { t: 'goPublic' }
  | { t: 'acceptExit'; iid: number }
  | { t: 'bridge'; accept: boolean }
  | { t: 'endRun'; reason: 'quit' };

export interface ChoiceRecord {
  week: number;
  seq: number;
  cmd: Command;
}

export type CommandErrorCode =
  | 'PHASE'
  | 'ENDED'
  | 'AWAITING'
  | 'ALLOCATION_SUM'
  | 'ALLOCATION_RANGE'
  | 'MARKETING_CAP'
  | 'OFFICE_LOCKED'
  | 'NO_CANDIDATE'
  | 'NO_EMPLOYEE'
  | 'POOL_EXHAUSTED'
  | 'OFFER_RANGE'
  | 'RAISE_ACTIVE'
  | 'RAISE_SPACING'
  | 'RAISE_TARGET'
  | 'NO_RAISE'
  | 'NO_VC'
  | 'MEETING_LIMIT'
  | 'NO_MEETING'
  | 'MEETING_STATE'
  | 'SAFE_STACK_LIMIT'
  | 'TERMS_INFEASIBLE'
  | 'NOT_AWAITING'
  | 'NO_BUYER'
  | 'NO_OFFER'
  | 'IPO_CLOSED'
  | 'NOT_AVAILABLE';
export interface CommandError {
  code: CommandErrorCode;
  detail?: string;
}
export type CommandResult = { ok: true } | { ok: false; error: CommandError };

export interface StepResult {
  week: number;
  events: never[];
  awaiting: AwaitingKind | null;
  ended: RunResult | null;
}

// ---------------------------------------------------------------------------------------------------------------- content

export interface SectorDef {
  id: SectorId;
  nameKey: LocKey;
  tam: number;
  cac0Cents: Cents;
  arpuMonthCents: Cents;
  payRate: number;
  churn0: number;
  k: number;
  infraPerUserWeekCents: Cents;
  mvpPoints: number;
  featureHalf: number;
  multiple: number;
  hypeSensitivity: number;
  tags: string[];
}

/** A trend-deck card: multipliers applied for the whole run (all default to 1). */
export interface ThesisDef {
  id: ThesisId;
  nameKey: LocKey;
  mods: Partial<Record<'cacMul' | 'churnMul' | 'payRateMul' | 'arpuMul' | 'devPowerMul' | 'burnMul' | 'multipleMul', number>>;
}

export interface VcDef extends VcProfile {
  /** Stages this fund invests in. */
  stages: RoundKind[];
}

export interface ArchetypeDefs {
  founders: Record<FounderArchetype, { devPower: number; hustle: number; qualityBonus: number; cacMul: number; fundraisingMood: number }>;
  roleBaseYrCents: Record<RoleId, Cents>;
  names: { first: string[]; last: string[] };
  vcs: VcDef[];
}

export interface Balance {
  schema: 'tycoon.balance.v1';
  sim: { ticksPerWeek: { x1: number; x2: number; x4: number }; boardIntervalWeeks: number; maxEmployees: number };
  setup: { startCashCents: Cents; founderSalaryYrCents: Cents; founderMorale: number; teamMorale: number; reputation: number; hype: number; climateSpread: number; allocation: { features: number; refactor: number; infra: number } };
  company: {
    cofounderDev: number;
    engWeight: number;
    designWeight: number;
    moraleBase: number;
    moraleSlope: number;
    moraleRef: number;
    crunchMul: number;
    raiseFocus: number;
    opsPerHeads: number;
    opsPenalty: number;
    priceMul: { low: number; standard: number; premium: number };
    launchHype: number;
    launchUsers: number;
    qualityRate: number;
    debtFeature: number;
    debtRefactor: number;
    debtQualityStart: number;
    debtQualityWeight: number;
    cacGrowthSkill: number;
    cacGrowthCap: number;
    cacSaturation: number;
    churnOpsSkill: number;
    churnOpsCap: number;
    churnPriceWeight: number;
    payQualityBase: number;
    paySalesSkill: number;
    payPriceWeight: number;
    infraReduction: number;
    infraFullAlloc: number;
    office: Record<CompanyState['office'], Cents>;
    officeUnlock: Record<CompanyState['office'], number>;
    hypeMean: number;
    hypeRate: number;
    reputationUp: number;
    reputationDown: number;
    climateDecay: number;
    marketingCapMul: number;
    marketingCapCashDiv: number;
    monthWeeks: number;
  };
  valuation: { growthWeight: number; growthMin: number; growthMax: number; minOldMrrCents: Cents; hypeBase: number; hypeDiv: number; climateWeight: number; floorBaseCents: Cents; floorHypeBase: number; floorLaunchMul: number };
  hiring: {
    perRolePerWeek: number;
    poolPerRole: number;
    expiryWeeks: number;
    appearP: number;
    skillMean: number;
    skillSd: number;
    reputationDiv: number;
    askBase: number;
    askSlope: number;
    askClimate: number;
    offerMinWeeks: number;
    offerSpanWeeks: number;
    accept: { base: number; salarySlope: number; optionCap: number; optionDiv: number; reputationDiv: number; min: number; max: number };
    vestWeeks: number;
    cliffWeeks: number;
    moraleRevert: number;
    moraleCrunch: number;
    moraleFire: number;
    moraleLayoff: number;
    moraleDownRound: number;
    attritionBelow: number;
    attritionRate: number;
    severanceWeeks: number;
    fireShare: number;
    fireWindowWeeks: number;
    fireReputation: number;
  };
  founder: { crunch: number; rest: number; roundClose: number };
  board: {
    targets: { seed: number; a: number; b: number; c: number };
    ignoreReputation: number;
    oust: { perMiss: number; reputation: number; downRound: number; max: number };
  };
  end: {
    acquisitionMinCents: Cents;
    unicornPostMoneyCents: Cents;
    ipoArrCents: Cents;
    ramenArrCents: Cents;
    ramenWeeks: number;
    insolvencyWeeks: number;
    bridgeBurnWeeks: number;
    bridgeDiscountBp: number;
    bridgeMinCents: Cents;
    retainedEmployeeScore: number;
    legacyTagScore: number;
    scoreCentsDiv: number;
    legacyTagMax: number;
  };
  raise: { spacingWeeks: number; maxMeetings: number; closeWeeks: number; focusWeeksBase: number };
  finance: FinanceConfig;
  events: Record<string, never>;
  hardcore: { eventMul: number; chequeMul: number };
}

export interface TycoonContent {
  sectors: Record<string, SectorDef>;
  theses: ThesisDef[];
  archetypes: ArchetypeDefs;
  balance: Balance;
  contentVersion: string;
  balanceVersion: string;
}

export type { FinanceConfig, TermSheetEnvelope, VcProfile };
