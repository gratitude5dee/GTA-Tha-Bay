import { DurableObject } from 'cloudflare:workers';

/**
 * Per-conversation Durable Object (`enc:<pid>:<npcId>:<encounterId>`, spec/domains/09-backend.md section 3.2). This commit is the
 * class skeleton and the `web-v2` migration tag only (M06a1 lifecycle change, 09-backend-ops.md section 1.2); the logic follows in the next commit.
 */
export class EncounterDO extends DurableObject {}
