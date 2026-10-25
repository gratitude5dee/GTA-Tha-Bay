/**
 * What the dialogue panel may offer, switched by milestones that land later (M06a5). `reports` is false until route 41 (`POST /api/v1/reports`)
 * exists: M06b2 sets it, and the report control in the panel then renders (spec/05 route 41 note).
 */
export interface DialogueCapabilities {
  /** The Report control shows only when this is true. */
  reports: boolean;
}

export const dialogueCapabilities: DialogueCapabilities = { reports: false };

export function setDialogueCapabilities(patch: Partial<DialogueCapabilities>): void {
  Object.assign(dialogueCapabilities, patch);
}

/** C12 1.1 `ReportReq`, client side only (09-backend-contracts.md): the panel posts it to route 41 through an injected client. */
export type ReportCategory =
  | 'child_safety'
  | 'intimate_image'
  | 'real_person_likeness'
  | 'copyright'
  | 'harassment_hate'
  | 'violence_threat'
  | 'self_harm'
  | 'spam_scam'
  | 'other';

export interface ReportReq {
  target: { kind: 'chat_turn'; id: string };
  category: ReportCategory;
  note?: string;
}

/** The API client the panel reports through. The app injects the real one when M06b2 turns `reports` on. */
export interface DialogueReportClient {
  report(req: ReportReq): Promise<void>;
}

/** The categories the panel offers for a line of an NPC, in menu order. */
export const DIALOGUE_REPORT_CATEGORIES: readonly ReportCategory[] = [
  'harassment_hate',
  'violence_threat',
  'self_harm',
  'real_person_likeness',
  'child_safety',
  'other',
];

/** `enc:<npcId>:<encounterId>:<turnIndex>`, which keeps NPC turns apart from room chat lines `room:<roomId>:<evSeq>` (DL-543). */
export function chatTurnId(npcId: string, encounterId: string, turnIndex: number): string {
  return `enc:${npcId}:${encounterId}:${turnIndex}`;
}

export function reportRequest(npcId: string, encounterId: string, turnIndex: number, category: ReportCategory): ReportReq {
  return { target: { kind: 'chat_turn', id: chatTurnId(npcId, encounterId, turnIndex) }, category };
}
