import { NPC_GUARDRAILS, type Tier } from '@dv/shared';
import { playerQuota } from '../budget/quota.ts';
import type { Env } from '../env.ts';

/**
 * Builder limits (04-npc-builder.md section C1, `config/guardrails.yaml` `npc.builder.*`; M06b1):
 *  - live drafts: 3 for P0 and P1, 10 linked (counted by the database when a draft is created);
 *  - soul generations: 1 per draft per hour and 2 per day (10 linked), as `builder_text` reservations of PlayerQuotaDO;
 *  - preview turns: 20 per draft per day, a scoped counter of the same object.
 * A refusal here happens before any model call.
 */
const B = NPC_GUARDRAILS.builder;

export const liveDraftLimit = (tier: Tier): number => (tier === 'linked' ? B.liveDraftsLinked : B.liveDraftsP0);
export const soulsPerDay = (tier: Tier): number => (tier === 'linked' ? NPC_GUARDRAILS.quotas.linked.builderText : NPC_GUARDRAILS.quotas.p0.builderText);
export const PREVIEW_COUNTER = 'builder_preview';
export const previewTurnsPerDay = B.previewTurnsPerDraftPerDay;

export type SoulReservation = { ok: true; reservationId: string } | { ok: false };

/** Reserves one soul generation for the draft. Refused when the day's count is spent or the draft generated within the hour. */
export async function reserveSoulGeneration(env: Pick<Env, 'QUOTA'>, pid: string, tier: Tier, draftId: string): Promise<SoulReservation> {
  const r = await playerQuota(env, pid).reserve({ kind: 'builder_text', npcId: draftId, estMicros: NPC_GUARDRAILS.estimates.builderTextUsdMicros, tier });
  return r.ok ? { ok: true, reservationId: r.reservationId } : { ok: false };
}

/** Counts one preview turn of the draft today. */
export async function takePreviewTurn(env: Pick<Env, 'QUOTA'>, pid: string, draftId: string): Promise<boolean> {
  return (await playerQuota(env, pid).takeScoped(PREVIEW_COUNTER, draftId, previewTurnsPerDay)).ok;
}

/** `DraftView.limits`: what the draft can still do today. */
export async function limitsLeft(env: Pick<Env, 'QUOTA'>, pid: string, tier: Tier, draftId: string): Promise<{ soulGenerationsLeft: number; previewTurnsLeft: number }> {
  const u = await playerQuota(env, pid).builderUsage(draftId);
  return {
    soulGenerationsLeft: u.hourTaken ? 0 : Math.max(0, soulsPerDay(tier) - u.soulToday),
    previewTurnsLeft: Math.max(0, previewTurnsPerDay - u.previewToday),
  };
}
