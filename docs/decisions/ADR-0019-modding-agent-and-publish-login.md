# ADR-0019 — Modding agent flow and publish login

**Status:** accepted · **Date:** 2026-10-18 · **Decides:** spec/03 D-05; DL-148; R-MOD-02, R-AUTH-03 (the ADR that R-MOD-02 asks for)

## Context
R-MOD-02 wants players with a ChatGPT plan to mod without owning a coding agent. OpenAI's "Sign in with ChatGPT" for websites is a limited trial; plan usage is meant for open-source local apps; the developer kit is licensed Noncommercial; Codex reads at most 32 KiB of `AGENTS.md` [F-060]. Publishing needs a credential on the creator's machine that is separate from the player's browser session.

## Options considered
| Flow | Description | Verdict |
|---|---|---|
| A. Bring your own agent | any agent (Codex, Claude Code, Gemini CLI, Cursor, Copilot, OpenCode) reads `AGENTS.md`, skills and `thabay-mcp`; ChatGPT subscribers use Codex signed in with ChatGPT | **primary**; needs no OpenAI program |
| B. Local Studio with ChatGPT plan usage | `dv studio` on 127.0.0.1 runs OpenAI's plan-usage OAuth and drives `codex app-server` | **deferred behind its own ADR** (DL-148); needs an open-source local app, OpenAI's interest form for a commercial game and our own implementation |
| C. "Continue with ChatGPT" on the site | confidential client, PKCE, ID token discarded after linking | shipped dark behind `AUTH_OPENAI_WEB=false`; apply at M13 start [F-060] |
| D. ChatGPT/Codex plugin | remote MCP with OAuth 2.1 | post-launch; needs directory review |
| E. In-game creator | data-tier place mode and the same publish step in the browser | M13b3; no AI assistant in v1 |

## Decision
- **Primary path is flow A.** The kit documents the ChatGPT-subscriber route: install Codex, choose "Sign in with ChatGPT", run `dv init`, open the folder in Codex (it loads `AGENTS.md`, `.agents/skills` and starts `thabay-mcp` from `.codex/config.toml`), and the human runs `dv login` and `dv mod publish`. The mod-kit `AGENTS.md` stays ≤ 24 KiB, under Codex's 32 KiB cap.
- **Device-code publish login (RFC 8628).** `dv login` calls `POST /api/v1/id/device-code` (route 10) and receives `device_code`, a `XXXX-XXXX` user code, a verification URI, `expires_in` 600 s and `interval` 5 s; the player approves on `/link` (it stays cross-origin isolated; provider sign-in starts under `/account/*`, DL-189); the CLI polls `POST /api/v1/id/device-token` (`authorization_pending`, `slow_down` +5 s, `access_denied`, `expired_token`). The token is an ES256 JWT with `aud: 'tha-bay-cli'`, `scp: ['mods:publish']`, TTL 1 h and a rotating 30-day refresh. Routes 36 and 37 accept either this token or a browser P2 JWT.
- **Never vendor the Noncommercial developer kit.** Flow B, if approved, uses our own implementation of the documented protocol.
- **Credentials.** CLI credentials are stored with mode 0600 or in the OS keychain; nothing in `AGENTS.md`, skills or the knowledge base carries secrets (`dv kb check`, `check:secrets`).
- **Package publication.** `@dv/mod-sdk` and `@dv/cli` go to npm under MIT at M13c3 if the `@dv` scope is available (U5); until the owner confirms (Q-22) they ship as tarballs on the release page.

## Consequences
- (+) Players with any agent, including ChatGPT-plan Codex, can mod today; the device-code path works from any machine and any browser.
- (+) Moving later to flow B or C changes adapters, not the publish route.
- (−) Subscribers without an agent and without the in-game creator have no assistant until flow B or a server-side assistant exists.
- (−) Flow C depends on OpenAI approving a limited program; the `/link` page must work with only the GitHub path (ADR-0018).
- (−) A local Studio that calls our API under plan usage is UNVERIFIED (S12 U6).

## Affected contracts and milestones
C12 (routes 10, 11, 34–37; `ProviderId` includes `openai`), C14 (`mods:publish` scope). M13a6 (agent kit), M13b3 (in-game creator), M13c1 (device code, `/link`), M13c2, M13c3 (`dv login`, `openai` adapter, npm step).

## Links
`spec/domains/12-modding-publish.md` C§1–C§2; `12-modding.md` §0 row 18; `research/auth-ugc-input-maps.md` §3; `research/repos-modding.md`; `spec/99-open-questions.md` Q-22; ADR-0009, ADR-0012, ADR-0018.
