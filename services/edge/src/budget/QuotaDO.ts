import { DurableObject } from 'cloudflare:workers';

/**
 * Per-player and per-net quota Durable Object (`q:p:<pid>`, `q:n:<netHash>`, spec/domains/09-backend-ops.md section 5.3). This commit is
 * the class skeleton and the `web-v2` migration tag only (M06a1 lifecycle change); the logic follows in the next commit.
 */
export class PlayerQuotaDO extends DurableObject {}
