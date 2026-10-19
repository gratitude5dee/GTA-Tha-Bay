# auth-ugc-input-maps: identity (Thirdweb, Sign in with ChatGPT), agent-modding entry points, pose input, SF minimap and world map

Date checked: 2026-10-18. Research dimension key: `auth-ugc-input-maps`. Researcher: S00.
Consumers: S09 (identity spine, auth phases, C12), S12 (ChatGPT sign-in, mod publishing, C14/C17), S07 (pose control), S02 (minimap/world map, C08), S10 (account UI, map screens).

This report builds on the existing research and does not repeat it:
- `stack-cloudflare-backend.md`: Supabase anonymous sign-in, Web3 (EIP-4361) sign-in, MAU pricing, R2 presigned-upload pattern, COOP/COEP and Range behaviour on Cloudflare, HMAC play token for M00–M11.
- `repos-world.md`: licensing of OSM/ODbL, Overture, DataSF building footprints, Terrarium DEM, Google Photorealistic 3D Tiles, Mapbox Product Terms, Protomaps-on-R2, and the Mapbox CLI launch facts.
- `gamedesign-decomposition.md` §4.6: the pose-mode pipeline outline (MediaPipe LIVE_STREAM, One-Euro, 15 s calibration, 10 gestures, 120 ms target, privacy gate) and milestones M02c, M08c, M13c, M14a.
- `repos-webport.md` risk 3: COEP `require-corp` breaks third-party auth widgets.

Owner update applied (binding): accurate San Francisco first. The maps section covers SF data and an SF minimap only. East Bay and Peninsula are backdrop.

Everything below that is not in the "Verified facts" table is either a design proposal (labelled as such) or listed under "Unverified".

---

## 0. Headline findings

1. **"Sign in with ChatGPT" is real as of Oct 2026 and has three different programs with different eligibility.** (a) Website identity sign-in (OIDC, issuer `https://auth.openai.com`, client IDs prefixed `oaiapp_`) is a limited trial for selected commercial partners, reached through an interest form. (b) "ChatGPT plan usage" lets Plus/Pro users power AI requests in open-source, locally running apps. It uses dynamic client registration (`client_id=dynamic_agent_client`), an `ext_agent_host_id`, and a loopback callback on `127.0.0.1` only. Inference goes to the Responses API with `store:false, stream:true`. (c) ChatGPT/Codex "plugins" (MCP server + skills + optional UI, OAuth 2.1 per the MCP authorization spec) go through directory review. **The hosted web game cannot use the user's ChatGPT plan**, because that path is loopback-only and gated for hosted apps. **A local, open-source mod studio can.**
2. **The zero-integration ChatGPT path already works today: Codex CLI.** It is Apache-2.0 (`@openai/codex@0.163.0`, 2026-10-17). Players choose "Sign in with ChatGPT" inside Codex. Codex reads `AGENTS.md` (32 KiB default cap) and skills from `.agents/skills`. If our repo ships those files plus an MCP server, any ChatGPT subscriber can mod the game with no OpenAI client registration on our side.
3. **OpenAI's Sign-in-with-ChatGPT DevKit is under a Noncommercial License v1.0.** Its `@siwc/local` and `@siwc/react` packages are not on npm; they are workspaces in the repo. Do not vendor DevKit code into a repo that may be commercial. Implement the documented OIDC/PKCE flow directly instead. It is a standard flow.
4. **New identity fact that changes the spine design:** Supabase Third-Party Auth now accepts a **Custom OIDC provider**. The provider needs an asymmetric JWT with a `kid`, a `role` claim, and an HTTPS discovery URL. It is billed at $0.00325 per third-party MAU beyond the plan quota. A Cloudflare Worker can therefore be our own OIDC issuer. Supabase RLS (and Convex `customJwt`/OIDC) trust its tokens, and Thirdweb, ChatGPT and future providers become *linked credentials* on our profile. Recommendation: own the identity spine. This amends the stack-cloudflare-backend default (Supabase anonymous sign-in), which stays as the documented fallback.
5. **Thirdweb (Oct 2026): SDK `thirdweb@5.122.0`, Apache-2.0.** In-app wallet strategies verified from the package types: `email`, `phone`, 14 social providers, `guest`, `passkey`, `wallet` (SIWE), `jwt`, `auth_endpoint`, `backend`. It also has `linkProfile`/`getProfiles`/`unlinkProfile`, EIP-7702 `executionMode`, and an EIP-1193 adapter. Pricing page lists **Growth $99/mo** (includes "Custom In-App Wallet Auth"), Scale $499/mo (branding removal, audit logs) and Pro $1,499+/mo. User wallets are billed per monthly active wallet: **first 1,000 free, then $0.015 per MAU** up to 100k, stepping down to $0.005. "Pay the bill" therefore means at least $99/mo plus per-MAW fees. Never create Thirdweb wallets for anonymous players (no `guest` strategy). Otherwise every player becomes a billed MAW.
6. **Pose: `@mediapipe/tasks-vision` is now 1.x** (1.1.1, 2026-10-14; 1.2.0 RCs daily). Delegates are `CPU` or `GPU`, and GPU means WebGL2, not WebGPU. The WASM is 13.5 MB (3.95 MB gzip), with SIMD and non-SIMD builds and **no threaded build**, so pose does not need SharedArrayBuffer. Model files: lite 5.78 MB, full 9.40 MB, heavy 30.66 MB. Model card: Apache-2.0, single person, out of scope beyond about 4 m. No first-party iPhone-Safari latency numbers exist, so latency is a measured gate, not an assumption.
7. **YOLO-pose is a licensing trap for this project.** Ultralytics YOLO26-pose (17 COCO keypoints, 2D, n-model 2.9 M params, 40.3 ms CPU ONNX at 640 px) is AGPL-3.0 or Enterprise. The vendor states that SaaS or cloud use needs an Enterprise license. Keep MediaPipe (Apache-2.0) as the only v1 pose backend. Run `onnxruntime-web@1.30.0` WebGPU EP only for a later permissively licensed model.
8. **Maps: measured, not estimated.** A Protomaps v4 basemap extract for the SF bbox (z0–15) is **422 tiles, 23.7 MB of raw MVT, about 13.1 MB stored gzip**. For z0–14 it is about 3.9 MB. The planet build of 2026-10-18 is 138.98 GB (basemap 4.15.2). The San-Francisco repo's baked road layer (33,187 ways, 392,344 vertices) quantizes to **1.67 MB as int16 deltas at 0.5 m, 0.79 MB gzip**. That is the whole minimap road layer, with no extra download beyond the world bake.
9. **SF-first data is better than generic OSM for the map layer.** DataSF publishes PDDL (public-domain) datasets that refresh daily or quarterly. Street centerlines: 16,378 active segments with `classcode`, `oneway` F/T/B, CNN node topology and address ranges. Also: 41 Analysis Neighborhoods, 224,290 base addresses (388,647 with units), 3,260 Muni stops, 135 Muni route patterns, 255 park properties, 14,151 five-foot elevation contours. Together they give an offline, licence-clean SF geocoder and labelled minimap. Mapbox temporary geocoding results must not be stored, so mission coordinates must not come from Mapbox.
10. **Recommended map architecture:** draw the in-game minimap and full map in-engine with Canvas 2D or OffscreenCanvas from our own SF map pack. This costs $0, works offline, is XR-capable through a texture, and adds no second WebGL context on iPhone. Use MapLibre GL JS 6.15.0 (BSD-3, ESM-only, WebGL2) with SF PMTiles only on out-of-game web surfaces: forum, experience browser, mod studio and share pages. Mapbox GL JS would cost about $950/mo at 100k MAU × 3 loads, or $3,550/mo at 12 loads. Its licence only permits use with Mapbox services, and its tiles cannot be baked or cached. Keep Mapbox out of the runtime. The Mapbox CLI 0.3.0 is optional developer tooling only.

---

## 1. Identity spine: auth added last, one interface, one profile id

### 1.1 What is already decided (do not re-litigate)

- R-AUTH-01: v1 has no sign-in. Play uses a device-bound local profile, and the Worker-signed HMAC play token covers M00–M11 (stack-cloudflare-backend §6).
- R-AUTH-02: Thirdweb comes last, behind one interface. M14a is the milestone (gamedesign §7).
- R-AUTH-03: Sign in with ChatGPT exists only to enable modding and publishing (M13c).
- COEP `require-corp` breaks third-party widgets. Account flows run on a non-isolated route (repos-webport risk 3; stack-cloudflare-backend risk 8).

### 1.2 The new option: our Worker as the OIDC issuer (proposal, built on verified Supabase/Convex facts)

Supabase docs (verified) now list "Custom OIDC provider" next to Clerk, Firebase, Auth0, Cognito and WorkOS under Third-Party Auth. The requirements are:
- discovery at `<issuer>/.well-known/openid-configuration`;
- asymmetric JWTs with a `kid`;
- a `role` claim (`authenticated`, otherwise requests run as `anon`).

The client passes `accessToken: async () => jwt` to `createClient`. RLS reads `auth.jwt()->>'sub'`. Key rotation can take up to 30 minutes to be picked up. Pricing is $0.00325 per third-party MAU beyond the plan quota. Supabase Auth itself cannot be disabled. The Supabase CLI has no config for custom OIDC, so local dev and staging need the Dashboard or the Management API (`oidc_issuer_url`). Convex accepts OIDC providers, or `type: "customJwt"` with `kid`, `alg`, `typ` headers and `sub`, `iss`, `exp` claims (plus `iat` for refresh).

**Proposal (S09 ADR "identity spine"):**

```
              ┌────────────── linked credentials (any number) ───────────────┐
 device key ─▶│ profile_id (UUIDv7, ours)  ◀── thirdweb (wallet addr, SIWE)   │
 (P0/P1)      │                             ◀── openai (OIDC sub)            │
              │                             ◀── email/OAuth via Supabase Auth │ (optional)
              └──────────────────────────────────────────────────────────────┘
                     │ Worker IdentityService issues ES256 JWT (kid, role, sub=profile_id)
                     ▼
     Supabase (Third-Party Auth: Custom OIDC)  |  Convex (customJwt/OIDC)  |  DO rooms (verify locally via JWKS)
```

Why prefer it to Supabase anonymous sign-in as the spine:
1. **One token for all backends.** Durable Objects, Supabase and Convex all verify the same JWKS, which lowers the G1 switch cost.
2. **No dependence on unverified linking paths.** Linking Supabase anonymous users to `custom:` OAuth providers or to Web3 identities is UNVERIFIED (see Unverified).
3. **No shared-IP sign-in ceiling.** Supabase's default anonymous sign-in limit is 30/hour per IP (stack-cloudflare-backend). A school, LAN party or conference on one NAT would hit it at launch.
4. **Same cost.** Third-party MAU is billed like MAU.

Cost of the choice: we own key management (two ES256 keys in Worker secrets, `kid` rotation with ≥30 min overlap), refresh-token rotation and abuse controls (Turnstile on profile registration). Fallback: Supabase anonymous sign-in plus `linkIdentity`/`signInWithWeb3`, exactly as written in stack-cloudflare-backend §10.

### 1.3 Phases (maps onto C12 "auth phases 0/1/2" and milestones)

| Phase | Milestone | Identity state | Token | What it unlocks |
|---|---|---|---|---|
| P0 local | M00–M11 | `profile_id` generated on device, stored in IndexedDB; device keypair (WebCrypto ECDSA P-256, non-extractable) | HMAC play token from Worker (rate-limit identity only) | Single-player, local saves, local pose calibration |
| P1 registered | M12 | Device registers its public key (`POST /api/v1/id/register` + Turnstile) and the server stores the profile | Our ES256 access JWT (1 h) + rotating refresh secret | Cloud saves, multiplayer rooms, NPC memory, leaderboards (RLS `sub = profile_id`, `tier='device'`) |
| P2 ChatGPT link | M13c | `identities(provider='openai', subject=sub)` linked via website OIDC (only if OpenAI grants a client), or no link with publishing through a device-code login (§3.6) | Same JWT, `tier='linked'` when any credential is linked | Publishing experiences, forum posting (RLS requires `tier='linked'` or a device-age rule, decided by ADR) |
| P3 Thirdweb link | M14a | `identities(provider='thirdweb', subject=lowercase EOA address)` via SIWE | Same JWT | Cross-device recovery (email/passkey/social via Thirdweb), "Sign in" on a new device |

### 1.4 Interface and data (proposal; S09 owns C12)

```ts
// packages/identity/src/types.ts  (C12)
export type ProviderId = 'device' | 'thirdweb' | 'openai' | 'supabase-oauth';
export interface IdentityState {
  profileId: string;                    // UUIDv7, never a wallet address or provider sub
  tier: 'local' | 'device' | 'linked';  // P0 | P1 | P2/P3
  providers: { id: ProviderId; display?: string; linkedAt: string }[];
}
export interface IdentityService {
  current(): IdentityState;
  accessToken(): Promise<string | null>;          // null in P0
  register(): Promise<IdentityState>;             // P0 → P1 (Turnstile)
  link(p: Exclude<ProviderId,'device'>): Promise<IdentityState>; // redirects on /account/*
  unlink(p: ProviderId): Promise<IdentityState>;  // refuse if it would orphan the profile
  signInOnNewDevice(p: 'thirdweb' | 'openai'): Promise<IdentityState>; // may trigger merge
  onChange(cb: (s: IdentityState) => void): () => void;
}
```

Tables (Supabase Postgres, RLS on `sub`):
- `profiles(id uuid pk, created_at, tier, display_name, flags jsonb)`
- `identities(provider text, subject text, profile_id uuid fk, created_at, last_used_at, primary key(provider, subject))`
- `device_keys(kid text pk, profile_id, public_jwk jsonb, created_at, revoked_at)`
- `merge_requests(id, from_profile, to_profile, status, conflicts jsonb)`

Worker routes:
- `GET /.well-known/openid-configuration`, `GET /.well-known/jwks.json` (issuer `https://id.<domain>`)
- `POST /api/v1/id/register`, `POST /api/v1/id/token` (refresh), `POST /api/v1/id/siwe/nonce`, `POST /api/v1/id/siwe/verify`
- `GET /api/v1/id/openai/start`, `GET /api/v1/id/openai/callback`
- `POST /api/v1/id/device-code`, `POST /api/v1/id/device-token` (RFC 8628 for the mod CLI)
- `POST /api/v1/id/merge`

Rules:
1. Every row in every table keys on `profile_id`. A provider subject appears only in `identities`.
2. A link that finds the subject already bound to another profile does not silently move it. It creates a `merge_request`. The player chooses which profile survives. Saves from both profiles are kept as slots (gamedesign save profiles), and unlock state is unioned.
3. Unlink is refused when it would leave a `linked` profile with no credential and no device key.
4. JWT claims: `iss`, `sub=profile_id`, `aud='tha-bay'`, `role='authenticated'`, `tier`, `prv` (provider ids), `iat`, `exp` (+1 h). Keys: ES256 with `kid`. Never put an email or wallet address in the JWT.
5. All account pages (`/account/*`, `/link`) are served **without** COOP/COEP. Every provider flow uses full-page **redirect**, not a popup. Under COOP `same-origin` a popup loses `window.opener`. The Thirdweb social auth types support `mode: "redirect" | "popup" | "window"` (verified in `thirdweb@5.122.0` types). The OpenAI flow is a plain OIDC redirect.

---

## 2. Thirdweb (verified 2026-10-18)

### 2.1 SDK surface (from `thirdweb@5.122.0` package type definitions)

- Package: `thirdweb` 5.122.0, Apache-2.0, published 2026-10-12, `engines.node >= 18`. The unpacked package is 143 MB with a 38 MB ESM tree. The tree-shaken in-app-wallet bundle size is UNVERIFIED, so lazy-load it on `/account/*` only.
- `inAppWallet()` + `wallet.connect({ client, strategy, ... })` work in vanilla TS (no React needed). Strategies in `SingleStepAuthArgsType` / `MultiStepAuthProviderType`:
  - multi-step: `email` / `phone` (with `verificationCode`);
  - single-step: social (`google, apple, facebook, discord, line, x, tiktok, epic, coinbase, farcaster, telegram, github, twitch, steam`), `guest`, `jwt` (+`encryptionKey`), `auth_endpoint` (payload), `passkey` (`type: 'sign-up'|'sign-in'`), `wallet` (SIWE with an external wallet), `backend` (`walletSecret`, server only).
  - `iframe_email_verification` and `iframe` are deprecated.
- Social auth args: `mode?: "redirect" | "popup" | "window"`, `redirectUrl?`.
- Linking: `linkProfile(args)`, `linkProfileWithRedirect`, `getProfiles`, `unlinkProfile` (web + native). `Profile = { type, details: { id?, email?, phone?, address? } }`.
- `wallet.getAuthToken(): string | null` returns a JWT the docs say can authenticate the user to a backend. The server-side verification endpoint for that token is UNVERIFIED, so do not depend on it.
- Smart accounts: `executionMode: { mode: "EIP7702", sponsorGas?: boolean }` keeps the EOA address, which the docs recommend. EIP-4337 `smartAccount` returns a different contract address.
- `thirdweb/auth` `createAuth({ domain, client, adminAccount, login, jwt })` provides `generatePayload`, `verifyPayload`, `generateJWT` and `verifyJWT`. Its JWT is signed by an `adminAccount` (an Ethereum key). Whether Supabase third-party auth accepts that algorithm is UNVERIFIED, so we do not use it as the session token.
- `thirdweb/adapters/eip1193` `toProvider(...)` exposes the in-app wallet as an EIP-1193 provider. That is what Supabase `signInWithWeb3({ chain:'ethereum', wallet })` expects in the fallback design.
- Custom auth (docs): the `jwt` strategy is OIDC-based. The dashboard takes the JWKS URL and the `aud` value, and there is an HTTP `POST /v1/auth/complete` with `x-client-id`. `auth_endpoint` means "bring your own auth server". The pricing page lists "Custom In-App Wallet Auth" under **Growth**.

### 2.2 Pricing and what "pay the bill" means (pricing page, 2026-10-18)

| Plan | Price | Relevant inclusions |
|---|---|---|
| Growth | $99/month | Custom In-App Wallet Auth; web/mobile/gaming SDKs; server wallets; account abstraction; managed RPC/IPFS; 3 seats |
| Scale | $499/month | + remove thirdweb branding, audit logs, ecosystem-wallet add-on, 24 h support; 5 seats |
| Pro | $1,499+/month | + volume discounts, no rate limits, 12 h support; 10 seats |

User wallets (monthly active wallets, all plans): first 1,000 free, then $0.015/MAU (to 100,000), $0.01 (to 1 M), $0.0075 (to 10 M), $0.005 above. Gas sponsorship: 1,000 transactions included, then $1 per 1,000, with a 2.5% mainnet gas surcharge. Server wallets: 1,000 requests included, then $1 per 1,000. A thirdweb FAQ defines an active wallet as one where a user logs in during the billing period. That FAQ page also carries older figures ($0.02/wallet), so treat the current pricing page as authoritative. Whether a free Starter plan still exists is UNVERIFIED: billing docs still mention "Starter" as a downgrade target, but the pricing page lists only Growth, Scale and Pro.

**Implication for the build:** M14a should not start until the owner has a Growth subscription (≥ $99/mo). Removing the "powered by thirdweb" branding needs Scale ($499/mo). This is a UI decision for S10 (see Open questions).

### 2.3 Cost model (proposal; assumptions explicit)

The assumption is that only players who choose "Sign in" create a Thirdweb wallet (no `guest`). Link rate = share of MAU who sign in with Thirdweb in a month.

| MAU | 30% link → MAW | Thirdweb wallets | + Growth | If every player got a guest wallet (anti-pattern) |
|---|---|---|---|---|
| 1,000 | 300 | $0 | **$99** | $99 |
| 10,000 | 3,000 | 2,000 × $0.015 = $30 | **$129** | 9,000 × $0.015 + $99 = $234 |
| 100,000 | 30,000 | 29,000 × $0.015 = $435 | **$534** | 99,000 × $0.015 + $99 = $1,584 |

Supabase third-party MAU for the same players stays inside the Pro quota (100,000) at these sizes (stack-cloudflare-backend §2). No gas sponsorship is budgeted, because there is no token economy (non-goal in 06-SHARED-CONTEXT).

### 2.4 Integration recipe (proposal, vanilla TS; S09 + S10)

```ts
// src/account/thirdweb.ts — dynamically imported only on /account/* (non-isolated route)
import { createThirdwebClient } from 'thirdweb';
import { inAppWallet } from 'thirdweb/wallets/in-app';
import { createSiweMessage } from 'viem/siwe';

const client = createThirdwebClient({ clientId: CONFIG.THIRDWEB_CLIENT_ID }); // public id; domain-restricted in dashboard
const wallet = inAppWallet({ auth: { options: ['email', 'passkey', 'google', 'apple'] } }); // no 'guest'

export async function linkThirdweb(id: IdentityService) {
  // social: wallet.connect({ client, strategy: 'google', mode: 'redirect', redirectUrl: location.href })
  // email: preAuthenticate({ client, strategy:'email', email }) → wallet.connect({ client, strategy:'email', email, verificationCode })
  const account = await wallet.connect({ client, strategy: 'passkey', type: 'sign-in' });
  const { nonce } = await api.post('/api/v1/id/siwe/nonce');                  // DO/KV, 5-min TTL, single use
  const message = createSiweMessage({ domain: location.host, address: account.address, chainId: 1,
    uri: location.origin, version: '1', nonce, statement: 'Link this wallet to your Tha Bay profile' });
  const signature = await account.signMessage({ message });
  return api.post('/api/v1/id/siwe/verify', { message, signature }, { auth: await id.accessToken() });
}
// Worker: parseSiweMessage + verifySiweMessage(publicClient, { message, signature, domain, nonce })
// (viem 2.57.7 exports both from 'viem/siwe'); EOA in-app wallets verify by ecrecover; never enable 4337 smart accounts.
```

### 2.5 Can Supabase or Convex auth replace Thirdweb?

For identity alone, yes. Supabase Auth offers email OTP, OAuth providers, anonymous sign-in and custom OAuth/OIDC providers (3 on Free, unlimited on Pro), and Convex accepts any OIDC or custom JWT. Thirdweb adds a self-custodial wallet and passkey-plus-social login in one widget. The owner requires Thirdweb, so the spec keeps it as **one linked provider behind `IdentityService`**. Removing or replacing it then means deleting one adapter. Specify a cheaper "email via Supabase Auth OTP" adapter as the documented alternative if the owner decides not to pay for Growth.

---

## 3. Sign in with ChatGPT, Codex and the "build an experience" flows (verified 2026-10-18)

### 3.1 Program status

| Program | What it does | Eligibility today | Mechanics |
|---|---|---|---|
| **Website sign-in** (`/siwc/website`) | ChatGPT identity for sign-up/sign-in on your site | "currently available to selected commercial partners through a limited trial"; join via the interest form `openai.com/form/sign-in-with-chatgpt-interest/` | OIDC Authorization Code + PKCE (S256); issuer `https://auth.openai.com`; authorize `https://auth.openai.com/api/accounts/authorize`; token `https://auth.openai.com/api/accounts/oauth/token`; JWKS `https://auth.openai.com/.well-known/jwks.json`; scopes `openid profile email`; client id `oaiapp_…`; exact registered callback per environment; public (`none`) or confidential (`client_secret_basic`) clients; use verified `sub` as the stable identity; do not require OpenAI access/refresh tokens; do not store raw ID tokens; an email match is not proof of ownership; approved buttons "Continue with ChatGPT" / "Sign in with ChatGPT" |
| **ChatGPT plan usage** (`/siwc/token-sharing-open-source`) | Plus/Pro users authorize your app to make Responses API requests against their plan | "available to all open-source partners and selected private clients"; cookbook: "open-source projects, personal projects that run locally, and selected private apps"; paid or remotely hosted apps → interest form | First authorization uses `client_id=dynamic_agent_client` + `agent_name_hint` + required `ext_agent_host_id` (`urn:uuid:…`, `urn:ietf:params:oauth:jwk-thumbprint:…` or `did:key:…`); callback must be HTTP loopback `127.0.0.1` (not `localhost`; only the port may change); callback returns the issued `client_id` to persist; scopes `offline_access resource.invoke chatgpt.tokens.use.direct` (+ identity scopes); `resource=https://api.openai.com/v1`; no client secret; check the granted scope `chatgpt.tokens.use.direct`; store credentials with owner-only permissions; inference `POST https://api.openai.com/v1/responses` with the bearer token, `store:false`, `stream:true`, models from `/v1/models` (`visibility:"list"`) |
| **Plugins** (`/plugins`) | Ship an MCP server + skills + optional UI into ChatGPT and Codex | Directory submission with review; desktop-only plugins (local MCP) have their own submission path | OAuth 2.1 conforming to the MCP authorization spec (2025-11-25); CIMD, DCR or predefined clients; PKCE S256; protected-resource metadata on the MCP server; anonymous read-only tools allowed; user data or writes must authenticate |

Plan-usage limits that matter for a modding agent:
- **Unsupported hosted tools:** image generation, file search, Code Interpreter, native computer use, hosted MCP/connectors, `tool_search`.
- **Supported:** local shell and MCP tools through Codex app-server.
- **Inputs:** text, images and files. Audio and video input, the Files upload API and transcription are not supported.
- **Unsupported request fields:** `background`, `conversation`, `max_output_tokens`, `temperature`, `top_p`, `truncation`, `user`, `previous_response_id` (over HTTP).
- **Usage-limit error codes:** `subscription_sharing_usage_limit_exceeded`, `subscription_sharing_usage_unavailable`, delivered as `response.failed`.
- **User controls:** per-app weekly caps as a % of plan usage (Settings → Usage → App limits), credits off by default, disconnect in Settings → Security and login → Sign in with ChatGPT. Apps receive name, email and picture, not conversations or memories.

Timeline: identity sign-in beta with partners, including Supabase for supabase.com login (Supabase blog dated 2026-07-29). Plan usage and plugins came with DevDay on 2026-09-29. Listed apps include Amp Code, Devin, Notion, Vercel and Warp (plan usage); Airtable, Canva, GitLab, HubSpot and Supabase (sign-in only); OpenClaw, OpenCode, Pi and T3 (open-source).

**DevKit:** `github.com/openai/sign-in-with-chatgpt-devkit` holds `@siwc/local` (Node-only: OAuth, credential storage, profiles, model discovery, streaming Responses) and `@siwc/react` (UI), plus Paste Perfect, an Electron example that needs macOS 14 and Node 22.12. It is licensed under the **Sign-in with ChatGPT DevKit Noncommercial License v1.0**: "Commercial use of OpenAI's Contribution requires a separate written agreement with OpenAI". Distributed modifications must carry the same licence. A community issue (#5) reports refresh returning `invalid_grant` inside the documented window. Treat refresh as fallible and re-authorize.

### 3.2 Codex facts the repo must target

- `@openai/codex` 0.163.0 (2026-10-17), Apache-2.0. Installs via `curl -fsSL https://chatgpt.com/codex/install.sh | sh`, npm or Homebrew. "Sign in with ChatGPT" is recommended for Plus, Pro, Business, Edu and Enterprise plans; an API key needs extra setup. Surfaces: CLI, IDE extension, desktop app (`codex app`), Codex Cloud, plus an SDK (`@openai/codex-sdk` 0.163.0), app-server, GitHub Action and non-interactive mode.
- **AGENTS.md discovery:** global `~/.codex/AGENTS.override.md` then `AGENTS.md`. Then from the project root down to cwd, at most one file per directory, concatenated root-first. The combined cap is `project_doc_max_bytes`, 32 KiB by default. Fallback names are set with `project_doc_fallback_filenames`.
- **Skills:** a directory with `SKILL.md` (frontmatter `name`, `description`) and optional `scripts/`, `references/`, `assets/`, `agents/openai.yaml`. Discovered in `.agents/skills` from cwd up to the repo root, plus `$HOME/.agents/skills`, `/etc/codex/skills` and bundled skills. Symlinks are followed. Invoked with `$skill`, `/skills`, or implicitly by description.
- Claude Code reads `.claude/skills/` and reads `AGENTS.md` only when no `CLAUDE.md` exists (claude-code-deployment.md §3). The repo should therefore keep **one canonical skills tree** and expose it to both agents (symlinks `.agents/skills → skills/`, `.claude/skills → skills/`, verified in CI). It should also ship a `CLAUDE.md` that imports `@AGENTS.md`.
- Codex app-server (plan-usage mode): `codex app-server --listen stdio://` with `-c model_provider="openai_chatgpt_plan"` and `-c wire_api="responses"`, `ACCESS_TOKEN` in the child env. It speaks newline-delimited JSON: `initialize`, `initialized`, `thread/start`, `turn/start`, `thread/resume`; events `item/agentMessage/delta`, `turn/completed`. Only `completed` means success. Renew by restarting the process and resuming the thread.

### 3.3 The four "build an experience" flows (proposal; S12 owns, S09 provides auth endpoints)

**Flow A: bring your own agent (default; works on day one; no OpenAI integration).** The player clones the open-source mod kit or runs `npm create thabay-experience@latest`. The kit ships:

```
AGENTS.md                      # ≤ 24 KiB (headroom under Codex's 32 KiB cap): mod API, rules, commands, IP/likeness rails
CLAUDE.md                      # "@AGENTS.md" + Claude-specific notes (<200 lines)
skills/<name>/SKILL.md         # canonical; symlinked as .agents/skills and .claude/skills
  build-experience/  add-npc-cameo/  place-on-map/  write-mission-ir/  validate-and-preview/  publish/
mcp/thabay-mcp                 # stdio MCP server (TS, @modelcontextprotocol/sdk 1.32.1)
  tools: world.find_place(query) → EAS/OSM-backed SF geocode (offline)
         world.describe(chunkKey|lat,lng) → streets, neighborhood, landmarks, terrain height
         mod.schema(kind) → JSON Schema for C14/C17/mission IR
         mod.validate(path) → errors with fixes (JSON)
         mod.preview(path) → starts local dev server, returns URL + screenshot path
         mod.pack(path) → .thabay archive + provenance manifest
         mod.publish(path) → requires `thabay login`; uploads + returns moderation ticket
.mcp.json / .codex/config.toml # pre-registered thabay-mcp for Claude Code and Codex
```

Dev loop: `thabay dev` serves the mod at `http://127.0.0.1:<port>/manifest.json`. The hosted game accepts `?devmod=` only from loopback origins on the player's own device, behind a settings toggle, and runs it in the C14 sandbox (S12). Publishing: `thabay login` runs an RFC 8628 device-code flow against `POST /api/v1/id/device-code`. The player approves on `/link` in a browser that holds their P1/P2 profile. The CLI receives a short-lived token scoped `mods:publish`. Upload uses the presigned-PUT → Queue validation → moderation pattern (stack-cloudflare-backend §1.4). Players with a ChatGPT plan simply use Codex, signing in with ChatGPT inside Codex. That satisfies "use ChatGPT/Codex as the coding agent" without OpenAI approving us.

**Flow B: "Sign in with ChatGPT" inside our local Studio (optional, M13c stretch; needs ADR).** `thabay studio` is a local Node web UI on `127.0.0.1` that implements the plan-usage flow from §3.1 itself. It does not use DevKit code; the code is ours, under the project licence. Steps:
1. persist `ext_agent_host_id = urn:uuid:<v4>` in `~/.config/thabay/host.json`;
2. open the system browser at the authorize URL (`dynamic_agent_client`, `agent_name_hint="Tha Bay Studio"`, PKCE S256, `redirect_uri=http://127.0.0.1:<port>/auth/callback`, scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`);
3. persist the issued `client_id`, store credentials at mode 0600 or in the OS keychain;
4. spawn `codex app-server` with the token, so Codex runs the agent loop with our `thabay-mcp` tools locally;
5. show "Using ChatGPT plan" and "Manage usage" as the cookbook requires.

Eligibility: the Studio must be open-source and run locally. If the game is commercial, the owner must also submit the interest form (Open question 2).

**Flow C: "Continue with ChatGPT" on the hosted site (only if OpenAI admits us to the website trial).** The Worker acts as a confidential client (`client_secret_basic`, secret in Worker secrets) running OIDC code + PKCE against `auth.openai.com`. It verifies the ID token with `jose` 6.2.12 against OpenAI's JWKS, checking `iss`, `aud`, `exp` and `nonce`. It then upserts `identities('openai', sub)` and discards the ID token. This is identity only. It does not let the hosted game spend the user's plan. Feature flag `AUTH_OPENAI_WEB=false` until a client id exists. Alternative wiring: a Supabase custom OIDC provider (`custom:openai`, issuer `https://auth.openai.com`). Compatibility of Supabase's token-endpoint auth method with OpenAI's `client_secret_basic`-only rule is UNVERIFIED.

**Flow D: "Tha Bay Experience Builder" plugin in ChatGPT and Codex (post-launch).** A remote MCP server on Workers, using the `agents` 0.28.1 MCP agent with `@cloudflare/workers-oauth-provider` 1.2.3 as the OAuth 2.1 authorization server. Our login (P1/P2 profile) is the inner sign-in. It reuses Flow A's tools, minus local preview, and adds `experience.draft_from_prompt`. Writes need auth, and publishing goes into the same moderation queue. It needs directory review (§3.1).

**Hosted in-browser builder (no local agent, no ChatGPT plan).** This is a data-only editor in the main menu for experience descriptor, mission IR, markers and NPC cameo picks. It never runs user code. Its optional AI assistant runs on our server-side Claude under the G3 quotas and model routing in ai-npc-runtime.md, because the hosted site cannot use plan usage.

### 3.4 Moderation hooks specific to the map (proposal; S12 + S02)

- Every `ExperienceDescriptor.anchor` (C17) must fall inside the SF land polygon and on public right-of-way or a park property. Check it at publish time against DataSF Streets (`3psu-pn9h`) buffers and Recreation and Parks Properties (`gtr9-ntp6`).
- Reject anchors whose 25 m radius intersects a single residential parcel (Parcels `acdm-wktn`). This stops UGC from being pinned on private homes.
- No experience may use a real street address as a crime or harassment target. The text classifier flags address strings that match EAS (`ramy-di5m`).

---

## 4. Pose input for Culture Wars (S07; extends gamedesign §4.6)

### 4.1 Verified platform facts

- `@mediapipe/tasks-vision` 1.1.1 was published 2026-10-14, with `1.2.0-rc.*` published daily. Stable versions jump from 0.10.35 to 1.0.0, 1.0.1, 1.1.0 and 1.1.1. Pin an exact stable version.
- `delegate?: "CPU" | "GPU"`. The GPU path needs WebGL2, and the task accepts `canvas?: HTMLCanvasElement | OffscreenCanvas`. Safari added WebGL in OffscreenCanvas in 17.0; Safari 16.4 shipped OffscreenCanvas 2D only.
- `PoseLandmarkerOptions` defaults: `numPoses` 1; `minPoseDetectionConfidence`, `minPosePresenceConfidence` and `minTrackingConfidence` 0.5; `outputSegmentationMasks` false. `detectForVideo(frame, timestampMs)` in VIDEO/LIVE_STREAM modes. Results include `landmarks` (normalized image coordinates + visibility) and `worldLandmarks` (metres, hip-centred).
- WASM payload, measured from the npm tarball: `vision_wasm_internal.wasm` 13,519,922 B (SIMD; 3,954,071 B gzip), a `module` variant, and `vision_wasm_nosimd_internal.wasm` 12,627,509 B. There is **no pthreads build**, so pose inference does not require cross-origin isolation.
- Model files (Google Cloud Storage, `latest`, last modified April 2023): `pose_landmarker_lite.task` 5,777,746 B; `full` 9,398,198 B; `heavy` 30,664,242 B. Detector input is 224×224 and landmarker input 256×256, both float16.
- Model card (BlazePose GHUM 3D): Apache-2.0. Pixel 3 performance: Lite about 44 FPS CPU / 49 FPS GPU; Full about 18 / 40; Heavy about 4 / 19. Out of scope: multiple people, people further than about 4 m (14 ft), head not visible, metric depth, surveillance. Jitter rises in low light and with fast motion.
- 33 landmarks: 0 nose … 11/12 shoulders, 13/14 elbows, 15/16 wrists, 17–22 hand points, 23/24 hips, 25/26 knees, 27/28 ankles, 29/30 heels, 31/32 foot index.
- Camera APIs: `getUserMedia` in iOS home-screen web apps is listed as supported since iOS 13 (firt.dev), but WebKit bugs show standalone-mode regressions (camera freezing on 17.5.1, permission not persisted). `requestVideoFrameCallback` is in Safari iOS 15.4+. `MediaStreamTrackProcessor` is worker-only in Safari 18 (MDN-derived data).
- No first-party benchmark exists for PoseLandmarker in iPhone Safari with either delegate (search found none). **Latency on iPhone is UNVERIFIED and becomes a measured acceptance gate.**

### 4.2 Pipeline and thread topology (proposal)

```
main thread                                   PoseWorker (dedicated)
───────────                                   ──────────────────────
getUserMedia({video:{facingMode:'user',       FilesetResolver.forVisionTasks('/pose/wasm/')   ← self-hosted
  width:640,height:480,frameRate:{ideal:30}}})  PoseLandmarker.createFromOptions({
video.requestVideoFrameCallback(cb)              baseOptions:{modelAssetPath:'/pose/pose_landmarker_lite.task',
  cb: createImageBitmap(video) ──transfer──▶       delegate: chosenDelegate},   // benchmarked at calibration
      + {captureTs: metadata.expectedDisplayTime}  canvas: new OffscreenCanvas(1,1),  // GPU path, Safari ≥17
                                                runningMode:'VIDEO', numPoses:1 })
                                              detectForVideo(bitmap, monotonicTs) ; bitmap.close()
◀──transfer── Float32Array(33*5 image + 33*3 world) + {captureTs, inferMs, presence}
OneEuro (per coord) → features → GestureFSM → InputAction{action, ts=captureTs} → C03 pose binder
                                              → fighter input ring buffer (30 frames, gamedesign §4.2)
```

- Self-host the WASM and `.task` files on our origin (static assets ≤25 MiB/file, stack-cloudflare-backend §1.1). This keeps COEP happy, works offline, and means no runtime request to Google.
- Where `MediaStreamTrackProcessor` exists in a worker, feed `VideoFrame`s directly (optimisation). The `createImageBitmap` path is the portable baseline.
- Provide a VIDEO-file fixture mode, the same pipeline fed from recorded `.webm` clips. CI classifies fixtures deterministically.
- Start the camera only inside Culture Wars pose mode. Stop the tracks on pause, blur or `visibilitychange`.

### 4.3 Gesture classifier (proposal)

Normalization, per frame:
- origin = mid-hip;
- scale T = |mid-shoulder − mid-hip| (torso length), using `worldLandmarks` for depth-sensitive features and image landmarks for planar ones;
- facing axis = toward the on-screen opponent. Movement is expressed relative to the opponent, so a mirrored preview never flips controls.

Stance and handedness: calibration decides which wrist is **lead** and which is **rear** by which wrist is nearer the camera in guard stance (world z) and which foot is forward. It does not use MediaPipe left/right labels. This removes any dependence on the left/right convention under a mirrored selfie stream (UNVERIFIED convention).

Features (12-frame window at camera rate):
- wrist extension ratio e = |wrist − shoulder| / calibrated arm length;
- elbow angle;
- wrist velocity v (T/s) from the One-Euro-filtered derivative;
- wrist vertical velocity;
- shoulder-line yaw rate;
- ankle height above standing baseline (T);
- knee extension;
- hip height delta (T);
- both-wrists-to-face distance (T);
- torso lean = (mid-shoulder − mid-hip)·facing (T).

Per-limb FSM: `IDLE → LOADING (v rising) → COMMIT (emit) → RECOVER (refractory 180 ms, until e < 0.6) → IDLE`. COMMIT is emitted at the threshold crossing (early commit). It is timestamped with the frame's `captureTs`, so the sim can place it in the right input frame.

| Gesture → action (Simple scheme) | Commit rule (initial thresholds; calibration rescales) |
|---|---|
| Jab → Light | lead wrist: e ≥ 0.80 and v ≥ 2.5 T/s and elbow ≥ 140° |
| Cross → Heavy | rear wrist: same + shoulder yaw rate ≥ 90°/s toward opponent |
| Hook → Light (alt) | wrist horizontal speed ≥ 2.5 T/s while elbow 70–110° |
| Uppercut → Heavy (alt) | wrist vertical up-speed ≥ 2.5 T/s starting below shoulder |
| Front kick → Heavy kick | ankle height ≥ 0.45 T above baseline and knee extension ≥ 150° |
| Low kick → Light kick | ankle lateral speed ≥ 2.0 T/s below knee height |
| Guard → Block (hold) | both wrists ≤ 0.35 T from nose for ≥ 100 ms; release when > 0.5 T |
| Crouch → Down (hold) | hip drop ≥ 18% T vs standing baseline (gamedesign) |
| Jump → Up | hip rise ≥ 12% T and both ankles rising (gamedesign) |
| Two-hand push → Special | both wrists commit within 100 ms; direction from torso lean |
| Lean fwd/back → Walk | lean ≥ 0.15 T with ±0.05 T hysteresis |

Conflict rules:
- Guard suppresses strikes.
- If the other wrist's v is rising when one wrist commits, hold the single-hand action for up to 50 ms waiting for a Special coincidence. Otherwise emit it.
- One action per limb per refractory window.
- Presence < 0.5 for 1 s, or FPS < 15, pauses with a "move into frame" prompt (gamedesign fallback).

Filtering: run two One-Euro filter banks. A display/feature bank uses mincutoff 1.0 Hz and a low beta. An onset bank uses higher beta so onset lag is lower. Tune with the documented 1€ procedure: start with beta = 0 and mincutoff about 1 Hz, adjust mincutoff for jitter at rest, then raise beta by factors of 10 for fast-motion lag.

v2 option: a small learned temporal classifier (1D-CNN or GRU, ≤ 50 k params, JS or ONNX) trained on recorded calibration fixtures. Ship it only if it beats the rule FSM on the fixture set by ≥ 5 pp at equal latency.

### 4.4 Calibration (extends the 15 s flow in gamedesign §4.6)

1. **Framing check.** Head, both wrists and both ankles visible with presence ≥ 0.7 for 1 s. Estimated distance 1.5–3.5 m (inside the model card's 4 m limit). Hint if the subject is backlit or too dark (mean luma).
2. T-pose 3 s, then neutral 3 s, then guard 2 s. This captures arm length, T, standing hip height, stance and lead hand.
3. Three jabs, three crosses, one kick, one jump, one crouch. Per-profile thresholds = 60% of the observed peak v and e. They are stored locally (`pose.thresholds` in the save, never uploaded).
4. **Delegate benchmark.** Run 60 frames on CPU and 60 on GPU, keep the one with lower p95 `inferMs`. Default to lite on phones and full on desktop if both are under budget.
5. A test round against a passive dummy shows a live latency readout.

### 4.5 Latency budget (proposal; replaces the single 120 ms figure with a split, measurable budget)

| Stage | Desktop target | iPhone target | How measured |
|---|---|---|---|
| Camera exposure → rVFC callback | ≤ 50 ms | ≤ 60 ms | `expectedDisplayTime`/`captureTime` vs `performance.now()` (UNVERIFIED accuracy on iOS) |
| Transfer + inference | ≤ 15 ms | ≤ 30 ms | `inferMs` from worker |
| Filter + features + FSM | ≤ 1 ms | ≤ 2 ms | `performance.now()` |
| Recognition delay after motion onset | ≤ 2 frames @30 fps (67 ms) | same | fixture clips with hand-labelled onset frames |
| Sim pickup (60 Hz) + render | ≤ 33 ms | ≤ 33 ms | frame timestamps |
| **Total onset → photon** | **≤ 150 ms p50, ≤ 200 ms p95** | **≤ 180 ms p50, ≤ 240 ms p95** | sum + 240 fps phone-camera spot check (manual) |

The gamedesign pose ruleset (input leniency ×2, CPU reaction ×1.5, never ranked) stays. These budgets are higher than the 120 ms in gamedesign §4.6; S07 should adopt them as the acceptance gate for M08c.

### 4.6 YOLO-pose via onnxruntime-web (feasibility verdict)

- YOLO26-pose (Ultralytics docs), COCO-pose val, 640 px:

| Model | mAP pose 50-95 | CPU ONNX | T4 TensorRT | Params | FLOPs |
|---|---|---|---|---|---|
| n | 57.2 | 40.3 ms | 1.8 ms | 2.9 M | 7.6 B |
| s | 63.0 | 85.3 ms | — | 10.4 M | — |
| x | 71.6 | — | — | 57.6 M | — |

  Output is 17 COCO keypoints, 2D only (no heels, foot index, hand points or metric world coordinates). Exports to ONNX.
- **Licence:** "All Ultralytics YOLO trained models fall under the AGPL-3.0 License by default"; "An Enterprise License is required if you want to use Ultralytics YOLO without open-sourcing your entire project"; SaaS, API and cloud use need Enterprise. **Not acceptable as a default dependency.**
- `onnxruntime-web` 1.30.0 (MIT, 2026-09-18). WebGPU EP: `import * as ort from 'onnxruntime-web/webgpu'`, `executionProviders:['webgpu']`, GPU IO binding via `Tensor.fromGpuBuffer` / `preferredOutputLocation:'gpu-buffer'`, graph capture for static shapes. The ORT doc still says Safari support is "Technology Preview", which is stale relative to Safari 26 WebGPU (stack-rendering-platform). Treat iOS ORT-WebGPU as UNVERIFIED.
- **Verdict:** v1 uses MediaPipe only. Revisit only for a two-players-one-camera couch mode, where multi-person detection matters (MediaPipe's model card puts multi-person out of scope). Use a permissively licensed model (RTMO/RTMPose family; weight licence UNVERIFIED) through ORT WebGPU, behind an ADR and a licence check in CI.

### 4.7 Fallbacks, accessibility, privacy (implementation of R-IP-04)

- Any touch, key or gamepad input instantly switches the active binder back. A hybrid mode keeps pose for strikes and the stick or keys for movement.
- iPhone pose mode requires the phone on a stand with the front camera at 1.5–3.5 m. The UI shows a setup card. Pose mode is not offered in XR in v1 (gamedesign Q-GD-08).
- Privacy:
  - `Permissions-Policy: camera=(self)`.
  - CSP `connect-src` allow-lists our API only.
  - Worker messages carry landmarks, never pixels.
  - An e2e test asserts that no request body during pose mode exceeds 4 KB or has an image MIME type (extends gamedesign M08c's network assertion).
  - A visible camera-active indicator.
  - Gated by the parental-consent flag.
  - Calibration data stays local.

---

## 5. Maps: accurate San Francisco minimap and world map (S02, S10)

### 5.1 Already decided (repos-world, 01-MASTER)

Gameplay geometry is open data only: DataSF footprints, OSM, Terrarium and USGS. Google 3D Tiles and Mapbox tiles are excluded from gameplay, because the ToS prohibit baking, deriving and offline caching. The in-app map is PMTiles from the same OSM extract, and the Mapbox CLI stays in agent tooling only. This section refines that for an SF-first minimap and adds measured sizes, SF datasets and costs.

### 5.2 SF data inventory for the map layer (DataSF, verified via Socrata metadata 2026-10-18)

| Dataset (id) | Licence | Size / freshness | Map use |
|---|---|---|---|
| Streets – Active and Retired (`3psu-pn9h`) | PDDL; attribution City and County of San Francisco | 17,176 rows (16,378 active); refreshed daily (rows 2026-10-17); 2,567 distinct active street names | Minimap street hierarchy (`classcode` 1 freeway, 2 major/highway, 3 arterial, 4 collector, 5 residential, 6 ramp, 0 other), `oneway` F/T/B arrows, CNN `f_node_cnn`/`t_node_cnn` topology for GPS routing, address ranges `lf_fadd…rt_toadd`, `layer` (exclude `PAPER`, `PAPER_FWYS`, `PAPER_WATER` = 460 non-existent segments), `nhood` |
| Analysis Neighborhoods (`j2bu-swwd`) | PDDL | 41 polygons | District boundaries and names on the map and HUD ("Mission", "South of Market", "Tenderloin", "Bayview Hunters Point", "Treasure Island", …) |
| Addresses with Units – EAS (`ramy-di5m`) | PDDL; City and County of SF | 388,647 rows; 224,290 distinct base addresses; lat/lon + CNN; refreshed daily | Offline SF geocoder for mission authoring, waypoint search and the `world.find_place` MCP tool |
| Recreation and Parks Properties (`gtr9-ntp6`) | PDDL | 255 properties (name, type, acres) | Park polygons/labels; UGC anchor whitelist |
| Muni Stops (`i28k-bkz6`) | PDDL; SFMTA | 3,260 stops; updated per sign-up (3–6 months) | Transit set dressing, bus-stop blips |
| Muni Simple Routes (`9exe-acju`) | PDDL; SFMTA | 135 route patterns | Map overlay for transit lines (names fictionalized per IP rules) |
| Elevation Contours (`rnbg-2qxw`) | PDDL | 14,151 features, 5-ft interval | Optional hillshade/contour styling on the full map (SF hills are a recognizability cue) |
| Parcels – Active and Retired (`acdm-wktn`) | PDDL | refreshed daily | UGC anchor moderation (§3.4) |
| Street Tree Inventory (`tkzw-k3nq`) | PDDL; SF Public Works | refreshed daily | Already used by world bake; map greenery tint |
| Building Footprints (`ynuv-fyni`) | PDDL (repos-world) | — | Map footprint layer (simplified) |
| SF Find Neighborhoods (`pty2-tcw4`) | `USGOV_WORKS` | 2023-10-17 | Not needed; prefer Analysis Neighborhoods |

Transit brands: the BART developer licence grants revocable rights to use and redistribute BART data but forbids using BART trademarks "in association with Data". Use station positions only, under parody names (R-IP-01). The SFMTA Muni stop description says it derives from the GTFS on 511.org; the 511 terms page could not be fetched (UNVERIFIED). The DataSF copy is PDDL, so use it.

### 5.3 Measured sizes

- **Protomaps basemap v4** (planet build `20261018.pmtiles`, 138,978,594,030 B, basemap 4.15.2, gzip tiles, z0–15). SF bbox (−122.52, 37.70, −122.35, 37.84):

| z | 0–11 | 12 | 13 | 14 | 15 | total |
|---|---|---|---|---|---|---|
| tiles | 18 | 9 | 25 | 81 | 289 | 422 |
| raw MVT KB | 1,245 | 331 | 783 | 3,231 | 18,643 | 24,233 (23.7 MB) |
| gzip KB | 878 | 242 | 590 | 2,285 | 9,429 | 13,424 (≈13.1 MB) |

  For z0–14 the total is ≈ 5.5 MB raw and ≈ 3.9 MB gzip. MapLibre overzooms z14 well for a city browser. Method: `pmtiles@4.5.0` `getZxy` range reads of the public build, gzip level 9 of each tile; script at `/tmp/claude-0/-home-user/d5596183-032b-5cac-9516-8839e0bfb562/scratchpad/s00auth/scripts/sf_extract_size.mjs`. Protomaps docs discourage hotlinking builds: "copy the tileset to your own Cloud Storage".
- **SF repo baked layers** (`San-Francisco/public/data`):
  - `roads/roads.json` 9,745,049 B (3.09 MB gzip): 33,187 ways, 392,344 vertices, `cls` histogram {4: 13,512, 3: 10,475, 1: 4,501, 2: 2,246, 0: 1,035, 6: 644, 5: 614, 8: 160}. Re-encoded as int16 deltas at 0.5 m: **1,668,937 B, 794,154 B gzip**.
  - `landuse/landuse.json` 1.68 MB (0.55 MB gzip).
  - `labels.json` 102,797 B (25,972 B gzip): 94 neighborhood labels with tiers, 1,200 road labels with angle.

### 5.4 Options compared (cost at 1k / 10k / 100k MAU; usage assumptions stated)

| Option | Offline / PWA | XR (no DOM) | Extra GPU context | Licence fit | Client size | Monthly cost 1k / 10k / 100k MAU |
|---|---|---|---|---|---|---|
| **A. In-engine vector minimap + full map from our SF map pack** (Canvas 2D/OffscreenCanvas, our styling) | yes (pack precached) | yes: draw to `CanvasTexture` for wrist or HUD quad | none (2D) | ODbL produced work + PDDL; attribution per OSMF game guideline | ≈ 2–3.5 MB gzip pack (estimate: roads 0.8 + water/parks/landuse ≈ 0.6 + simplified footprints ≈ 1–2 + labels 0.03 + geocoder ≈ 1) | **$0 / $0 / $0** (static assets free and unlimited) |
| B. MapLibre GL JS 6.15.0 + SF PMTiles (Protomaps style) | yes if the PMTiles are precached (3.9–13.1 MB) | no (DOM/WebGL canvas) | +1 WebGL2 context | BSD-3 + ODbL; "© OpenStreetMap" in corner | 293 KB + 147 KB (worker) gzip + tiles | ≈ $0 on static assets; on R2 via Worker at ≈80 tile reads per view: 1k → $0, 10k → $0, 100k (2 views each) ≈ 16 M requests → ≈ $2 Workers overage |
| C. Mapbox GL JS 3.33.0 (Standard style, 3D landmarks) | no (≤30-day cache only via Mapping APIs; no bake) | no | +1 WebGL context | licence "for use only with the relevant Mapbox product(s)"; no deriving; Mapbox + OSM attribution | 522 KB gzip + tiles | 3 loads/MAU: $0 / $0 / **$950**; 12 loads/MAU: $0 / **$330** / **$3,550** |
| D. Pre-rendered raster tiles in R2 | yes | yes (texture) | none | same as A | 10–20+ MB for 2 m/px over SF (estimate) | ≈ $0, but bigger, blurry when rotated, restyle = rebake |
| E. OpenFreeMap public instance | no (offline cap 3,000 tiles/50 MB) | no | +1 | free, commercial OK, attribution required, **no SLA** | as B | $0, with availability risk |

Mapbox map-load arithmetic (pricing page): first 50,000 loads free, then $5.00/1k (to 100k), $4.00 (to 200k), $3.00 (to 1 M), $2.50 (to 5 M). 300,000 loads = $250 + $400 + $300 = $950. 1.2 M loads = $250 + $400 + $2,400 + $500 = $3,550.

### 5.5 Recommendation (proposal for an S02 ADR "map stack")

1. **In-game minimap and full map = option A.** One `MapRenderer` draws to an OffscreenCanvas 2D on the main thread or in a worker (Safari 16.4+ for 2D).
   - Flat mode: the canvas is composited as a DOM layer.
   - WebXR: the same canvas is uploaded as a `CanvasTexture` on a wrist panel or quad layer at 10 Hz.
   - It reuses world-bake data the game already streams, so it adds no download and no second WebGL context next to the WebGPU renderer.
2. **Out-of-game web surfaces = option B.** These are the forum, experience browser, Mod Studio anchor picker, share and preview pages and the companion site. Serve `sf.pmtiles` (z0–14, ≈3.9 MB) from Workers static assets or R2 with the Protomaps style and our colour tokens. Overlay published experiences from `/api/v1/experiences?bbox=` as GeoJSON.
3. **Mapbox:** no runtime use. The Mapbox CLI (0.3.0, MIT, `mapbox` binary, command groups `geocoder, search, static, styles, tilesets, directions, isochrone, matrix, map-match, usage, doctor, agent-skills, generate-skills, mcp`) is allowed as optional developer tooling for ETA sanity checks and style experiments. **Nothing it returns is committed.** Temporary geocoding results "are not allowed to be cached"; storing needs `permanent=true` with a card on file. Mission coordinates come from the EAS-based offline geocoder instead.
   - **Amended 2026-10-19 by DL-506 (ADR-REUSE-01):** the Mapbox CLI is for the operator or the Architect only, never in a Builder session, and no Mapbox result sets, checks or corrects committed data (Product Terms §1.6, whether or not the output is committed); ETA and address checks use `map:geocode` and the road graph.

### 5.6 SF map pack (proposal; produced by `tools/map/bake-map.ts`, consumed by C08)

`world/map/sf-map.v1.bin` (+ `sf-map.v1.json` manifest with hashes, sources, licences, `bakedAt`):
- **Frame:** the world ENU frame (City Hall origin, metres; repos-world rec 3). Quantized to 0.5 m in int16 per 256 m × 256 m chunk relative to the chunk origin, so deltas never overflow. Chunk key = `x>>8, z>>8`, shared with world streaming.
- **Layers and draw order:**
  1. water (OSM coastline + bay polygons);
  2. land, parks (`gtr9-ntp6` + OSM leisure);
  3. landuse tint;
  4. building footprints (DataSF, Douglas-Peucker 1 m, tall-building outline weight by height);
  5. streets by `classcode` (widths per class; freeways and ramps from DataSF/OSM `layer`/`bridge`);
  6. one-way arrows (zoomed-in only);
  7. rail and cable car lines (SF repo `cableCarRoutes`);
  8. Muni lines (optional overlay);
  9. neighborhood boundaries (41 polygons);
  10. labels (neighborhoods tiers 1–3; street names along polylines with angle; landmark pins);
  11. dynamic blips.
- **Address index:** `{streetId u16, number u16, suffix u8, x i16, z i16, chunk u16}` for 224,290 base addresses. That is ≈ 2.2 MB raw, ≈ 1 MB gzip (estimate). Street name table: 2,567 names. Used only for search and authoring (lazy-loaded).
- **Road graph link:** every rendered street segment carries its CNN. GPS routes are computed on the drivable graph (`roads/graph.bin`, repos-world rec 5) and drawn as a polyline.
- **Attribution block** embedded in the manifest: "© OpenStreetMap contributors (ODbL)", "City and County of San Francisco (PDDL)", "SFMTA (PDDL via DataSF)".

### 5.7 Minimap renderer design (proposal)

- **Cache.** Rasterize each 256 m chunk once per zoom level into an offscreen tile cache (LRU, ≤ 48 tiles at 256 px), the way gta-sa-earth pre-draws a static map image (`Qb`/`tT` near byte 949,432 of `index.html`: a baked RGBA image drawn per frame, a player arrow rotated by camera heading, click-to-teleport). Per frame, composite the 3×3 visible tiles rotated to player heading, then draw dynamic blips on top.
  - Main-thread budget: ≤ 0.6 ms desktop, ≤ 1.0 ms iPhone at a 30 Hz minimap refresh. Re-rasterize at most 1 chunk per frame.
- **Zoom.** Zoom scales with speed: on foot 150 m radius, driving 250–450 m, racing 600 m. North-up toggle. Neighborhood name banner on district change (Analysis Neighborhoods polygon-in-point).
- **Blips** (C17/C09):
  - mission markers, waypoint, GPS route;
  - police and heat radius (gamedesign §2.8);
  - published experiences (moderated only);
  - property, garage, stores;
  - Muni stops at high zoom.
  - Shapes are distinct as well as colours (accessibility rule in gamedesign §8).
- **Full map (pause).** Pan, pinch and zoom from 0.25 m/px to 8 m/px. Search (EAS + landmarks + neighborhoods). Waypoint, legend, fast travel where the story allows (R-MAP-03). East Bay, Marin and Peninsula appear as low-detail silhouettes labelled "Coming later" (R-MAP-02).
- **Attribution (OSMF guidelines, adopted 2021-06-25).** For games, attribution may be on a splash screen, in the game view, on a credits page or in a menu. On the interactive full map it sits in a corner and may collapse after 5 s if still reachable via an "(i)" button. Ship it in the full-map corner, the pause-menu credits and the boot splash. The minimap needs no permanent label.
- **XR.** The wrist map uses the same renderer at 512 px with no per-frame re-rasterization while the head moves. North-up only, for comfort.

### 5.8 SF accuracy acceptance checks (proposal; extend M02c)

1. Every active, non-paper `3psu-pn9h` segment with `classcode` 1–5 appears in the map pack (count equality ±0.5%).
2. Each of the 41 Analysis Neighborhood polygons contains its own label point, and the HUD banner matches `nhood` of the player's street segment at 20 scripted points.
3. 50 EAS addresses geocode to within 10 m of the address point and onto a segment with the same CNN.
4. One-way arrows match `oneway` F/T on 30 sampled segments.
5. Minimap player position within 5 m at 10 landmark checks (gamedesign M02c).
6. Attribution present in the full map, credits and splash.

---

## Verified facts

| fact | source URL | date checked | confidence |
|---|---|---|---|
| SIWC website sign-in is "currently available to selected commercial partners through a limited trial"; waitlist via OpenAI rep / interest form | https://developers.openai.com/siwc/website ; https://developers.openai.com/siwc/request-client-id | 2026-10-18 | high |
| SIWC OIDC endpoints: issuer `https://auth.openai.com`, authorize `/api/accounts/authorize`, token `/api/accounts/oauth/token`, JWKS `/.well-known/jwks.json`; PKCE S256; scopes openid/profile/email; client id `oaiapp_…`; public and confidential (`client_secret_basic`) clients; don't store raw ID tokens | https://developers.openai.com/siwc/website | 2026-10-18 | high |
| ChatGPT plan usage: open-source/locally hosted apps; paid or remotely hosted → interest form; Responses API requests only; no access to conversations | https://developers.openai.com/siwc/token-sharing-open-source ; https://developers.openai.com/siwc/quickstart | 2026-10-18 | high |
| Plan-usage registration: `client_id=dynamic_agent_client`, `agent_name_hint`, required `ext_agent_host_id`; loopback `127.0.0.1` redirect (not localhost; only port may vary); scopes `offline_access resource.invoke chatgpt.tokens.use.direct`; `resource=https://api.openai.com/v1`; no client secret | https://developers.openai.com/siwc/token-sharing-open-source/sign-in | 2026-10-18 | high |
| Plan-usage inference: `POST https://api.openai.com/v1/responses`, `store:false`, `stream:true`, models from `/v1/models`; error codes `subscription_sharing_usage_limit_exceeded` / `_unavailable` | https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference | 2026-10-18 | high |
| Plan-usage limitations: hosted tools (image gen, file search, Code Interpreter, computer use, hosted MCP, tool_search) unsupported; local shell/MCP via Codex app-server supported; audio/video input unsupported; many request fields unsupported | https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations | 2026-10-18 | high |
| Codex app-server plan mode: `codex app-server --listen stdio://`, `model_provider="openai_chatgpt_plan"`, `wire_api="responses"`, `ACCESS_TOKEN` env, NDJSON `initialize/thread/start/turn/start` | https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server | 2026-10-18 | high |
| User controls: plan usage for Plus and Pro; per-app weekly caps as % of plan; disconnect path; app list (Amp Code, Devin, Notion, Vercel, Warp…; sign-in only: Airtable, Canva, GitLab, HubSpot, Supabase; OSS: OpenClaw, OpenCode, Pi, T3) | https://learn.chatgpt.com/docs/sign-in-with-chatgpt | 2026-10-18 | high |
| DevKit: `@siwc/local` (Node) and `@siwc/react` workspaces; for open-source apps on the user's machine; Noncommercial License v1.0, commercial use needs a written agreement | https://github.com/openai/sign-in-with-chatgpt-devkit (README, LICENSE via raw.githubusercontent.com) | 2026-10-18 | high |
| `@siwc/local` / `@siwc/react` not published on npm (404) | `npm view @siwc/local` | 2026-10-18 | high |
| Community report: refresh returns `invalid_grant` inside documented window (DevKit issue #5) | https://github.com/openai/sign-in-with-chatgpt-devkit/issues/5 | 2026-10-18 | low |
| Supabase launched SIWC beta for supabase.com login and a Supabase plugin in ChatGPT/Codex; post dated 2026-07-29 | https://supabase.com/blog/sign-in-with-chatgpt-beta | 2026-10-18 | high |
| DevDay 2026 on 2026-09-29 announced Sign in with ChatGPT (subscription tokens), plugin extensions, OpenAI Marketplace | https://simonwillison.net/2026/Sep/29/openai-devday-2026-live-blog/ | 2026-10-18 | medium |
| Plugins = skills + MCP servers + optional UI; run in ChatGPT and Codex; public directory review | https://developers.openai.com/plugins | 2026-10-18 | high |
| Plugin auth: OAuth 2.1 per MCP authorization spec; CIMD, DCR, predefined clients; PKCE S256; protected resource metadata | https://developers.openai.com/plugins/build/auth | 2026-10-18 | high |
| Codex CLI: Apache-2.0; install script/npm/Homebrew; Sign in with ChatGPT for Plus, Pro, Business, Edu, Enterprise; `@openai/codex` 0.163.0 (2026-10-17); `@openai/codex-sdk` 0.163.0 | https://raw.githubusercontent.com/openai/codex/main/README.md ; npm registry | 2026-10-18 | high |
| Codex AGENTS.md: global override → AGENTS.md, root→cwd, one per dir, `project_doc_max_bytes` 32 KiB default, fallback filenames config | https://learn.chatgpt.com/docs/agent-configuration/agents-md | 2026-10-18 | high |
| Codex skills: `SKILL.md` with name/description; discovered in `.agents/skills` (cwd→repo root), `$HOME/.agents/skills`, `/etc/codex/skills`; symlinks followed; `$skill` invocation | https://learn.chatgpt.com/docs/build-skills | 2026-10-18 | high |
| Supabase Third-Party Auth supports "Custom OIDC provider": discovery URL, asymmetric JWT with `kid`, `role` claim; `accessToken` client option; RLS on `auth.jwt()->>'sub'`; no CLI config | https://supabase.com/docs/guides/auth/third-party/custom-oidc | 2026-10-18 | high |
| Third-party auth: $0.00325 per third-party MAU beyond quota; key-rotation pickup up to 30 min; Supabase Auth cannot be disabled | https://supabase.com/docs/guides/auth/third-party/overview | 2026-10-18 | high |
| Supabase Custom OAuth/OIDC (sign-in) providers: `custom:` prefix; Free 3, Pro unlimited; PKCE default; issuer discovery | https://supabase.com/docs/guides/auth/custom-oauth-providers ; https://supabase.com/blog/custom-oauth-oidc-providers (2026-04-08) | 2026-10-18 | high |
| Supabase `signInWithWeb3` accepts `wallet` (EIP-1193/6963) or `{message, signature}` (EIP-4361) | https://supabase.com/docs/guides/auth/auth-web3 | 2026-10-18 | high |
| Convex accepts OIDC providers or `customJwt` (headers kid/alg/typ; claims sub/iss/exp; iat for refresh) | https://docs.convex.dev/auth/advanced/custom-jwt | 2026-10-18 | high |
| `thirdweb` 5.122.0, Apache-2.0, 2026-10-12; strategies email/phone/14 socials/guest/jwt/auth_endpoint/passkey/wallet/backend; social `mode` redirect/popup/window; `linkProfile`/`getProfiles`/`unlinkProfile`; `getAuthToken`; `adapters/eip1193 toProvider`; `createAuth` | npm tarball `thirdweb@5.122.0` `dist/types/**` | 2026-10-18 | high |
| thirdweb in-app wallet: guest accounts "upgrade" by linking; EIP-7702 `executionMode` keeps address; 4337 gives a different address; state in localStorage | https://portal.thirdweb.com/typescript/v5/inAppWallet | 2026-10-18 | high |
| thirdweb custom auth: `jwt` (OIDC; JWKS URL + aud in dashboard) and `auth_endpoint` | https://portal.thirdweb.com/wallets/custom-auth | 2026-10-18 | high |
| thirdweb plans: Growth $99/mo (Custom In-App Wallet Auth), Scale $499/mo (remove branding, audit logs), Pro $1,499+/mo; user wallets first 1,000 free then $0.015/$0.01/$0.0075/$0.005 per MAU; gas sponsorship 1,000 tx incl. then $1/1k + 2.5% mainnet surcharge | https://thirdweb.com/pricing | 2026-10-18 | high (page layout repeats tiers per plan; per-plan mapping medium) |
| thirdweb upgrade requires billing info first; "Starter" referenced as downgrade target | https://portal.thirdweb.com/account/billing/upgrade-plan | 2026-10-18 | medium |
| `viem` 2.57.7 exports `createSiweMessage`, `parseSiweMessage`, `verifySiweMessage` from `viem/siwe` | npm tarball `viem@2.57.7` `_types/**` | 2026-10-18 | high |
| `@mediapipe/tasks-vision` 1.1.1 (2026-10-14), daily 1.2.0 RCs; `delegate: "CPU"|"GPU"`; `canvas: HTMLCanvasElement|OffscreenCanvas`; PoseLandmarker defaults (numPoses 1, confidences 0.5) | npm registry + tarball `vision.d.ts` | 2026-10-18 | high |
| tasks-vision WASM: SIMD 13,519,922 B (3,954,071 B gzip), no-SIMD 12,627,509 B, no threaded build | npm tarball `wasm/` listing | 2026-10-18 | high |
| Pose models: lite 5,777,746 B, full 9,398,198 B, heavy 30,664,242 B; inputs 224/256 px float16; 33 landmarks list; IMAGE/VIDEO/LIVE_STREAM | https://storage.googleapis.com/mediapipe-models/pose_landmarker/… (HEAD) ; https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker | 2026-10-18 | high |
| BlazePose GHUM 3D model card: Apache-2.0; Pixel 3 FPS lite 44 CPU/49 GPU, full 18/40, heavy 4/19; out of scope multi-person, >4 m, surveillance | https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf | 2026-10-18 | high |
| 1€ filter: Casiez, Roussel, Vogel, CHI '12; tuning: beta 0, mincutoff ≈1 Hz, then raise beta | https://gery.casiez.net/1euro/ | 2026-10-18 | high |
| Safari OffscreenCanvas: 16.4 2D-only; WebGL in OffscreenCanvas from Safari 17.0 (iOS too) | https://caniuse.com/mdn-api_offscreencanvas_getcontext_webgl_context ; https://bugs.webkit.org/show_bug.cgi?id=253431 | 2026-10-18 | medium |
| requestVideoFrameCallback on Safari iOS 15.4+; MediaStreamTrackProcessor worker-only in Safari 18 | https://caniuse.com/wf-request-video-frame-callback ; https://blog.mozilla.org/webrtc/unbundling-mediastreamtrackprocessor-and-videotrackgenerator/ | 2026-10-18 | medium |
| iOS home-screen apps: getUserMedia listed supported since iOS 13; iOS 26 opens every Home Screen site as a web app by default | https://firt.dev/notes/pwa-ios/ | 2026-10-18 | medium |
| Standalone-mode camera regressions reported (WebKit bugs) | https://bugs.webkit.org/show_bug.cgi?id=185448 ; https://bugs.webkit.org/show_bug.cgi?id=275527 | 2026-10-18 | low |
| YOLO26-pose table (n 57.2 mAP, 40.3 ms CPU ONNX, 2.9 M params, 7.6 GFLOPs @640), 17 COCO keypoints, ONNX export; YOLO27 waitlist | https://docs.ultralytics.com/tasks/pose/ | 2026-10-18 | high |
| Ultralytics licensing: AGPL-3.0 or Enterprise; SaaS/cloud needs Enterprise; trained models AGPL by default | https://www.ultralytics.com/license | 2026-10-18 | high |
| onnxruntime-web 1.30.0 (MIT, 2026-09-18); WebGPU EP import `onnxruntime-web/webgpu`, `executionProviders:['webgpu']`, GPU IO binding | npm registry ; https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html | 2026-10-18 | high |
| Mapbox CLI: blog 2026-10-08, MIT, repo `mapbox/mapbox-cli`, commands generated from OpenAPI specs, groups listed in §5.5, `--schema`, `--dry-run`, `mapbox mcp install`, `agent-skills`; latest 0.3.0 released 2026-09-22; sends one telemetry event per run (opt-out `MAPBOX_CLI_NO_TELEMETRY=1`) | https://www.mapbox.com/blog/new-mapbox-cli-for-coding-agents ; https://raw.githubusercontent.com/mapbox/mapbox-cli/main/README.md ; https://cli.mapbox.com/latest/manifest.json | 2026-10-18 | high |
| Mapbox pricing: GL JS map load = each initialization; 50k free then $5.00/$4.00/$3.00/$2.50 per 1k; Vector Tiles 200k free then $0.25/1k; Temporary Geocoding 100k free then $0.75/1k; Directions 100k free then $2.00/1k | https://www.mapbox.com/pricing | 2026-10-18 | high |
| Mapbox GL JS licence: "for use only with the relevant Mapbox product(s)", billing code must not be modified; `mapbox-gl` 3.33.0 (2026-10-13), 1,906,329 B (521,671 B gzip) | npm tarball `mapbox-gl@3.33.0` LICENSE.txt | 2026-10-18 | high |
| Mapbox Standard: default style in v3; light presets dawn/day/dusk/night via `setConfigProperty('basemap', …)`; 3D landmark models | https://docs.mapbox.com/mapbox-gl-js/guides/styles/set-a-style.md ; https://docs.mapbox.com/mapbox-gl-js/guides/migrate | 2026-10-18 | medium |
| Mapbox temporary geocoding results may not be cached; `permanent=true` to store, needs a card on file | https://docs.mapbox.com/api/search/geocoding/ | 2026-10-18 | high |
| MapLibre GL JS 6.15.0 (BSD-3, 2026-10-18): ESM-only, WebGL2 required (v6 breaking changes); `maplibre-gl.mjs` 292,747 B + worker 147,001 B gzip | npm registry + tarball ; https://newreleases.io/project/github/maplibre/maplibre-gl-js/release/v6.0.0 | 2026-10-18 | high (sizes), medium (changelog via mirror) |
| `pmtiles` 4.5.0 (BSD-3) | npm registry | 2026-10-18 | high |
| Protomaps v4 daily builds; ODbL Produced Work, OSM attribution; hotlinking discouraged; planet ≈120 GB (docs) | https://docs.protomaps.com/basemaps/downloads | 2026-10-18 | high |
| Protomaps planet build 20261018.pmtiles = 138,978,594,030 B, version 4.15.2 | https://build-metadata.protomaps.dev/builds.json | 2026-10-18 | high |
| Measured SF bbox extract: 422 tiles, 23.7 MB raw MVT, ≈13.1 MB gzip (z0–15); ≈3.9 MB gzip (z0–14) | measurement via `pmtiles` range reads of https://build.protomaps.com/20261018.pmtiles | 2026-10-18 | high |
| OpenFreeMap: free, no keys, commercial OK, attribution required, offline download cap 3,000 tiles/50 MB, no SLA | https://openfreemap.org/ | 2026-10-18 | high |
| OSMF Attribution Guidelines (adopted 2021-06-25): interactive maps credit in a corner, may collapse after 5 s; games may attribute via splash, game view, credits or menu | https://osmfoundation.org/wiki/Licence/Attribution_Guidelines | 2026-10-18 | high |
| DataSF Streets `3psu-pn9h`: PDDL, 17,176 rows (16,378 active), daily refresh, classcode legend, oneway F/T/B, CNN node fields, layer values incl. PAPER* | https://data.sf.gov/api/views/3psu-pn9h.json ; https://data.sf.gov/resource/3psu-pn9h.json (SoQL) | 2026-10-18 | high |
| DataSF Analysis Neighborhoods `j2bu-swwd`: PDDL, 41 neighborhoods | https://data.sf.gov/api/views/j2bu-swwd.json | 2026-10-18 | high |
| DataSF EAS `ramy-di5m`: PDDL, 388,647 rows, 224,290 distinct base addresses, lat/lon + CNN | https://data.sf.gov/api/views/ramy-di5m.json ; SoQL count | 2026-10-18 | high |
| DataSF Muni Stops `i28k-bkz6` (3,260, PDDL, SFMTA), Muni Simple Routes `9exe-acju` (135, PDDL), Rec & Parks `gtr9-ntp6` (255, PDDL), Elevation Contours `rnbg-2qxw` (14,151, 5-ft, PDDL), Parcels `acdm-wktn` (PDDL), Street Trees `tkzw-k3nq` (PDDL), SF Find Neighborhoods `pty2-tcw4` (USGOV_WORKS) | https://data.sf.gov/api/views/<id>.json | 2026-10-18 | high |
| BART developer licence: revocable right to use/redistribute data; BART marks may not be used in association with data | https://www.bart.gov/schedules/developers/developer-license-agreement | 2026-10-18 | medium |
| SF repo baked map data: roads.json 33,187 ways / 392,344 vertices; labels.json 94 neighborhoods + 1,200 road labels; int16-delta 0.5 m re-encode 1,668,937 B / 794,154 B gzip | local `San-Francisco/public/data/*` (measured) | 2026-10-18 | high |
| gta-sa-earth minimap: pre-baked RGBA image drawn per frame into a 460×460 canvas, heading arrow, click-to-teleport (`Qb`, `tT`) | local `gta-sa-earth/index.html` byte ≈949,432 | 2026-10-18 | high |
| `@cloudflare/workers-oauth-provider` 1.2.3 (MIT), `agents` 0.28.1 (MIT), `@modelcontextprotocol/sdk` 1.32.1, `jose` 6.2.12, `@supabase/supabase-js` 2.118.0, `convex` 1.47.0 | npm registry | 2026-10-18 | high |

## Unverified

- UNVERIFIED: whether a free thirdweb Starter plan still exists in Oct 2026 and what it allows. The pricing page lists only Growth, Scale and Pro; billing docs still mention Starter.
- UNVERIFIED: whether thirdweb `guest` wallets count as monthly active wallets (assumed yes; design avoids `guest`).
- UNVERIFIED: the server-side endpoint for verifying a thirdweb `getAuthToken()` JWT, and whether `createAuth` JWTs (signed by an Ethereum admin account) are accepted by Supabase third-party auth. The design uses SIWE + our own issuer instead.
- UNVERIFIED: tree-shaken bundle size of `thirdweb/wallets/in-app` in a Vite build.
- UNVERIFIED: whether Supabase `linkIdentity` works with `custom:` OAuth providers, and whether `signInWithWeb3` can link to an existing anonymous user rather than create a new one.
- UNVERIFIED: compatibility of Supabase custom OIDC sign-in providers with OpenAI's confidential-client rule (`client_secret_basic` only; no fallback).
- UNVERIFIED: eligibility of a commercial but open-source game's local Studio for ChatGPT plan usage without the interest form. The docs say open-source and locally hosted apps qualify, but paid apps should apply.
- UNVERIFIED: exact eligibility (plan tiers, regions) for website sign-in once out of trial; no GA date published.
- UNVERIFIED: Codex app-server install requirements and stability of its NDJSON method names across versions (docs list methods but not versioning).
- UNVERIFIED: the OpenAI help-centre article (help.openai.com/…/20001410) returned 403. Plus-vs-Pro five-hour-limit details come from secondary sources only.
- UNVERIFIED: PoseLandmarker latency and FPS on iPhone Safari (CPU vs GPU delegate) and on desktop browsers. No first-party benchmark found.
- UNVERIFIED: MediaPipe left/right landmark convention under a mirrored selfie stream (design sidesteps it via calibration).
- UNVERIFIED: accuracy of `requestVideoFrameCallback` `captureTime`/`expectedDisplayTime` on iOS (a WebKit bug reports imprecise `mediaTime`).
- UNVERIFIED: camera reliability in iOS 26/27 standalone PWAs (regressions reported on 17.5.1).
- UNVERIFIED: onnxruntime-web WebGPU EP on iOS Safari 26 (ORT docs still say Technology Preview).
- UNVERIFIED: licence of RTMPose/RTMO weights (code is Apache-2.0 per third-party index).
- UNVERIFIED: whether Cloudflare Workers static assets honour `Range` for a `.pmtiles` file. The design fetches the whole ≈3.9 MB archive and reads it locally if not.
- UNVERIFIED: 511.org open-data licence terms (terms page 404).
- UNVERIFIED: map-pack size for water/parks/footprints/address layers. Estimates are given; only the roads layer was measured.
- UNVERIFIED: Mapbox Standard config key names for toggling 3D objects (not needed; Mapbox is out of runtime).

## Recommendations for the spec

Identity (S09, S10):
1. Write ADR "identity spine". The default is a Worker-hosted OIDC issuer (`https://id.<domain>`, ES256, `kid`, JWKS, `role='authenticated'`, `sub=profile_id`), trusted by Supabase via Third-Party Auth "Custom OIDC" and by Convex via OIDC/`customJwt`. The documented fallback is Supabase anonymous sign-in + `linkIdentity` (stack-cloudflare-backend §10). Record the trade-offs from §1.2.
2. Freeze `IdentityService` and the tables in §1.4 into C12. Key every row on `profile_id`. Provider subjects live only in `identities`. Linking a subject owned by another profile creates a `merge_request` and never moves silently.
3. Implement phases P0–P3 exactly as in §1.3. P0 needs no server account. P1 at M12 registers a device public key with Turnstile. Publishing and forum writes require `tier='linked'` (or an ADR-defined device-age rule).
4. Serve `/account/*` and `/link` without COOP/COEP. Use full-page redirects for every provider (thirdweb `mode:'redirect'`). Never use popups or iframes from the isolated game document.
5. Ship Thirdweb as one adapter in `packages/identity/providers/thirdweb.ts`. Lazy-load it on `/account/*`. Auth options: `email`, `passkey`, `google`, `apple`. **Never use `guest`.** Link by SIWE (`viem/siwe`) verified in the Worker, with a single-use 5-minute nonce. No smart accounts (EOA only), no gas sponsorship.
6. Gate M14a on the owner holding a thirdweb Growth subscription. Put the cost model in §2.3 into the spec's cost section and a budget alarm on MAW > 25% of MAU.
7. Document the "email OTP via Supabase Auth" adapter as the zero-vendor alternative to Thirdweb behind the same interface.

ChatGPT and modding (S12, S09):
8. Make Flow A (bring your own agent) the M13c deliverable:
   - `AGENTS.md` ≤ 24 KiB;
   - `CLAUDE.md` importing `@AGENTS.md`;
   - canonical `skills/` symlinked to `.agents/skills` and `.claude/skills`, with a CI check that both resolve;
   - the `thabay-mcp` stdio server with the tool list in §3.3, pre-registered in `.mcp.json` and `.codex/config.toml`;
   - the `thabay` CLI (`create`, `dev`, `validate`, `preview`, `pack`, `login`, `publish`).
   Document "Use Codex and choose Sign in with ChatGPT" as the supported ChatGPT path.
9. Implement RFC 8628 device-code login (`/api/v1/id/device-code`, `/api/v1/id/device-token`) for the CLI, with scope `mods:publish`, 10-minute codes and approval on `/link`.
10. Treat Flow B (plan usage inside `thabay studio`) as an ADR-gated stretch. If adopted, implement §3.1's plan-usage protocol directly, with no DevKit code (Noncommercial licence). Persist `ext_agent_host_id` as `urn:uuid`, use a `127.0.0.1` loopback redirect, store credentials at mode 0600 or in the keychain, and run Codex app-server for the agent loop. Show "Using ChatGPT plan" / "Manage usage". Handle `subscription_sharing_usage_limit_exceeded` and refresh `invalid_grant` by re-authorizing.
11. Build Flow C (hosted "Continue with ChatGPT") behind `AUTH_OPENAI_WEB=false`. Submit the OpenAI interest form at M13 start. Implement as a confidential client in the Worker (`client_secret_basic`, PKCE S256, nonce, `jose` JWKS verification), identity scopes only. Discard the ID token after linking.
12. Defer Flow D (ChatGPT/Codex plugin) to post-launch. When built, use `agents` + `@cloudflare/workers-oauth-provider` on Workers, conform to the MCP authorization spec 2025-11-25, and reuse Flow A's tools.
13. Give the hosted in-browser builder a data-only editor plus a server-side Claude assistant under G3 quotas. It runs no user code and makes no plan-usage calls.
14. Add map-aware moderation rules (§3.4): anchors inside SF land and on public right-of-way or parks, no single-residential-parcel anchors, address-string flagging against EAS.

Pose (S07, S11):
15. Pin `@mediapipe/tasks-vision` to an exact stable 1.x. Self-host the SIMD + no-SIMD WASM and `pose_landmarker_lite.task` / `full.task` as static assets. Precache them only after the player enables pose mode (≈ 4 MB gzip WASM + 5.8–9.4 MB model).
16. Run inference in a dedicated PoseWorker with VIDEO running mode, ImageBitmap transfer from `requestVideoFrameCallback`, and optional `MediaStreamTrackProcessor`. Benchmark CPU vs GPU delegates at calibration and keep the faster p95.
17. Specify the gesture FSM, thresholds, conflict rules and two-bank One-Euro filtering in §4.3, plus the stance-based lead/rear mapping (no reliance on left/right labels). Specify the fixture-clip test harness: recorded `.webm` files with labelled onset frames, ≥ 90% per-gesture accuracy, ≤ 2-frame recognition delay.
18. Adopt the split latency budget in §4.5 as M08c acceptance. Desktop: ≤ 150 ms p50 / ≤ 200 ms p95 onset→photon. iPhone: ≤ 180 / ≤ 240.
19. Exclude Ultralytics YOLO from all dependency trees. Add a CI licence check that fails on AGPL packages and weights. Document ORT WebGPU + a permissively licensed multi-person model as a future ADR for couch two-player pose.
20. Enforce R-IP-04 with headers (`Permissions-Policy: camera=(self)`, strict `connect-src`) and an e2e network assertion: no image payloads and no request body > 4 KB during pose mode.

Maps (S02, S10):
21. Write ADR "map stack". The in-game minimap and full map are an in-engine Canvas 2D/OffscreenCanvas renderer over `world/map/sf-map.v1.bin`, mirrored to a `CanvasTexture` in XR. Out-of-game web surfaces use MapLibre GL JS 6.15.x + `sf.pmtiles` (Protomaps v4, z0–14, ≈3.9 MB) self-hosted. Mapbox has no runtime use.
22. Bake `sf-map.v1.bin` with the layer list, quantization (0.5 m, int16 per 256 m chunk), CNN links and attribution manifest in §5.6. Take SF streets from DataSF `3psu-pn9h` (exclude `PAPER*` layers), neighborhoods from `j2bu-swwd`, parks from `gtr9-ntp6` and transit from `i28k-bkz6`/`9exe-acju`, under parody names. Add `ramy-di5m` as an offline geocoder index (lazy).
23. Specify the minimap behaviours in §5.7: speed-scaled zoom, rotating view, chunk raster LRU, blip vocabulary with shape coding, GPS route on the drivable graph, neighborhood banner. Budgets: ≤ 1.0 ms main thread on iPhone at 30 Hz, ≤ 1 chunk raster per frame.
24. Place OSM/DataSF attribution in the full-map corner (collapsible after 5 s with an "(i)"), pause-menu credits and the boot splash, per the OSMF guideline for games.
25. Never store Mapbox geocoding output. The Mapbox CLI is optional developer tooling (`MAPBOX_CLI_NO_TELEMETRY=1` in CI), and nothing it returns is committed. Mission and experience coordinates come from the EAS geocoder or the map editor.
26. Add the SF accuracy checks in §5.8 to M02c's acceptance criteria.

## Risks

1. **OpenAI program churn.** SIWC is weeks old, partially in limited trial, and the docs moved hosts during this research (`developers.openai.com/codex` → `learn.chatgpt.com`). Mitigation: Flow A depends only on Codex's public behaviour. Flows B, C and D are flagged and ADR-gated.
2. **DevKit licence contamination.** Copying DevKit code into a commercial repo violates its Noncommercial licence. Mitigation: own implementation, and a CI grep for the DevKit licence header.
3. **Plan-usage eligibility for a commercial game.** If the owner monetizes, the local Studio may need OpenAI approval. Mitigation: Flow A needs no approval.
4. **Refresh-token failures** (community-reported `invalid_grant`). Mitigation: re-authorize UX; never block local modding on refresh.
5. **Thirdweb cost and lock-in.** Growth is $99/mo minimum, and MAW billing scales with linked users; branding removal is $499/mo. Mitigation: no guest wallets, identity behind an adapter, email-OTP alternative.
6. **Own-issuer security burden.** Key rotation (30-minute Supabase pickup), refresh rotation and device-key theft. Mitigation: two active keys, short access tokens, device-key revocation table, Turnstile on registration, anomaly alerts.
7. **Pose latency on iPhone is unmeasured.** It may exceed budgets or overheat devices. Mitigation: calibration-time delegate benchmark, lite model, pose ruleset leniency, quick fallback to touch, M08c as a hard gate.
8. **iOS standalone camera regressions.** Mitigation: detect failure and offer to "Open in Safari"; pose is optional.
9. **YOLO/AGPL accidental inclusion** via tutorials or agent-generated code. Mitigation: CI licence gate and AGENTS.md rule.
10. **ODbL share-alike on the map pack.** It is a derived database. Mitigation: ship the bake scripts and pack under ODbL (repos-world risk 1); keep proprietary data out of the same database.
11. **Real addresses in UGC.** EAS makes every SF address searchable. Mitigation: anchor rules (§3.4), no residential targeting, report button.
12. **Second WebGL context on iPhone** if someone wires MapLibre into the game view. Mitigation: ADR forbids MapLibre inside the game document; enforce with a lint rule.

## Open questions

1. Q-AUTH-01: Accept the Worker-hosted OIDC issuer as the identity spine (recommended), or keep Supabase anonymous sign-in as the spine? (S09 ADR; affects M12.)
2. Q-AUTH-02: Will the game be commercial (paid, ads or IAP)? This decides OpenAI interest-form needs for Flow B, DevKit usability (no), and whether thirdweb Scale is needed to remove branding.
3. Q-AUTH-03: Which Thirdweb login methods does the owner want shown (email, passkey, Google, Apple, Discord, X…)? SMS/phone adds per-message cost (price not listed).
4. Q-AUTH-04: Is publishing allowed for `tier='device'` profiles after an account-age threshold, or only for linked profiles?
5. Q-MOD-01: Will the game repo be open-source (licence?) so the local Studio qualifies as an open-source app for ChatGPT plan usage?
6. Q-MOD-02: Should Flow D (ChatGPT/Codex plugin) be on the roadmap, given directory review?
7. Q-POSE-01: Target devices for pose QA (iPhone 15/16/17, which webcams)? Is a phone stand assumed?
8. Q-POSE-02: Is couch two-player pose versus wanted? It is the only case that justifies a multi-person model and an ADR.
9. Q-MAP-01: North-up or heading-up minimap by default? Should a fog-of-war "discover SF" mechanic exist for story Act 1?
10. Q-MAP-02: Real Muni/BART line names on the map, or parody names (IP default: parody)?
11. Q-MAP-03: Include contour/hillshade styling on the full map (adds ≈1–2 MB; strong SF recognizability cue)?
