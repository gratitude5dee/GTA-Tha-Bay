# 10 — Cost model

> Wave 5, 2026-10-18. List prices checked 2026-10-18 [research/INDEX.md §6]. Binding: G3 (recurring ceiling $500/month), D-28 (three spend layers), DL-OWN-01 (fal.ai hard cap USD 100 total, `spec/11-decision-log.md` §Owner decisions). Code uses integer USD micros; this file uses USD. Usage assumptions are research proposals to re-measure after launch (U-COST-4).

## 1. Per-unit costs

| Unit | Cost | Source |
|---|---|---|
| Haiku 5.5 NPC turn (4.5K cached + 1K history + 0.7K new + 150 out) | $0.00028 | F-034; `04-npc-builder.md` §C7 |
| Sonnet 5.5 hero turn | $0.0050 | same |
| Encounter summary · intent call · embedding (200 tokens) | $0.0004 · $0.0001 · $0.0000024 | same; F-025 |
| Voice line (110 chars): Aura-1 (t1, default) · ElevenLabs Flash (t2, off, Q-20) · MeloTTS | $0.00165 · $0.0044 · $0.00002 | F-025, F-051 |
| NPC builder text path (soul + moderation + 20-turn preview) | ≈ $0.07 | `04-npc-builder.md` §C7 |
| Moderation: image semantics · backstory · forum post | ≈ $0.00025 · $0.0044 · $0.00029 | [research/gap-trust-safety-tooling.md §8] |
| Human review | 0.191 min per MAU-month at $25/h (assumption) | same; U-COST-4 |
| 16-player room-hour | ≈ $0.014 | [research/stack-cloudflare-backend.md §4.7] |
| Media request through the app Worker (DL-713): one Worker request ($0.30 per million) plus one R2 Class B read ($0.36 per million), each beyond 10 million a month included; about 300 requests per first City Hall boot (estimate) | $0.00000066 per request; ≈ $0.0002 per first boot | spec/03 §6 (2026-10-20); DL-713 |
| fal one-off: video $0.04–$0.10/s; Standard character $3.67; Lean $1.05; keyframe $0.0396 | §5, `06-asset-pipeline.md` §11 | F-039, F-040, F-044–F-046 |

## 2. Monthly recurring cost

Per MAU per month: 4 play-hours, 15 encounters, 90 NPC turns (20 % hero), about 90 intent calls, 45 voiced lines on t1, 0.267 uploaded images [research/ai-npc-runtime.md §7.2; research/gap-trust-safety-tooling.md §8].

| Line | 1k MAU | 10k MAU | 100k MAU | Basis |
|---|---|---|---|---|
| Cloudflare (Workers Paid, DO, R2, Queues, AE, logs) | $6 | $30 | $300 | [research/stack-cloudflare-backend.md §9] |
| Supabase Pro and compute | $25 | $30 | ≈ $95 | same |
| Thirdweb (from M14a) | $99 | $129 | $534 | F-059 |
| **Infrastructure** | **$130** | **$189** | **$929** | |
| NPC LLM, default mix (80 % Haiku, 20 % Sonnet), $0.125/MAU | $125 | $1,250 | $12,500 | §1 |
| NPC voice on t1, $0.074/MAU | $74 | $740 | $7,400 | §1 |
| fal generation in public play | $0 | $0 | $0 | internal-only (D-19) |
| Automated trust and safety | $0.35 | ≈ $6 | ≈ $72 | [research/gap-trust-safety-tooling.md §8] |
| **G3 spend** (LLM + voice + automated moderation) | **≈ $199** | **≈ $2,000** | **≈ $19,970** | |
| Human review | ≈ $80 | ≈ $800 | ≈ $7,960 | labour, outside G3 |
| **All-in** | **≈ $410** | **≈ $3,000** | **≈ $28,900** | |

Notes. The all-in figure is below `research/INDEX.md` §6 (≈ $430 / $3,190 / $31,000) because t2 hero voices stay off (Q-20). A Lean mix (all Haiku, baked voice only) costs $40 / $400 / $4,000 for LLM and voice together. Before M12b, Cloudflare plus Supabase is ≈ $30 / $35 / $110. Room duration dominates Cloudflare cost at scale (alert A08).

## 3. The G3 ceiling

The recurring ceiling is **$500/month ≈ $16.50/day**: Anthropic $350 ($11.67/day), voice $100 ($3.33/day), moderation $25 ($0.83/day), buffer $25. All values live in `config/guardrails.yaml`.

| Line | Per-MAU cost | MAU it carries | At 1k MAU |
|---|---|---|---|
| Anthropic $350 | $0.125 | ≈ 2,800 | 36 % |
| Voice $100 | $0.074 | ≈ 1,350 | 74 % |
| Moderation $25 | ≈ $0.0007 | ≈ 35,000 | 1 % |

The default mix fits at launch scale (≈ $199 of $500 at 1k MAU). The voice line binds first, at about 1,350 MAU. Beyond that, the owner either raises the ceiling or accepts degradation (Q-28). The scaling rule in `research/INDEX.md` §7 (+ $0.25 per MAU above 1k) would set the ceiling at $2,750 for 10k MAU and $25,250 for 100k, both above the forecast G3 spend. The default is to hold $500. Move Anthropic to the Build tier before about 2k MAU and to Scale before about 8k (F-037: Start caps at $500/month, Build at $1,000).

## 4. How the ceiling is enforced

Layers run from the player outward; outer layers are backstops (D-28) [research/gap-observability-cost-guardrails.md Rec 2].

1. **Per-player quotas** (`PlayerQuotaDO`, UTC day, reserve before the call and settle after). P0 and P1: 150 turns, 40 per NPC, 60 voiced lines, $0.05 cost cap. Linked 18+: 400 turns, 200 lines, $0.15. Per-net caps are 4× the P0 row. fal-backed builder jobs: 0; user cutscene generation: 0 (`09-backend-ops.md` §5.2, DL-OWN-01).
2. **`BudgetGovernorDO`** computes the level from spend as a share of each daily ceiling. Alarms at 50 % (info), 70 % (L1: Sonnet to Haiku), 85 % (L2: voice to the cheapest tier), 100 % (L3: new genAI stops). Cache hits, baked barks, ink lines, cached cutscenes and in-engine fallbacks are always served. The level goes to KV `gov:level` (read with a 30 s cache). KV is eventually consistent (about 60 s or more) [research/ai-npc-runtime.md, Verified facts], so `forceLevel(3)` and `reserve()` are the synchronous paths: fal and builder jobs call `reserve()` before every call, and `forceLevel(3)` is immediate.
3. **AI Gateway** (Anthropic only, BYOK): global daily rule at 1.0× the daily ceiling, $0.20 per player per day, Sonnet at 0.4×, each answering 429; the Worker re-issues a 429'd Sonnet hero turn once on Haiku (no Dynamic Route, DL-545 (b)). Limits are eventually consistent (F-028), so this is a backstop. Gateways cannot cap fal or ElevenLabs.
4. **Vendor caps.** Anthropic workspaces `npc-runtime`, `npc-builder` (0.2×), `ci-evals` ($50) and `synthetic`, with Console alerts at 50 % and 80 %. ElevenLabs service-account keys with `character_limit` and `max_credit_limit_extension = 0` (F-052). fal prepaid balance, auto-recharge off, per-use keys with allowed-model lists.
5. **Kill switches** in KV: `ks:genai:all`, `ks:anthropic`, `ks:anthropic:sonnet`, `ks:fal`, `ks:cutscene_gen`, `ks:tts:elevenlabs`, `ks:tts:all`. KV is eventually consistent (about 60 s or more); `forceLevel(3)` and `reserve()` are the synchronous paths (route 47 calls `forceLevel(3)` when it sets `ks:genai:all`), and M14b1 measures KV propagation rather than asserting it. They never block cache hits.
6. **Alarms and reconciliation:** SP-01 (50/70/85/100 % of the daily ceiling), SP-02 (ledger versus vendor drift above 10 % for two runs), SP-03 (hourly z-score), SP-05 (vendor cap hit), SP-06 (fal balance under 3 days), SP-09 (more than 20 uncached cutscene generations a day). A reconciliation cron runs every 5 minutes. M14b proves the chain with synthetic spend at 50/70/85/100 % of a $1 ceiling.

Two threshold families (DL-178): the governor's 70/85/100 % guard the recurring daily ceilings; the one-off fal programme alarms at 50/80/100 % of $100 and hard-stops at 100 %.

## 5. One-off production spend: the USD 100 fal cap (DL-OWN-01)

fal has no spend cap and locks an account below a balance threshold (F-048), so the ledger is the cap: `genai.programCapUsdMicros` = 100,000,000, a prepaid balance topped up in tranches that never exceed the remaining cap, auto-recharge off, `FAL_MODE=mock` in dev and CI, and `--live` plus a printed dry-run estimate on every paid job. CI never runs live fal. No player can trigger fal in v1.

| Line | Cap | Content | Estimate |
|---|---|---|---|
| Spike (M00c) | $10 | 11 steps (DL-286) | $3.76 |
| Characters (M10a, M10b) | $42 | 8 Standard fighters × $3.67 + 12 Lean × $1.05 | $41.96 |
| Cutscenes (M05c3, M10b) | $40 | greedy priority list stopping at a $38 running estimate | $37.60 |
| Buffer | $8 | rejects, rig 422s, extra clips; voice design or vehicle bodies only with owner sign-off (Q-26) | $0 |
| **Total** | **$100** | | **≈ $83** |

Not bought with fal in v1: voice designs (Workers AI Aura or MeloTTS), generated cars and props, stand-ins (authored creator-kit bodies), player-triggered NPC looks, the 12-fighter target. Non-fal one-off work for 60 souls (normalization ≈ $5, barks ≈ $9, bark TTS ≈ $30) is billed to Anthropic and Workers AI (`04-npc-builder.md` §C7).

**Which hooks get generated clips** (N = 8 fighters; provider `h3.partner` at $0.06/s; 1.5× retakes included; `03-story-cutscenes.md` §D9.1):

| Hook (R-CUT-02) | Refs | Generated | In-engine |
|---|---|---|---|
| `story.establish`, `story.beat`, Act 1 | 9 | 9 | 0 |
| story, Acts 2–3 | 18 | 0 | 18 |
| `race.intro` | 12 | 0 | 12 |
| `fight.walkin` | 48 | 0 | 48 |
| `fight.faceoff` | 28 | 21 | 7 |
| `fight.special` | 8 | 0 | 8 |
| `fight.super` (Showstopper generated, L2 in-engine) | 16 | 8 | 8 |
| `fight.shutdown` | 8 | 8 | 0 |
| `fight.ending` | 8 | 0 | 8 |
| **Total** | **155** | **46 (398 s)** | **109** |

On `ltx25.fast` the same $38 line buys 29 clips (Act 1, finishers, 4 face-offs); on `gemini.omniFlash11`, 26. If `h3.maxTurbo` clears (ADR-GENAI-01), the list completes to 69 clips for about $37.7 (all face-offs, specials and endings). If no provider is `cleared` when M05c3 runs, nothing is spent and every ref plays its DirectorScript (R-CUT-03). The protagonist, user NPCs and `PLAYER_FIGHTER` segments are always in-engine.

## 6. Review points

Run `pnpm genai:price` monthly (drift above 5 %); reconcile the fal balance weekly; re-measure the §2 assumptions from telemetry after launch; revisit Q-28 before 1,000 MAU.
