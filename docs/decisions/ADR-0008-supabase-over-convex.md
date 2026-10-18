# ADR-0008 — Supabase over Convex for persistence

**Status:** accepted (gated decision G1, default applied 2026-10-18) · **Date:** 2026-10-18 · **Decides:** spec/03 D-02

## Context
Saves, identity, NPC memory, moderation, forum, mods and leaderboards need a system of record. Realtime game sockets are separate (Durable Objects, ADR-0004). The target players and the SF-first world sit in the Bay Area, so database region matters for tail latency. Single-player must work with no account (R-ROLL-01), so the database arrives late (M05d).

## Options considered
| | Supabase | Convex |
|---|---|---|
| Region | `us-west-1` (N. California) selectable [F-030] | no US West; region fixed at creation [F-033] |
| Data shape | Postgres, RLS, pgvector, full-text search | document store, vector index with 4 indexes per table and ≤ 256 results |
| Auth fit | Custom OIDC providers on Pro; third-party JWT with `kid` and `role` [F-031] | `customJwt` RS256 or ES256 [F-033] |
| Price | Pro $25 plus compute; 100 k MAU included then $0.00325 [F-029] | Professional about $25 per developer (secondary source) |
| Lock-in | standard Postgres | proprietary runtime (FSL-Apache self-host) |

Cost is at parity within a few dollars, so it does not decide. Convex's reactivity would help a forum feed but adds a second backend for little volume. Neither suits 20 Hz movement (ADR-0004). Hyperdrive reach to Supabase is UNVERIFIED (U-BE-7) and not used.

## Decision
- **G1: Supabase Pro in `us-west-1`** for production; a Free project for staging with a keep-alive, because Free projects pause after a week idle [research/stack-cloudflare-backend.md §2; Q-BE-03]. Durable Objects hold everything realtime.
- **`DataPort` rule.** The client never imports `supabase-js` except in an auth module (and with the Worker-hosted issuer, ADR-0009, that exception is only the anonymous fallback). All data flows through `/api/v1/*`; the Worker uses `supabase-js` with the caller's JWT so RLS stays a second line of defence, and a server key (`sb_secret_…`; legacy keys end with 2026 [F-032]) for set-based work. `packages/shared/src/data-port.ts` defines the port; one Supabase implementation plus an `InMemoryDataPort` for tests.
- **Portability rules.** UUIDv7 keys minted in the Worker, epoch-millisecond times, JSON-Schema-validated payloads shared from `@dv/shared`, and no Postgres-only features (triggers, RPC) in core game paths; they are allowed in forum and moderation.
- **Pins.** `@supabase/supabase-js` as resolved by pnpm (2.118.0 on 2026-10-18 [F-016]).

## Switch cost (Supabase → Convex, if the `DataPort` rule held)
| Work item | Sessions |
|---|---|
| Port the `DataPort` implementation (about 10 tables, 40 methods) | 2–3 |
| Auth: Convex `customJwt` trusting our issuer JWKS (kept) | 0.5 |
| RLS policies become explicit checks plus tests | 1 |
| Data migration, verification, dual-run compare | 1 |
| pgvector to Convex vector index | 0.5 |
| Leaderboard and moderation SQL to indexed queries | 0.5–1 |
| **Total** | **≈ 5–7 sessions plus a maintenance window; rooms and DOs untouched** |
If client code calls `supabase-js` directly, add about 4–6 sessions. The reverse switch costs about the same [research/stack-cloudflare-backend.md §8].

## Consequences
- (+) One relational store for six workloads; same-metro latency; pgvector for NPC memory (ADR-0023).
- (+) The OIDC issuer shrinks the auth part of any switch.
- (−) Supabase Pro adds a fixed $25 plus compute; Free staging may pause.
- (−) RLS plus Worker checks is two layers to keep in sync; `check:db` runs migrations and pgTAP tests in CI.
- (−) Convex seat prices are secondary-source only (medium confidence).

## Affected contracts and milestones
C12 (`DataPort`, routes, migrations 0001–0009), C05 (cloud-sync port), C16. M05d (data spine), M06a1 (memory tables), M06b2, M12a1 (cloud saves, RLS test), M12c, M13b1, M13d1.

## Links
`research/INDEX.md` §1.2, §7 G1; `research/stack-cloudflare-backend.md` §2–3, §8; `spec/domains/09-backend-db.md`; `spec/03-decisions-and-facts.md` D-02, §4; ADR-0009.
