# legal-ip-likeness — IP, trademark, likeness and UGC constraints the spec must enforce

Research dimension `legal-ip-likeness` (S00 sweep) for **Dee-Verse: GTA – Tha Bay**. All web facts checked **2026-10-18**.

**This is engineering guidance, not legal advice.** It turns public law, court decisions and vendor terms into build rules, schemas and CI gates that reduce risk. A licensed California attorney should review the title, the likeness tiers, the ToS and the consent forms before any public launch. Where a question needs a legal judgment, the report says so and lists it under Open questions.

Feeds: S05 (asset pipeline: provenance, CI, likeness gates), S04 (NPC: soul.md likeness block, kill-switch), S03 (cutscenes), S07 (fighter roster), S06 (vehicles/venues), S09 (UGC tables, takedown API, CSAM path), S10 (age gate, legal pages, credits), S12 (mod/UGC publish pipeline), S13 (constraints block, risk register).

Binding inputs read first:
- `research/owner-updates.md`: SF accurate first; Grand-V patterns translated to English; IP line unchanged.
- `research/repos-webport.md` §5 and `research/repos-grand-v.md` §5: the DO NOT REUSE lists. Both are merged into the audit in §2.
- `research/ai-npc-runtime.md`: §1.3 likeness block, §1.7 user-NPC validation, §5 voice tiers, §6.2 tables. This report hardens and extends them; it does not replace them.
- `research/gamedesign-decomposition.md`: P-6 `NameRegistry`, §11 depiction flags.
- `research/repos-world.md` §4: map-data licences, already verified there and not repeated here.
- `prompt-pack/05-APPENDIX.md` §C/§D and `06-SHARED-CONTEXT.md` (R-IP-01..04, C07, C14, C17).

Local repos audited: `${REPOS}` = `/tmp/claude-0/-home-user/d5596183-032b-5cac-9516-8839e0bfb562/scratchpad/repos/{playgta5, muguet, Grand-V, gta-sa-earth, SK8V, universal-modder, San-Francisco, SF-Bay-Area-AI-Atlas}`.

---

## 0. Headline findings

1. **Do not ship "GTA" in the title.** Take-Two holds registered **GTA** word marks for game software (Reg. 3439237, first use 1999; Reg. 6886747, Class 9) and **GRAND THEFT AUTO** (Reg. 4321159). Since *Jack Daniel's v. VIP* (2023), the *Rogers* free-expression shield does not apply when a mark is used as a source identifier for one's own goods, and a game title is exactly that use (*Punchbowl v. AJ Press*, 9th Cir. 2024). The parody exclusion from dilution also does not apply to such uses. Take-Two acts on near-misses: it challenged *It Takes Two*, opposed "Rockstar Axe Throwing", and opposed Remedy's logo in the UK. Keep "GTA" as an internal codename only. Ship a name like **"Dee-Verse: Tha Bay"** from one config value.
2. **Take-Two moves fast against browser ports.** The example source itself, playgta5.com, went offline within hours of going viral on 2026-10-06. A DOS Zone Vice City browser port got a DMCA notice in December 2025, even though it required the player's own game files. The re3/reVC authors were sued in 2021 after a DMCA counter-notice. Rockstar's mods tolerance policy expressly excludes "new games, stories, missions, or maps". **Any Rockstar-derived byte, symbol, name or file layout in our repo or CDN is a takedown trigger.** §2 gives the audit and the CI design.
3. **Real people: the risk comes from realism and marketing, not from homage.** California protects transformed caricature: *Winter v. DC Comics* (half-worm "Autumn brothers") and *Kirby v. Sega* (Ulala). It does not protect literal depictions doing what the person is famous for: *No Doubt v. Activision* and *Keller v. EA*. Rockstar's own GTA V parody avatars survived Lindsay Lohan's suit because they were "satirical representations of the style, look, and persona" and not identifiable as her (*Lohan v. Take-Two*, N.Y. 2018). The Ninth Circuit's common law reaches anything that evokes a person's identity in a commercial setting (*White v. Samsung*), and sound-alike voices are actionable (*Waits v. Frito-Lay*). So the `parody` tier must be **visually transformed, renamed, out of the person's fame domain, never voice-matched, and never used in marketing**.
4. **Mac Dre (deceased 2004-11-01) needs the most care.** Civil Code 3344.1 (amended by AB 1836, effective 2025) makes a "digital replica" in an audiovisual work actionable at the greater of $10,000 or actual damages. A digital replica is a "computer-generated, highly realistic electronic representation that is readily identifiable". Satire and parody are express exceptions. Post-mortem rights last 70 years. The estate is headed by his mother, Wanda Salvatto, who also owns the MAC DRE marks. **Default him to `fictionalized`, not `parody`, until the estate consents.**
5. **Every vendor in the pipeline bans non-consented real-person likeness or voice, and some ban more.**
   - OpenAI: no likeness or voice without consent where it could confuse authenticity.
   - fal AUP §3.3: no impersonation or deepfakes using another person's name, image, voice or likeness without consent.
   - MiniMax H3: impersonation ban.
   - ElevenLabs: no cloning without consent. Professional Voice Cloning is limited to your own voice.
   - **ElevenLabs Music:** no artist names in prompts at all, and no mimicking a recording artist. Self-serve plans exclude "Studio Games" (games with ≥$500k lifetime revenue or a publisher with ≥$1M annual game revenue), which require Enterprise Music.
   - **MiniMax H3 open-weight licence:** excludes the United States. Its outputs may not be used outside the licensed territory, so self-hosting H3 for this game is not licensed. Use only a hosted API under its own terms. Disney v. MiniMax survived a motion to dismiss on 2026-05-22, so never prompt for third-party characters.
6. **fal's API terms shape the architecture.** "Client will not expose any of the Services APIs directly to any End Users". We are liable for end users and must flow fal's AUP down in our ToS. So every generation request goes through our Worker. This matches the existing Worker/Queue design.
7. **UGC duties now include two hard deadlines.**
   - **TAKE IT DOWN Act** (enforced since 2026-05-19): remove reported non-consensual intimate imagery, including AI "digital forgeries", within **48 hours**, plus known identical copies. Penalty: $53,088 per violation.
   - **18 U.S.C. 2258A:** report apparent CSAM to NCMEC's CyberTipline "as soon as reasonably possible" and preserve it for **1 year**.
   - **DMCA §512 safe harbor** requires a registered designated agent ($6, expires every **3 years**), a notice form, a counter-notice path (restore in 10–14 business days), and a repeat-infringer policy. §230 does not cover IP claims.
8. **AI-NPC law favours the "video game" design.** California SB 243 (companion chatbots; signed 2025-10-13; private right of action of at least $1,000 per violation) excludes bots that are part of a video game and limited to game topics, which cannot discuss mental health, self-harm or sexually explicit content. NPC rails must keep that shape.
9. **AI-only music is probably not protectable, but it is usable.** The Copyright Office says "prompts alone do not provide sufficient human control". The Supreme Court denied cert in *Thaler* on 2026-03-02. Udio disabled downloads in October 2025, so it is unusable for shipped assets. Hyphy as a genre is free to use. Specific artists' voices, samples, names and melodies are not.
10. **Thirdweb stays identity-only.** Its terms ban creating "any token that may constitute a security" and "illegal online gambling". The SEC treated NFTs that funded an animated series as securities (*Stoner Cats*, 2023). Randomized rewards that are transferable on-chain could become a "thing of value" under California's slot-machine law. Ship no tokens, no NFTs, no loot boxes and no cash-out. Default chat to off for minors (FTC v. Epic: $275M COPPA + $245M dark patterns; HoYoverse: $20M).

---

## 1. Title, trademark and trade dress

### 1.1 Facts that drive the decision
- **Marks.** GTA (Reg. 3439237 and Reg. 6886747) and GRAND THEFT AUTO (Reg. 4321159) are live Take-Two registrations covering game software. A pending GRAND THEFT AUTO VI family was filed 2023-12-04. Rockstar's "R" logo is enforced: Take-Two filed UK oppositions against Remedy's new logo on 2023-05-11.
- **Doctrine.**
  - *Jack Daniel's* (2023): *Rogers* does not apply where the accused use designates the source of the user's own goods. The dilution "noncommercial use" exclusion does not protect parodies used as source identifiers.
  - *Punchbowl v. AJ Press* (9th Cir. 2024-01-12): naming one's own product with the mark is source-identifying, so *Rogers* is out.
  - *E.S.S. v. Rock Star Videos* (9th Cir. 2008): Rockstar's own "Pig Pen" parody of a real strip club inside GTA San Andreas was protected under *Rogers*. In-world parody uses are still defensible. Title uses are not.
- **Enforcement pattern.**
  - Trademark claim against *It Takes Two* (2021): Hazelight gave up its trademark while the dispute was ongoing.
  - TTAB opposition to "Rockstar Axe Throwing" (2020).
  - DMCA plus lawsuit against re3/reVC (N.D. Cal. 3:21-cv-06831, filed 2021). The named defendants were dismissed with prejudice in 2023 after a settlement.
  - DMCA notice to DOS Zone via Ebrand (Dec 2025).
  - playgta5.com went offline 2026-10-06.

### 1.2 Analysis (engineering view)
"Dee-Verse: GTA – Tha Bay" uses Take-Two's word mark, in Take-Two's own goods class, as part of our product name. That is the use the Lanham Act "most cares about". *Rogers* will not help, and parody is only one factor in a likelihood-of-confusion analysis. The title also does not comment on GTA; it borrows GTA's goodwill to signal genre. Expect a demand letter at the latest when the game gets attention, and probably a GitHub or registrar complaint before that. "Grand Theft …" formatives carry the same risk.

### 1.3 Requirements
- **R-NAME-1 One source of truth.** `config/brand.ts` exports `{ codename: 'tha-bay', displayName, shortName, legalName, tagline, wordmarkAsset, disclaimer }`. A build step generates the PWA `manifest.webmanifest` (`name`, `short_name`), `<title>`, OG/Twitter meta, the title screen, credits, the store/forum header and the service-worker cache name from it. No other file may contain the display name. CI rule `names:brand` greps the built bundle for literals.
- **R-NAME-2 Shipped-name denylist.** CI fails if any shipped string, asset filename, URL, domain or package name matches `/\bG\.?T\.?A\b|grand\s*theft|rockstar|take-?two/i`. The only allowlisted locations are the `legal/` notices and `docs/research/`. The disclaimer text is fixed: "Not affiliated with, endorsed by, or sponsored by Rockstar Games or Take-Two Interactive."
- **R-NAME-3 Candidate names** (each needs a USPTO knock-out search and counsel clearance before use; none was searched here): "Dee-Verse: Tha Bay", "Dee-Verse: Fog City", "Dee-Verse: Hyphy City", "Dee-Verse: 415", "Dee-Verse: Bay Run". Recommended default: **"Dee-Verse: Tha Bay"**. It keeps the owner's voice and drops every Take-Two element.
- **R-NAME-4 Repo and domains.** Rename `gratitude5dee/GTA-Tha-Bay` (for example to `dee-verse-tha-bay`) before the repo or any deployment becomes public. GitHub may suspend accounts that show "clear intent to mislead" with a trademark and can reassign names. Never register domains containing "gta" or "grandtheft".
- **R-NAME-5 Trade dress to avoid:**
  - the Pricedown typeface (its free licence excludes webfonts and games anyway);
  - the GTA cover-art grid of panelled illustrations;
  - the Rockstar loading-screen choreography (already banned in repos-webport §5.4);
  - a 5-star "wanted" HUD that copies GTA's look. Use the original "heat" meter in gamedesign §2.8 with its own iconography.
  - Fonts must be OFL or owned.
- **R-NAME-6 Genre homage is allowed through mechanics, not marks.** Open world, police heat, radio, missions and satire of SF tech culture are all fine. Marketing copy may say "open-world crime-comedy set in San Francisco". It may not say "GTA-style", "GTA in SF" or "the Bay's GTA".

---

## 2. Rockstar assets, code, maps: absolute prohibition and how to audit it

### 2.1 Example-repo inventory (what each one is, legally)

| Repo (remote) | Licence | Rockstar/third-party IP inside or reachable | Allowed use |
|---|---|---|---|
| playgta5 (`shadany7824/playgta5`) | none (scraped site JS; unidentified port author) | `game.js`, `loader.js`, `io_worker.js`, `wgpu_worker.js` (runtime for a RAGE `game.wasm`); `data-manifest.json` (5,814 entries); `shader-index.json`; `snapshot/*` inventories incl. `manifest-sha256.json`, `files.jsonl`; `asset-evidence.json` (RPF headers); `homepage.html` loading-screen port; bundled Windows Python runtime (`runtime/*.exe/.dll/.pyd`) | Patterns only, per repos-webport §4. Nothing copied. |
| muguet (`c22dev/muguet`) | GPL-3.0-or-later | `mp.rs` GTA native tables, `patch.rs` hook targets, `bc1_astc.wgsl`, `minimap_alpha.wgsl`, `assets/*` | Patterns only. Any copied code would GPL the repo. |
| Grand-V (`sharkpaw/Grand-V`, per owner update) | **no licence** for the upstream launcher code | `web-tr/oyun_turkce.py` (RPF7/GXT2/OIV writers), `kurulum.rs` language-slot swap and Menyoo bridge, `menyoo.tr.json` (GPL trainer strings), asset-torrent flow, `grand-logo-v2.png` | Feature/UX patterns only, re-implemented in English (repos-grand-v §3). Its Mod Store imports **gta5-mods.com** metadata. Our store must never talk to gta5-mods.com or accept its packages. |
| gta-sa-earth (`atharvdubey22ug-glitch/gta-sa-earth`) | **no licence file** | Parsers and runtime for RenderWare/GTA:SA formats (`.dff .txd .img .ipl .ide .col .scm .ifp`, `carrec.img`, `american.gxt`, `timecyc.dat`); SA mission names and characters (Big Smoke, Grove Street) in UI/README | Architecture only (simulate-once/record/scrub mission playback, auto-director, keyframed sky). Do not reuse the `timecyc` field layout or values. **Rename our P10 tier from `timecyc.json` to `skycycle.json`** and author our own keyframes. |
| SK8V (`becaring/SK8V`) | Apache-2.0 (NOTICE: "unofficial fan project, unaffiliated with EA, Rockstar Games or Take-Two"; uses ScriptHookV; Skate 3 engine re-implementation; "Later revisions of that repository are GPL-3.0") | GTA V hook layer, live GTA collision reader, Skate 3 (EA) HUD/asset pipeline, EA-XMA decoder (LGPL) | Physics ideas only. Do not vendor any of it: EA and Rockstar adjacency, mixed GPL/LGPL lineage. |
| universal-modder (`rehan-remade/universal-modder`) | MIT | Knowledge base about modding commercial games (incl. a Minecraft↔GTA5 passthrough example) | Agent-friendly layout, fal usage patterns and its own `um publish check` idea. Our mod SDK mods **only Dee-Verse**. Strip every third-party-game skill from what we ship. |
| San-Francisco (`Atharvsinh-codez/San-Francisco`) | **no licence file** | none Rockstar; open SF data | Patterns only (all rights reserved by default). Re-bake from the original open data. |
| SF-Bay-Area-AI-Atlas (`Kenton-GMI/SF-Bay-Area-AI-Atlas`) | MIT | none Rockstar; real company names/logos possible in data | Code reusable with attribution; company names go through `NameRegistry`. |

### 2.2 Clean-room process (the most effective control)
- **Zone R (research)** holds the clones, `research/*.md` and the pattern cards. **Zone B (build)** is the `dee-verse` repo and every Sonnet/Opus build session.
- Only prose pattern cards cross from R to B, never code, data, shader text, symbol names, offsets or file layouts.
- Builder sessions must not have `${REPOS}` mounted, on the path, in a submodule or in `AGENTS.md` links.
- **Spec rule:** the Sonnet kickoff (04) states "Do not open, fetch or search the example repositories. Implement from the spec and research pattern cards only."
- The PR template carries a checkbox: "No code, data, names, constants or layouts from example repositories were consulted or copied for this change."
- The research files may name Rockstar formats, because they are the audit record. They live in `docs/research/`, which ships no runtime code and is allowlisted only for the string denylist.
- **Amended 2026-10-19 by ADR-REUSE-01/D-31:** files under `third_party/` listed `REUSE-WITH-ATTRIBUTION` in the register (`docs/legal/third-party-reuse.json`) may cross; everything else unchanged.

### 2.3 Asset provenance manifest (extends C07 `AssetManifest.provenance`)
Every shipped binary or data file (`assets/**`, `public/**`, `world/**`, fonts, audio, `*.glb|ktx2|png|jpg|webp|avif|ogg|mp3|wav|opus|woff2|pmtiles|bin|json` data) must have exactly one record. A file is identified by its SHA-256 and has an SPDX-style licence.

```jsonc
// assets/provenance/<sha256>.json  (or one NDJSON file; schema: schemas/provenance-1.0.schema.json)
{
  "schema": "provenance/1.0",
  "sha256": "…",                        // of the shipped bytes
  "paths": ["assets/char/rap_lyricist_01/mobile.glb"],
  "kind": "character|vehicle|prop|building|terrain|texture|audio_music|audio_sfx|voice|cutscene|font|ui|map_data|code_data",
  "origin": "generated|authored|licensed|open_data|derived",
  "license": "LicenseRef-DeeVerse-Owned|CC0-1.0|CC-BY-4.0|OFL-1.1|MIT|Apache-2.0|ODbL-1.0|PDDL-1.0|LicenseRef-Vendor-<id>",
  "attribution": "© OpenStreetMap contributors",     // required when license requires it
  "authors": ["profile:…" | "studio:…"],
  "source": { "url": null, "dataset_id": null, "retrieved": "2026-10-18" },     // open_data/licensed
  "generator": {                                  // origin=generated|derived
    "vendor": "fal|elevenlabs|minimax|openai|workers_ai|anthropic|local",
    "endpoint": "fal-ai/…", "model_version": "…", "request_id": "…",
    "plan": "elevenlabs:enterprise_music",        // for terms that depend on plan tier
    "prompt_sha256": "…", "negative_prompt_sha256": "…",
    "input_refs": ["sha256:…"],                    // every input image/audio by hash
    "terms_snapshot": "legal/vendor-terms/fal-2026-09-08.md",
    "generated_at": "2026-…"
  },
  "derived_from": ["sha256:…"],                    // parents (retopo, KTX2 encode, LODs)
  "likeness": { "subject_id": null, "tier": "fictionalized", "face_reference_used": false, "voice_mode": "designed" },
  "ip_checks": { "signatures": "pass", "strings": "pass", "similarity": "n/a", "reviewer": null },
  "ai_generated": true,                            // drives AI labels / C2PA
  "status": "active|quarantined|killed"
}
```

Rules:
- `origin=licensed` requires a licence file in `legal/licenses/`.
- `origin=generated` requires `generator.vendor`, `endpoint`, `request_id`, `prompt_sha256` and a `terms_snapshot`.
- Character, voice and cutscene kinds require `likeness`.
- `status=killed` files are excluded from builds and the R2 manifest.

### 2.4 CI checks (fail the build)

| Job | What it does | Fails when |
|---|---|---|
| `provenance:check` | Walks every shipped file, hashes it and joins it to its provenance record; validates the record against the JSON Schema; verifies the licence is on an allowlist and that attribution strings appear in `credits.json` | any file has no record, an unknown licence, a missing required field, or `status≠active` |
| `ip:signatures` | Magic-byte and structure scan of every file in the repo and the R2 upload set: RPF7 `37 46 50 52` at offset 0 (all 1,528 RPFs in playgta5's inventory carry it); RSC7 `52 53 43 37`; DXBC `44 58 42 43` anywhere in `.fxc/.bin`; GXT2 `32 54 58 47` ("2TXG", used by Grand-V's GXT2 writer); WASM whose `name` section contains `rage::`; OIV packages (zip containing `assembly.xml`); RenderWare clump/texdict chunk headers in `.dff/.txd`; IMG v2 `VER2` | any hit |
| `ip:extensions` | Extension denylist: `.rpf .ytd .ydr .ydd .yft .ymap .ytyp .ybn .ycd .ymt .awc .gxt2 .fxc .oiv .asi .sps .ugc .dff .txd .img .ipl .ide .col .scm .ifp .rrr .dat` (`.dat` only under paths named `data/` with timecyc/handling-like headers) | any hit |
| `ip:strings` | Case-insensitive denylist over source, shipped strings, i18n tables, mission scripts, soul.md files, LLM prompt templates and **generated** content caches. Seed list: `rockstar, take-two, grand theft, \bgta\b, los santos, san fierro, san andreas, liberty city, vice city, las venturas, gant bridge, rage::, joaat, scripthook, menyoo, openiv, gta5-mods, playgta5, grandv, fivem, timecyc, carrec`, the Rockstar fictional makes `bravado, declasse, grotti, karin, pegassi, vapid`, plus `config/ip-denylist.json` (S05 extends it with Rockstar in-world brands after verification) | any hit outside `legal/` and `docs/research/` |
| `ip:similarity` | Runs **outside** the build repo (Zone R runner): clones the example repos at the pinned commits from repos-webport/grand-v into an ephemeral directory and runs a token-level clone detector (e.g., jscpd, min 50 tokens) of `src/**` against their `.js/.ts/.rs/.py/.wgsl`. Reports only file and line pairs, never the matched text, back to the PR | any match ≥50 tokens; GPL-sourced match is a blocker |
| `license:scan` | ScanCode Toolkit on dependencies and the PR diff (it detects licences and copyrights in source and binaries); `reuse lint` (REUSE spec 3.3) for per-file `SPDX-License-Identifier` / `REUSE.toml` coverage | GPL/AGPL/LGPL code in the client bundle without an ADR; a missing licence header on a first-party file; an unknown licence in a dependency |
| `names:lint` | Checks every real-world referent against `config/names.json` (`NameRegistry`, gamedesign P-6): real names, aliases, registered catchphrases, team/venue/brand marks. Display names must pass the name-distance rule (§Likeness policy). Real-side strings are server-only | a real-side string appears in client code or content; display-name distance < threshold |
| `likeness:gate` | For character/voice/cutscene provenance: `tier≠consented ⇒ face_reference_used=false` and `voice_mode∈{synthetic,designed}`; consented assets need a valid, unexpired `consent_record` covering the scope used | violation |
| `history:scan` | Same signature, string and extension scans over the full git history before the repo is first made public, and on any history rewrite | any hit (requires a history rewrite before publishing) |

Runtime companion: the CSP `connect-src`/`img-src`/`media-src` allowlist contains only our origins and verified vendor endpoints. A denylist test asserts that no `playgta5`, `grandv` or gta-mirror origin is referenced.

### 2.5 Mods and UGC get the same scanners
Every mod or experience package (C14/C17) and every NPC-builder upload runs `ip:signatures`, `ip:extensions`, `ip:strings` and `license:scan` before it reaches moderation. This mirrors universal-modder's `um publish check`. Rockstar formats are rejected at upload with a fixed message ("Game files from other titles can't be uploaded"), so that users cannot use the forum to distribute GTA assets.

---

## 3. Real-person NPCs: right of publicity and likeness

### 3.1 Law map (California-first; the studio and the subjects are Bay Area)

| Rule | What it reaches | Remedy | Defences/exceptions relevant to us |
|---|---|---|---|
| Civ. Code **3344** (living) | knowing use of "name, voice, signature, photograph, or likeness" on products or for advertising/selling without consent | greater of **$750** or actual damages, plus profits, punitive damages, and **attorney's fees to the prevailing party** | news, public affairs, sports broadcast, political campaign (3344(d)); First Amendment transformative-use defence (case law) |
| California **common law** misappropriation | any appropriation of **identity**, not only name or likeness (*White v. Samsung*: "It is not important how the defendant has appropriated the plaintiff's identity, but whether") | damages, injunction | transformative use; parody in expressive works (case law) |
| Civ. Code **3344.1** (deceased; AB 1836 effective 2025-01-01) | (a)(1) products/ads; (a)(1)(B)(i) audiovisual works of "fictional or nonfictional entertainment" are **not** products; **(a)(2) digital replica** in an expressive audiovisual work or sound recording without consent | (a)(2): greater of **$10,000** or actual damages | (a)(2)(A)(ii) any one of: news/public affairs/sports; **"comment, criticism, scholarship, satire, or parody"**; documentary/biographical; **"fleeting or incidental"**; ads for those works. 70-year term. A successor can't recover for uses before registering with the Secretary of State ((f)(1)) |
| Labor Code **927** (AB 2602, eff. 2025-01-01) | contract clauses allowing a digital replica of a performer's voice/likeness for new performances, without a reasonably specific description of uses | clause unenforceable | carve-outs when the person was represented by counsel (terms stated clearly and conspicuously) or a union agreement explicitly covers replicas |
| Lanham Act **§43(a)** false endorsement | imitation of a distinctive attribute implying endorsement (*Waits*) | damages, injunction | *Rogers* still applies to non-source uses inside expressive works |
| N.Y. Civ. Rights Law **50/51** | "portrait" includes computer-generated images (*Lohan*), but must be recognizable | damages | not recognizable = no claim |
| Federal **NO FAKES Act of 2026** (S.4591 / H.R.8915) | would create federal voice and likeness rights for digital replicas, with notice-and-removal | — | **not law**: advanced by Senate Judiciary 2026-06-18; track it |
| SAG-AFTRA **Interactive Media Agreement 2025** | union performers' voice, likeness and movement replicas | contractual | written consent and disclosure required; real-time generation ≥7.5× scale. Applies only if we hire union talent |

### 3.2 Precedents and what each one means for a build rule

| Case | Holding (short) | Build rule it implies |
|---|---|---|
| *Comedy III v. Saderup* → *Winter v. DC Comics* (Cal. 2003) | Caricatures "distorted for purposes of lampoon, parody, or caricature" (half-worm brothers with similar names) are transformative and protected | `parody` = strong visual transformation + altered name + new context |
| *Kirby v. Sega* (Cal. Ct. App. 2006) | Ulala was "more than a mere likeness"; only new expression needed, not parody; Sega got its fees | stylized original designs inspired by a persona are defensible |
| *No Doubt v. Activision* (Cal. Ct. App. 2011) | literal avatars doing what made them famous (performing songs) are not transformative, even in odd settings | never depict a parody subject **doing their fame activity literally** (Curry shooting threes as himself; E-40 performing his songs) |
| *Keller* (9th Cir. 2013) / *Hart* (3d Cir. 2013) | literal recreation "in the very setting in which he had achieved renown" is not protected; *Rogers* rejected for publicity claims | the fighter and racing modes must not be "sports sim with real athletes" |
| *Noriega v. Activision* (L.A. Super. Ct. 2014) | dismissed under anti-SLAPP: transformative; small part of a complex game | real-derived characters stay a minority of content and are never the selling point |
| *Lohan v. Take-Two* (N.Y. 2018) | GTA V avatars not identifiable as plaintiffs: "satirical representations of the style, look, and persona" | evoke archetypes and styles, not individuals |
| *White v. Samsung* (9th Cir. 1992) | evoking identity in an **ad** is actionable even without a likeness | **marketing must never evoke a real person** (no "fight E-40!" copy, no thumbnails of parody NPCs promoted as the person) |
| *Midler* (9th Cir. 1988), *Waits* (9th Cir. 1992) | deliberate imitation of a distinctive voice is actionable; Lanham false endorsement | **no sound-alike voices or vocals**, and no voice prompts that name or describe a real person |
| *Alexander v. Take-Two* (S.D. Ill. 2022 verdict) | tattoo depictions in WWE 2K infringed the artist's copyright (fair use rejected; $3,750, later zeroed per secondary sources) | **no real tattoos**, jersey designs, or artwork on any character |

### 3.3 Named subjects in the brief (engineering view; no consent is on file for anyone)

| Subject | Status | Extra marks or claims to avoid | Default tier | Consent path |
|---|---|---|---|---|
| Steph Curry | living, active NBA player | Warriors/NBA marks; arena name; SC30 Inc. filed "NIGHT NIGHT" (2022) and "Nuit. Nuit." (2024); jersey number #30 styling | `parody` (fighter archetype only, never basketball) | NBPA group licensing (3+ players, via PLYRS UNTD, formerly THINK450) does not cover a solo hero; individual deal via his agency |
| Marshawn Lynch | living, retired NFL | "Beast Mode" marks; filed "I'm just here so I won't get fined" (2015); 2024 "BeastMode" snacks filing | `parody` (no catchphrases; `ATH_POWER_BACK` archetype per gamedesign) | management |
| E-40 | living artist | registered "E-40" word mark (Class 33, 2016); claims "Captain Save a Hoe"; slang catchphrases | `parody` | management/label |
| Too Short | living artist | catchphrase marks UNVERIFIED | `parody` | management |
| **Mac Dre** (Andre Hicks) | **deceased 2004-11-01**; estate run by Wanda Salvatto (also owner of MAC DRE marks; Thizz Entertainment) | MAC DRE marks; "Thizz" (registration status UNVERIFIED); song titles; voice | **`fictionalized`** until estate consent | estate (Wanda Salvatto); check the Secretary of State successor registration |
| P-Lo, Jay Anthony, 1 Umbrella | living Bay Area artists | names, songs | `parody` | direct outreach is realistic; good candidates for `consented` |
| Adil Mania, Ray Fernando | living tech influencers | names, channel branding | `parody` | **best first consent targets** (builder community; likely to opt in; use a short-form release) |
| Tech founders (unnamed in brief) | living | company marks | `fictionalized` for founders of real companies (tycoon events must use fictional companies; gamedesign §5.6 already does) | — |

Note: §3344 does not require celebrity status; it protects anyone. The parody defence is weaker for less-famous artists because the audience may read a depiction as literal, so lower-profile living artists should move to `consented` or `fictionalized` quickly.

### 3.4 Vendor real-person policies (they constrain the pipeline whatever the law says)

| Vendor / surface | Rule (verified) | Pipeline consequence |
|---|---|---|
| OpenAI (usage policies, eff. 2025-10-29; Service Terms) | no use of someone's likeness, including photorealistic image or voice, without consent in ways that could confuse authenticity; API: no reproducing the likeness or voice of any person without express consent and all necessary rights | reference sheets of real people only for `consented`; parody sheets come from text descriptions and original style refs |
| fal AUP | §3.3 bans "identity theft, impersonation, or deepfakes" incl. using another's likeness or voice without consent; §4.1 no violating publicity rights; §1.3 bans sexual depiction of a real person's likeness without consent; §9.1 end-user account managers must report CSAM; §9.2 legally required age-gating; 18+ | flow-down in our ToS; a CSAM procedure is mandatory; the age gate is part of the contract |
| fal ToS (2026-09-08) / API Services | customer solely responsible for rights in inputs; indemnifies fal including for publicity claims; fal claims no IP in outputs; third-party model terms may apply; **"Client will not expose any of the Services APIs directly to any End Users"**; client liable for end users; end-user agreements "at least as protective" | all fal calls go Worker → fal (Queue), never from the browser; ToS flows the fal AUP down; snapshot model terms per endpoint |
| MiniMax H3 Community License (2026-08-02) | Excluded Territories: **US**, EU, UK, Korea; using the model **or its outputs** outside the territory is not authorized; impersonation ban; clearly label public machine-generated content; MiniMax claims no rights in outputs | **do not self-host H3**; use a hosted API whose terms cover the US (genai-pipeline-fal decides the endpoint); label cutscenes as AI-generated |
| MiniMax litigation | *Disney v. MiniMax* (C.D. Cal.): motion to dismiss denied 2026-05-22; outputs plausibly infringing; advertising with characters supports inducement | cutscene templates must never name third-party characters, films or franchises; `ip:strings` also runs on prompt templates |
| ElevenLabs (use policy updated 2026-10-09, per ai-npc-runtime.md) | no cloning or impersonating a living person's voice or likeness without explicit informed consent; no political candidates or officials; disclose AI interaction; apps directed at under-18s need written approval; PVC is own-voice only | t3 voices only via the talent's own PVC or licensed marketplace voice + `consent_record`; game rated 17+ |
| ElevenLabs Music terms (2026-10-09) | prompts may not contain "any artist's real or stage name, whether living or deceased", songwriter names, song or album titles, publisher or label names; no output that "replicates or mimics the voice, likeness, or identifiable characteristics of any recording artist"; self-serve and Enterprise Music Lite exclude "film, TV, radio, and Studio Games"; Indie Game = <$500k lifetime game revenue and <$1M entity game revenue last FY; 60 days to upgrade after losing indie status; user retains rights in output | music prompt linter (no names); the provenance record stores the `plan`; budget an Enterprise Music upgrade at the indie threshold |
| Anthropic AUP (eff. 2026-11-12, per ai-npc-runtime.md) | consumer chatbots must disclose AI at the start of each session or in the interface; "does not prohibit clearly disclosed parody, satire, or fiction" | persistent "AI character" badge (already in NPC rec 14) plus a "parody/fiction" note for parody-tier NPCs |
| Claude vision (per ai-npc-runtime.md) | refuses to identify people in images | real-person detection = attestation + name/alias lists + face-present flag (ai-npc-runtime §1.7) |

---

## Likeness policy

> Spec text (paste into `spec/06-asset-pipeline.md` §Likeness and `spec/domains/04`). Engineering guidance; counsel to confirm.

### L1. Tiers

| | `consented` | `parody` | `fictionalized` | `original` (basis) |
|---|---|---|---|---|
| Who | real person (or estate) with a signed `consent_record` covering the scopes used | real person who inspired a clearly transformed caricature | archetype "homage" with no identifiable link | wholly invented character (incl. user OCs) |
| Name | real name only if scope has `name` | **altered**: normalized edit distance ≥0.4 from real name and every alias; not a known nickname or registered mark; no initials/number combos (e.g. no "SC30") | invented; must fail any alias match | invented |
| Face/body | reference photos allowed if scope has `likeness_stylized` (stylized) or `likeness_realistic` (photoreal) | **no face/photo references sent to any generator**; text-described caricature with species, proportion, palette or era shift; no real tattoos, jerseys, numbers, logos or signature accessories | archetype only | free |
| Voice | `consented_clone` (talent's own PVC) or `licensed` | `synthetic`/`designed`; style prompt must not name or describe a real person; no accent/cadence imitation brief | `synthetic`/`designed` | free |
| Context | per scope | **outside the subject's fame domain** (no athlete playing their sport; no rapper performing their songs); never a criminal, drug user, sexual content, gore, antagonist faction leader (gamedesign §11.2) | anything game-appropriate | anything game-appropriate |
| Dialogue about the real person | per scope (`biography`) | public-record, non-defamatory, obviously comedic; no private life, health, legal matters, sexuality, family, politics; never presented as fact | none | n/a |
| Catchphrases | if scope has `catchphrases` | **none** that are associated with or filed as marks | none | free |
| Marketing (trailers, store, OG images, socials, notifications) | only if scope has `marketing` | **never** depicted or named in marketing | allowed (it's ours) | allowed |
| Merchandise | only with `merchandise` scope | never | allowed | allowed |
| UGC remix (others reuse the character in experiences) | only with `ugc_remix` scope | never (locked to first-party content) | allowed | owner's choice |
| Cutscene realism | per scope | stylized render preset only (`style: toon-pbr`); photoreal presets blocked | any | any |
| Disclaimer (credits + first appearance card) | "Appears courtesy of …" | "Parody. Not affiliated with or endorsed by any real person." | "Fictional character." | — |
| Deceased subject | estate consent required | **not allowed**: deceased subjects are `fictionalized` until estate consent | allowed (homage only) | — |
| Minors | **never** as subjects (`minor: false` const) | never | never | never |

Defaults: every named real person is `parody` (G2), **except deceased subjects and founders of real companies, who are `fictionalized`**. Downgrading (`consented → parody → fictionalized`) is always allowed and immediate. Upgrading needs a `consent_record` and admin approval.

### L2. Data model (Postgres; extends ai-npc-runtime §6.2; server-only tables, RLS deny-all to clients)

```sql
create table likeness_subject (
  id            text primary key,                 -- 'subj_…'
  real_name     text not null,                    -- server-only
  aliases       text[] not null default '{}',     -- stage names, nicknames, handles
  marks         text[] not null default '{}',     -- catchphrases/brands to block (names:lint)
  deceased      boolean not null default false,
  died_on       date,
  estate_contact text,
  sos_registration_ref text,                      -- CA SoS successor-in-interest filing, if any
  default_tier  text not null check (default_tier in ('consented','parody','fictionalized')),
  notes         text,
  created_at timestamptz default now()
);

create table consent_record (
  id              text primary key,               -- 'consent_…' (pattern from soul schema)
  subject_id      text not null references likeness_subject(id),
  signatory_name  text not null,
  signatory_capacity text not null check (signatory_capacity in ('self','estate','agent','guardian')),
  scopes          text[] not null,                -- subset of: name, likeness_stylized, likeness_realistic,
                                                  -- voice_designed, voice_clone, biography, catchphrases,
                                                  -- marketing, merchandise, ugc_remix, cutscene
  media           text[] not null,                -- in_game, cutscene, trailer, store, social
  use_description text not null,                  -- "reasonably specific description" (Lab. Code 927)
  territory       text not null default 'worldwide',
  term_start      date not null,
  term_end        date,                           -- null = perpetual (discouraged)
  revocable       boolean not null default true,
  revocation_terms text not null,                 -- notice period, what happens to shipped copies/saves
  compensation_ref text,                          -- contract id, not amounts
  counsel_represented boolean not null,           -- Lab. Code 927 carve-out evidence
  union_covered   boolean not null default false, -- SAG-AFTRA IMA applies
  evidence_r2_key text not null,                  -- signed PDF (private bucket)
  evidence_sha256 text not null,
  approved_by     text not null,                  -- admin profile id
  approved_at     timestamptz not null,
  revoked_at      timestamptz,
  revoked_reason  text
);

create table consent_event (                      -- append-only audit
  id bigserial primary key, consent_id text references consent_record(id),
  kind text check (kind in ('granted','amended','renewal_due','revoked','expired','audit')),
  actor text, at timestamptz default now(), details jsonb
);

-- roster_flag from ai-npc-runtime §6.2, widened to scoped kills:
create table roster_flag (
  npc_id text primary key,
  killed boolean not null default false,
  scope text[] not null default '{all}',          -- all | spawn | fighter | cutscene | voice | marketing | ugc
  reason text check (reason in ('consent_revoked','complaint','legal','safety','quality')),
  ticket_id text,                                 -- takedown_request.id
  set_by text not null, set_at timestamptz not null default now()
);
```

soul.md frontmatter (ai-npc-runtime §1.3) keeps `likeness.{basis,tier,subject_ref,consent_record_id,consent_scope,deceased,minor,face_reference_allowed,disclaimer,voice}` and adds:
- `marketing_allowed` (derived: `consented` and `marketing` in scope);
- `fame_domain` (e.g., `basketball`, `rap_performance`). The S07/S06 linter rejects a parody NPC assigned to a mode or move set tagged with the same domain.

The compiler strips `subject_ref`, `real_name` and `consent_*` from `soul.public.json`.

### L3. Enforcement points

| Stage (owner) | Gate |
|---|---|
| soul.md build (S04) | JSON Schema conditionals (ai-npc-runtime §1.5) + `names:lint` + `fame_domain` check + deceased ⇒ `fictionalized` unless consent |
| Reference-sheet / 3D / rig jobs (S05) | the job builder reads tier from the compiled soul, not the request; refuses `input_refs` with faces unless `face_reference_allowed`; prompt linter blocks real names and aliases (from `likeness_subject`) in all prompts; writes `provenance.likeness` |
| Voice (S04/S05) | t3 requires a valid `consent_record` with `voice_clone`; `style_prompt` alias lint |
| Cutscenes (S03) | cache key includes `characters[]@soulVersion`; template linter blocks real names, third-party characters and photoreal presets for non-consented; poster frames inherit the tier |
| Fighter / racing rosters (S07/S06) | `fame_domain` exclusion; parody fighters' moves named originally (no catchphrases) |
| Marketing pipeline (S10/S13) | trailer, OG image and store-art generators read only characters with `marketing_allowed=true` or `basis=original` |
| UGC (S12) | user NPCs: attestation + classifier + face-present flag (ai-npc-runtime §1.7). A suspected real person without a consent record is forced to `fictionalized`, private-only, faces blurred. User experiences cannot embed first-party parody NPCs unless the experience is first-party |

### L4. Kill-switch (extends ai-npc-runtime rec 16)
- **Trigger sources:** consent revocation or expiry (nightly job on `term_end`), a valid takedown or complaint (`takedown_request`), a safety incident, or an admin action. The `POST /admin/roster/:npcId/kill` body carries `{scope[], reason, ticket_id}` and requires role `admin`; every call writes `audit_log`.
- **Propagation:** Postgres `roster_flag` → KV `roster:flags` (KV can take ≥60 s) + an in-Worker 30 s cache + an EncounterDO broadcast for immediate stop (per ai-npc-runtime). The client manifest (`roster.json`, `ETag`) is re-fetched on app start, on mode entry and every 10 min.
- **Effects by scope:**
  - `spawn`: the NPC never spawns; mission slots fall back to a declared `stand_in` fictional NPC, so saves and missions don't break.
  - `fighter`: removed from select screens; saved loadouts remap to the stand-in.
  - `cutscene`: manifest entries hidden. R2 objects tagged `char:<id>` are moved to a quarantine prefix. Cached cutscenes are replaced by the in-engine director fallback. The service worker purges matching cache entries on the next manifest.
  - `voice`: TTS denied and pre-rendered lines dropped from packs.
  - `marketing`: assets unpublished from the store/OG/CDN.
  - `ugc`: experiences referencing the NPC are unlisted.
- **Targets:** live in-session removal within 60 s; full asset purge from public paths within 24 h of a valid complaint.
- **Drill:** quarterly kill/restore test in staging, plus a CI e2e test (`kill npc_test → assert not in spawn tables, roster, cutscene manifest within 2 refreshes`).
- **Stand-ins are mandatory.** Each real-derived NPC ships with a `stand_in` original character of the same archetype, so a kill never blocks progression.

### L5. Consent workflow
1. Outreach uses a template release. The `use_description` lists modes, media and examples (Labor Code 927 asks for a "reasonably specific description"). Recommend the subject has counsel; record it.
2. The signed PDF goes to a private R2 bucket. Its SHA-256 is stored with the record.
3. Admin approval writes `consent_record` and the `consent_event` "granted".
4. The upgrade PR changes `tier` in soul.md and CI verifies the scopes.
5. Renewal reminders fire 90/30 days before `term_end`; on expiry the kill-switch runs automatically with `reason=consent_revoked`.
6. Revocation follows the same path. Shipped offline copies (PWA cache) are purged on the next manifest refresh.

---

## 4. Music

Facts: sync use of a commercial recording needs both the master (label) and the composition (publisher) rights. Bay Area catalogs are sample-heavy, which multiplies the clearances; there is no shortcut. AI-only output is likely uncopyrightable in the US. The Copyright Office (2025-01-29) found "prompts alone do not provide sufficient human control", and the Supreme Court denied cert in *Thaler* (2026-03-02). Human selection, arrangement or modification can be protected. Voice imitation of a singer is actionable (*Midler*, *Waits*).

Rules:
- **M1** Use no licensed commercial recordings in v1. Every track is original: human-composed, or AI-assisted with human arrangement and lyrics, so stems are protectable.
- **M2** "Hyphy-inspired" is a genre brief, not an artist brief. Prompts may describe tempo, instrumentation, era and regional slang. They may not contain artist names, song titles, labels or "sounds like X". ElevenLabs Music forbids those terms anyway, and the same linter as `ip:strings` plus the `likeness_subject` aliases enforces it for every music vendor.
- **M3** No sampling, no interpolation of known melodies, and no vocal timbre matching a real artist. AI vocals use designed voices only.
- **M4** Vendor fitness:
  - ElevenLabs Music is usable on self-serve only while we qualify as an "Indie Game". Store `plan` in provenance; S13 adds a revenue-threshold alarm.
  - Udio is unusable: downloads disabled since 2025-10-30.
  - Suno: commercial use only on paid plans. Ownership wording changed after the WMG deal, so re-verify before use.
  - Open models (ACE-Step code is MIT; weights licence UNVERIFIED) need a recorded weights licence.
  - Every music asset has `provenance.generator` + `terms_snapshot`.
- **M5** In-game radio uses fictional station names. Real Bay Area call signs and DJ names go in `config/ip-denylist.json`; the list itself is UNVERIFIED and maintained by S05.
- **M6** If an artist consents to appear (`consented`), their music needs a **separate** sync licence from master and publishing owners. Likeness consent does not include music.

---

## 5. UGC, mods, forum

### 5.1 DMCA safe harbor checklist (17 U.S.C. 512)
- Register a **designated agent** with the Copyright Office: $6 per designation, amendment or resubmission. It **expires three years** after registration, and lapsing can cost 512 protection. Show the same contact details on `/legal/dmca`. S13 adds a calendar job that warns 90 days before expiry.
- **Notice intake** form with the 512(c)(3) elements: signature, identification of the work, location of the material, good-faith statement, accuracy under penalty of perjury. Each notice gets a `takedown_request` row.
- **Expeditious removal:** target ≤24 h to disable access (unlist plus R2 quarantine).
- **Counter-notice** path. Restore in **10–14 business days** unless suit is filed (512(g)(2)).
- **Repeat-infringer policy**, published and implemented (512(i)(1)(A)): three strikes in 12 months terminates publishing rights, and account termination is at moderator discretion.
- Do not take a direct financial benefit from specific infringing UGC. Revenue sharing tied to specific UGC needs counsel review.
- §230(c)(1) does not protect IP claims (230(e)(2)), so DMCA compliance is the only shield for copyright.

### 5.2 Other mandatory removal and reporting paths
- **TAKE IT DOWN Act** (since 2026-05-19). Covered platforms include gaming platforms that primarily provide a forum for UGC.
  - Post a "clear and conspicuous" notice of the process on the home page and wherever UGC renders.
  - Remove the content and "known identical copies within 48 hours".
  - Assign request ids and tell the requester the outcome.
  - Use perceptual + exact hashes to find copies.
  - Penalty: $53,088 per violation.
  - Our NPC builder images, experience thumbnails and forum attachments are all in scope.
- **CSAM** (18 U.S.C. 2258A; fal AUP §9.1).
  - Report to NCMEC's CyberTipline as soon as reasonably possible after actual knowledge.
  - Preserve the report contents for **1 year** in a locked, access-logged bucket.
  - Never re-serve the material and never send it to other vendors.
  - Fines for knowing failure reach $600k (first) and $850k (repeat) for providers under 100M MAU.
  - No duty to monitor, but scanning is strongly recommended.
  - Cloudflare's CSAM Scanning Tool covers content "served … through the Cloudflare cache" only. **Serve all UGC images from a cache-enabled custom domain, never through `r2.dev` or signed-URL bypass paths**, so the tool sees them. Add the minors classifier from ai-npc-runtime §1.7 at upload.
- **Real-person deepfakes in UGC:** prohibited by our ToS and by the fal and OpenAI terms. Enforce with the ai-npc-runtime §1.7 detection stack. A suspected real person without consent cannot be published, and photoreal face uploads are never used as generator references for public NPCs.
- **SB 243 shape for AI NPCs.**
  - Rails keep NPC topics within the game.
  - NPCs decline mental-health, self-harm and sexual topics in character, with a fixed out-of-character safety card that links crisis resources (988 in the US).
  - No long-term "relationship" mechanics with NPCs: affinity is a game stat, not companionship.
  - AI disclosure stays visible (Anthropic AUP).
  - This keeps the video-game exclusion available; counsel to confirm against the statute text.

### 5.3 Terms of Service and UGC licence essentials (S10 legal pages; counsel drafts)
1. Eligibility: **17+** recommended (matches ai-npc-runtime's M rating and ElevenLabs' under-18 rule). Neutral age screen with free entry of month/day/year. Block under-13s, and do not prompt users to retry with another age.
2. Licence to us: non-exclusive, worldwide, royalty-free, sublicensable to service providers, to host, store, reproduce, adapt (technical transforms, LODs, thumbnails), display, distribute and promote the UGC inside the service and its marketing. Creators keep ownership.
3. Licence to other players: play and view inside the service only. Remix only if the creator sets `remix_allowed`.
4. User warranties: rights to everything uploaded; **likeness attestation** (original / me / real person with written consent, with upload); no third-party game files.
5. Prohibited content: the fal AUP flow-down (required "at least as protective"), ElevenLabs and Anthropic AUP flow-downs, IP infringement, real-person sexual or deceptive content, CSAM, hate, harassment, doxxing, political-figure impersonation, gambling and real-money trading.
6. Notice-and-takedown, Take It Down, and repeat-infringer sections; a report button on every UGC surface (R-IP-03).
7. AI disclosure: NPCs and generated media are AI-generated; parody disclaimer.
8. Mods: run in our sandbox; no circumvention; personal mods are private unless published through review; we may remove anything. The mod SDK licence (MIT or similar) covers our SDK code, not the game.
9. Virtual items have no cash value, are non-transferable outside the game, and there is no real-money trading.

### 5.4 Mods via personal coding agents / "Sign in with ChatGPT"
- Local mods run against the typed ModAPI. Publishing re-runs every §2.5 scanner and moderation.
- The repo's `AGENTS.md` for modders states: "Mods for Dee-Verse only. Do not import assets, code or data from other games. Do not use real people's names, faces or voices."
- The agent toolchain gets `dee-verse mod check`, which runs the same CI checks.
- Rockstar's tolerance policy does not cover "new games, stories, missions, or maps", so GTA-asset imports are both a policy violation and a takedown magnet.

---

## 6. Map data, places, brands

- **Geodata:** follow repos-world §4. OSM is ODbL: attribute "© OpenStreetMap contributors" and ship the bake scripts and derived DB. DataSF building footprints are PDDL. Terrain tiles and USGS are public domain with credits. No Google Photorealistic 3D Tiles for gameplay (no caching, derivation or offline use). Mapbox only as live attributed 2D, never baked (§1.6/§1.9). Protomaps on R2 for the in-game map. The credits screen and map corner must render every `provenance.attribution`.
- **Buildings:** 17 U.S.C. 120(a) lets anyone make "pictures, paintings, photographs, or other pictorial representations" of a constructed architectural work "located in or ordinarily visible from a public place". Whether a navigable 3D model counts is not settled (UNVERIFIED), but games routinely rely on it. Model exteriors from open footprints and heights; invent interiors.
- **Murals, sculptures, public art** (e.g., Mission murals) are not architectural works. **Do not reproduce them.** Generate original murals (provenance `origin=generated`) and credit local artists only if they are commissioned.
- **Landmark marks:** the Transamerica Pyramid image is a registered design mark (Reg. 4813212; owner not confirmed). The Golden Gate Bridge District holds registered marks and licenses its photography per named project, keeping enforcement control. Depict geometry in-world. Never use landmark names or silhouettes as **our logo, wordmark or key art** without clearance. In-world signage uses `NameRegistry` display names.
- **Sponsored venue names** (e.g., the Warriors' arena), teams and leagues: fictional (gamedesign already uses "Mission Bay arena").
- **Vehicles:** licensing real makes is industry practice. *AM General v. Activision* (S.D.N.Y. 2020, Humvees, decided under *Rogers*) is a defence, not a plan. Use **original makes and models with altered silhouettes and badges**, and do **not** reuse Rockstar's fictional makes (Bravado, Declasse, Grotti, Karin, Pegassi, Vapid; seeded in `ip:strings`). Robotaxis are a fictional operator (gamedesign: "Halcyon Mobility"), never "Waymo". The Tesla Roadster becomes a fictional EV hypercar.
- **Transit:** BART and Muni station names are factual place names, so descriptive use is fine. Logos, typefaces and livery are original.
- **Rockstar's SF:** GTA San Andreas already parodied SF as **San Fierro** (Gant Bridge = Golden Gate). Our parody names must not echo theirs (`ip:strings`).

---

## 7. Web3 (Thirdweb) and monetization

- **W1** Thirdweb is used **only for identity** (auth phase 1). Disable or omit token, NFT, marketplace and pay modules behind a compile-time flag `WEB3_ECONOMY=false`.
- **W2** No tokens, NFTs, on-chain items, staking, or "invest in a player's startup" mechanics. The Tycoon mode's fundraising is fictional currency only. *Stoner Cats* (SEC, 2023): NFTs sold to fund an entertainment production, with resale royalties, were treated as a securities offering. Thirdweb's own terms ban creating "any token that may constitute a security".
- **W3** No loot boxes or randomized paid rewards. California cases holding in-game-only items are not a "thing of value" (*Mai v. Supercell*, *Coffee v. Google*) rest on non-transferability; on-chain transferability removes that argument. Thirdweb also bans illegal online gambling.
- **W4** If an in-app purchase ever ships:
  - real-money price shown next to virtual currency;
  - odds disclosed for any chance mechanic;
  - parental consent below 16 (FTC v. HoYoverse: $20M);
  - no dark patterns, an easy refund path, and saved payment methods not charged without confirmation (FTC v. Epic: $245M).
- **W5** Thirdweb's terms prohibit users under 13. Our 17+ gate is stricter.

---

## 8. Privacy: pose camera, minors, voice

- **P1 Pose stays on device.**
  - The MediaPipe Pose Landmarker web task runs in the browser (WASM; IMAGE/VIDEO modes; `outputSegmentationMasks` defaults to false).
  - Frames are processed in memory and never uploaded, recorded or persisted.
  - Landmarks are not persisted and not sent to the server or to multiplayer peers. Only the derived **action ids** (e.g., `Action.Special`) cross the input layer (C03).
  - No Face Landmarker or face mesh is ever loaded. BIPA counts "scan of hand or face geometry" as a biometric identifier. CCPA's "biometric information" includes face imagery and **gait patterns**, and becomes sensitive personal information when processed to identify someone.
  - CSP and a unit test assert no network calls from the pose worker.
- **P2 Telemetry from pose** is aggregate only (fps, calibration success rate, latency histogram) with no per-frame data (C16).
- **P3 Consent UX.**
  - A camera explainer appears before the permission prompt: what is processed, that it stays on the device, and how to turn it off.
  - A settings toggle allows revocation.
  - A `parental_consent` flag exists for any teen account. With a 17+ product, the flag defaults to "camera features off for <18 unless a parent consents"; S10 implements it as an account setting and does not collect parent PII in v1 (a counsel decision).
- **P4 Minors.**
  - Target audience 17+. Neutral age screen; block under-13s (COPPA); no ad tracking.
  - From **2027-01-01**, California AB 1043 OS age signals give "actual knowledge". Read the signal where the browser or OS exposes it, and treat it as authoritative unless we have clear and convincing contrary information.
  - Teens (13–16, 17) if ever allowed: voice and text chat **off by default** (Epic order), no t2/t3 voices (ElevenLabs), no public UGC publishing without review, no NPC long-term memory beyond the session.
- **P5 Voice chat** (Cloudflare Realtime): never recorded in v1; report-a-player captures only text metadata.
- **P6 NPC memory** is personal data. Disclose it in the privacy policy, provide deletion (`DELETE /api/v1/me` cascades `npc_memory`), and set retention to ≤180 days by default.
- **P7 EU/UK.** EU AI Act Art. 50 transparency (deepfake disclosure, machine-readable marking) has applied since 2026-08-02. MiniMax H3's licence excludes the EU and UK too. **v1 is US-only (geo-gated at the Worker by `request.cf.country`)** until an EU/UK compliance pass adds AI labels, C2PA on exported media and DSA/OSA processes.

---

## Constraints block

> Paste verbatim into the architect prompt / `05-APPENDIX §C` / `CLAUDE.md` (trim to taste). **Engineering guidance, not legal advice.**

1. **No "GTA" in anything shipped.** The game's display name comes only from `config/brand.ts` (default "Dee-Verse: Tha Bay"). "GTA", "Grand Theft", "Rockstar" and "Take-Two" appear only in the fixed non-affiliation disclaimer and in `docs/research/`. CI string lint enforces it. Rename the repo before it goes public.
2. **No Rockstar or Take-Two material of any kind**: code, wasm, shaders, data, file formats, symbol or native names, hashes, maps, mission content, characters, brand names (including their fictional makes and places like San Fierro), fonts, loading-screen choreography or UI trade dress. This includes everything reachable through playgta5, muguet, Grand-V, gta-sa-earth and SK8V.
3. **Clean room.** Build sessions never open the example repositories. Only research pattern cards cross over. Every PR attests to this.
4. **Provenance or it doesn't ship.** Every shipped file has a provenance record (C07 extension): SHA-256, origin, SPDX licence, attribution, generator {vendor, endpoint, request_id, prompt hash, plan, terms snapshot}, parents, likeness. CI runs `provenance:check`, `ip:signatures`, `ip:extensions`, `ip:strings`, `ip:similarity` (out-of-repo), `license:scan` (ScanCode + `reuse lint`), `names:lint`, `likeness:gate` and `history:scan`, and fails on any finding.
5. **No GPL/AGPL/LGPL code in the client bundle** without an ADR. muguet (GPL-3.0) and unlicensed repos (playgta5, Grand-V upstream, gta-sa-earth, San-Francisco) are read-only references.
6. **Real people go through `NameRegistry`** (`config/names.json`, real side server-only). Code and content never hard-code a real name, alias, catchphrase or mark.
7. **Likeness tiers** `consented | parody | fictionalized` (+ `basis: original`) live in soul.md and gate every pipeline stage. Defaults: named living people → `parody`; **deceased people (Mac Dre) and founders of real companies → `fictionalized`**; minors are never subjects.
8. **`parody` means transformed.** Altered name (edit distance ≥0.4 from the name and every alias), stylized caricature from text (no photo or face references to any generator), no real tattoos, jerseys, numbers or logos, no catchphrases, not shown in their fame domain, never shown committing crimes or in sexual, drug or gore content, a parody disclaimer, and **never used in marketing**.
9. **Real faces or voices only with `consented`** and a valid `consent_record` whose scopes cover the use (`likeness_stylized|likeness_realistic|voice_clone|marketing|…`). Voice clones only via the talent's own PVC or a licensed voice. No sound-alike prompts.
10. **Consent records** carry signatory capacity, scopes, media, a "reasonably specific" use description, term, revocation terms, counsel/union flags and hashed evidence. Expiry or revocation triggers the kill-switch automatically.
11. **Kill-switch:** `roster_flag{killed, scope[], reason, ticket}` → KV + Worker cache + DO broadcast. Live removal ≤60 s; public asset purge ≤24 h. Every real-derived NPC has an original `stand_in` so saves and missions never break. Drill quarterly.
12. **All generation goes Worker → vendor.** The browser never calls fal, ElevenLabs, OpenAI or MiniMax directly (fal API terms). Our ToS flows down every vendor AUP.
13. **Do not self-host MiniMax H3 weights** (the licence excludes the US). Use only hosted endpoints whose terms cover US commercial use, and label cutscenes as AI-generated.
14. **Prompt hygiene:** image, video, music and voice prompts never contain real-person names or aliases, third-party characters or franchises, artist, song or label names, or "in the style of <person>". The linter runs on templates and on runtime-filled prompts.
15. **Music is original.** No commercial recordings, samples, interpolations or artist-voice imitation. AI music has human arrangement or lyrics, and its provenance records the vendor plan. ElevenLabs Music self-serve is allowed only while we are an "Indie Game" (<$500k game revenue, <$1M entity revenue).
16. **Places:** depict architecture from open data, but never reproduce murals or public art. Landmark names and silhouettes are never our logo or key art. Teams, leagues, sponsored venues, vehicle makes, robotaxi operators and radio stations are fictional.
17. **Map data licences:** OSM ODbL attribution + share the derived DB; DataSF PDDL credit; no Google 3D Tiles in gameplay; Mapbox never baked or cached; Protomaps on R2 for maps.
18. **UGC pipeline:** every upload runs the IP scanners, a moderation classifier, a minors/CSAM check and likeness attestation before anyone else can see it. Report button on every UGC surface.
19. **DMCA:** registered designated agent (renew before the 3-year expiry), a `/legal/dmca` page, a notice form, ≤24 h takedown, a counter-notice restore window of 10–14 business days, and a published repeat-infringer policy.
20. **TAKE IT DOWN:** a conspicuous NCII removal request path; removal plus known identical copies within 48 h; request ids and outcome notices.
21. **CSAM:** quarantine; report to the NCMEC CyberTipline as soon as reasonably possible; preserve 1 year in a locked bucket; never re-serve. UGC images are served through Cloudflare cache so the CSAM Scanning Tool sees them.
22. **AI NPCs stay "video game" bots:** game topics only; decline mental-health, self-harm and sexual topics with a fixed safety card (988); no companionship or relationship mechanics; a persistent "AI character" badge; parody NPCs labeled as parody.
23. **Web3 is identity only.** No tokens, NFTs, staking, cash-out, loot boxes or paid randomized rewards. Virtual items have no cash value and are non-transferable.
24. **Age:** 17+ product, neutral age screen, under-13 blocked. Teens (if ever allowed): chat off by default, no premium or cloned voices, no public publishing without review. Honor OS/browser age signals from 2027-01-01 (CA AB 1043).
25. **Pose camera:** on-device only; no frames or landmarks leave the device or persist; no face landmarker or mesh; aggregate telemetry only; explainer before the permission prompt; parental-consent flag gates camera features for minors.
26. **v1 is US-only** (geo-gate) until an EU/UK pass adds AI Act Art. 50 labeling/marking and DSA/OSA processes.
27. **Every claim about an external system** cites `research/` with URL and date, or is marked `UNVERIFIED` and listed in `spec/99-open-questions.md`. Nothing in the spec is legal advice. Counsel signs off on the title, the tiers, the ToS and the consent forms before public launch.

---

## Risk register

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| L-R01 | Take-Two demand/DMCA/registrar action over "GTA" in title, repo or domain | **H** (if public with GTA name) | H | rename before public; `names:brand` + denylist CI; disclaimer; no GTA trade dress | S13/S10 |
| L-R02 | Rockstar-derived bytes or code reach the repo or CDN (via example repos, mods or agents) | M | **H** (takedown of whole site; re3-style suit; statutory damages up to $150k per work claimed in re3) | clean room; `ip:*` CI + history scan; UGC upload scanners; CSP | S05/S12 |
| L-R03 | GPL contamination from muguet or GPL forks | L | M | `ip:similarity`, `license:scan`; ADR required | S05 |
| L-R04 | Right-of-publicity claim by a living parody subject (3344 + common law; fee shifting) | M | H | transformation rules; fame-domain exclusion; no marketing use; disclaimers; consent outreach; kill-switch | S04/S07 |
| L-R05 | Estate claim over Mac Dre (3344.1 digital replica $10k+, marks) | M (if depicted) | H | `fictionalized` default; no voice/name/marks; estate outreach; SoS registration check | S04/owner |
| L-R06 | Defamation / false light from LLM-generated parody dialogue | M | H | `real_world_refs` caps, rails, red-team suite, cached review of trash talk, kill-switch (ai-npc-runtime NPC-R3) | S04 |
| L-R07 | Vendor account termination for AUP breach (fal/OpenAI/ElevenLabs/MiniMax) | M | H (pipeline stops) | Worker-only calls; prompt linter; consent gates; flow-down ToS; multi-vendor fallbacks | S05 |
| L-R08 | Using MiniMax H3 outputs outside its licence territory (self-hosting) | L (if rule followed) | H | constraint 13; provenance `endpoint` check | S05/S03 |
| L-R09 | Third-party character/IP appears in AI cutscenes (Disney v. MiniMax pattern) | M | M | template linter; human review of hero cutscenes; cache review queue | S03 |
| L-R10 | Music claim (sound-alike, sample, artist name in prompt, ElevenLabs Studio Games tier breach) | M | M | M1–M6; provenance `plan`; revenue alarm; Content ID-style check before trailers | S05/S13 |
| L-R11 | UGC infringement without safe harbor (agent lapsed, slow takedowns) | M | H | agent renewal job; ≤24 h SLA; repeat-infringer policy | S09/S12 |
| L-R12 | NCII/deepfake of a real person published via NPC builder or experiences; Take It Down 48 h miss ($53,088/violation) | M | H | attestation + classifiers + private-by-default; 48 h queue with pager; hash-based copy removal | S09/S12 |
| L-R13 | CSAM upload; failure to report/preserve | L | **H** (criminal-adjacent, fines, vendor ban) | minors classifier; Cloudflare CSAM tool via cache; NCMEC procedure; 1-year locked preservation | S09 |
| L-R14 | AI NPC treated as a "companion chatbot" (SB 243 private action $1,000+/violation) | L–M | M | game-topic rails; safety card; no relationship mechanics; counsel review | S04 |
| L-R15 | Minors' data (COPPA; AB 1043 actual knowledge from 2027) | M | H (Epic-scale penalties) | 17+ gate; neutral age screen; chat off for teens; no ad tracking; data minimization | S10/S09 |
| L-R16 | Biometric/privacy claim from pose camera | L | M | on-device only; no face mesh; no persistence; tests | S07/S11 |
| L-R17 | Web3 features read as securities/gambling | L (if W1–W3 held) | H | `WEB3_ECONOMY=false`; no tokens/loot boxes | S09 |
| L-R18 | Trademark complaints from brands, teams, venues or landmarks | M | M | fictional brands; `NameRegistry`; no landmark logos; one-commit rename | S06/S02 |
| L-R19 | Copying murals/public art while chasing "accurate SF" | M | M | original murals only; provenance check on decals | S02/S05 |
| L-R20 | EU/UK users reached before compliance (AI Act Art. 50 since 2026-08-02) | M | M | US-only geo-gate in v1 | S09 |
| L-R21 | Kill-switch lag or incomplete purge (cached cutscenes, PWA caches) | M | M | scoped kills, SW purge, stand-ins, e2e test, quarterly drill | S04/S11 |
| L-R22 | Community backlash over undisclosed AI use | M | L–M | AI labels, credits listing vendors, honest marketing | S10 |

---

## Recommendations for the spec

1. **Rename now (S13 → spec/01, 06-SHARED-CONTEXT).**
   - Set `DISPLAY_NAME = "Dee-Verse: Tha Bay"` (pending clearance) and keep "GTA – Tha Bay" as the internal codename only.
   - Add R-NAME-1..6 to `spec/01` and the `names:brand` CI job to milestone M00.
   - Rename the GitHub repo before any public deploy.
2. **Add an "IP & provenance" milestone gate at M00/M01 (S05):**
   - `schemas/provenance-1.0.schema.json`;
   - `tools/ci/ip-scan.ts` (signatures, extensions, strings);
   - `tools/ci/provenance-check.ts`;
   - `config/ip-denylist.json`;
   - ScanCode + `reuse lint` in CI;
   - the `history:scan` job.
   - The first asset cannot merge until these run green.
3. **Run `ip:similarity` on a separate runner (S13/S05)** with the example repos at the pinned commits from repos-webport/repos-grand-v. Report file and line pairs only.
4. **Put the clean-room rule in the Sonnet kickoff (04) and CLAUDE.md:** "Never open, fetch or search the example repositories." Add the PR-template attestation.
5. **Rename the P10 weather tier from `timecyc` to `skycycle`** in repos-world-derived specs, author original keyframes, and add `timecyc` to the string denylist.
6. **S04: extend the soul schema.**
   - Add `fame_domain` and `marketing_allowed` (derived), and default deceased subjects to `fictionalized`.
   - Wire `names:lint` to the `likeness_subject.aliases/marks` export.
   - Add tables `likeness_subject`, `consent_record`, `consent_event` and the widened `roster_flag` (L2) to `spec/04` / C12.
7. **S05: build the job router so tier comes from the compiled soul**, never from the request.
   - Strip face inputs unless `face_reference_allowed`.
   - Run the prompt linter on every vendor call.
   - Write `provenance.likeness` and the `terms_snapshot` path.
   - Store `legal/vendor-terms/*.md` snapshots (fal ToS 2026-09-08, fal AUP, MiniMax H3 licence 2026-08-02, ElevenLabs music terms 2026-10-09, OpenAI policies 2025-10-29) and re-check them quarterly.
8. **S03:**
   - Cutscene templates are linted for names and franchises.
   - Parody-tier characters render only with stylized presets.
   - The R2 layout tags objects with `char:<id>` for purges.
   - Every cutscene manifest entry carries `ai_generated: true` and a label.
9. **S07/S06:**
   - Fighter archetypes use original move names.
   - Parody fighters are excluded from their fame domain (no basketball for the Curry-inspired slot; no football tackles framed as NFL for the Lynch-inspired slot).
   - Vehicles are original makes, with no Rockstar make names.
10. **S09:**
    - `/api/v1/legal/dmca`, `/api/v1/legal/ncii` (Take It Down) and `/api/v1/admin/takedowns` endpoints.
    - `takedown_request` table (id, kind `dmca|ncii|publicity|trademark|csam|other`, received_at, requester, target refs, status, sla_due_at, decision, counter_notice_at, restored_at).
    - A 48 h pager for NCII; the NCMEC procedure; a locked preservation bucket.
    - UGC images served via a cache-enabled custom domain; US-only geo-gate.
11. **S10:**
    - Legal pages: ToS, privacy, DMCA, NCII, parody disclaimer, credits with all attributions, AI disclosure.
    - Neutral age screen; camera explainer; teen defaults; settings for camera and voice.
12. **S12:**
    - Mod/experience publish runs the full scanner set.
    - `AGENTS.md` for modders carries the "Dee-Verse only; no other games' files; no real people" rule.
    - `dee-verse mod check` CLI.
    - Never integrate gta5-mods.com or import its metadata.
13. **S13:**
    - Add the risk register rows L-R01..L-R22 to 05-APPENDIX.
    - Add a DMCA agent-renewal reminder, an ElevenLabs indie-revenue alarm and a quarterly kill-switch drill to ops.
    - Gate public launch on counsel sign-off (title, tiers, ToS, consent forms).
14. **Owner actions (G2 follow-up):**
    - Start consent outreach with Ray Fernando and Adil Mania (short-form release), then P-Lo, Jay Anthony and 1 Umbrella.
    - Contact the Mac Dre estate (Wanda Salvatto) before any homage ships.
    - Keep Curry, Lynch, E-40 and Too Short in `parody` with full transformation, or move them to `fictionalized` if counsel prefers.

---

## Verified facts

| fact | source URL | date checked | confidence |
|---|---|---|---|
| Take-Two owns "GTA" standard-character mark Reg. 3439237 (Ser. 77144006), filed 2007-03-29, first use 1999-09-30, game software; live/renewed | https://trademarks.justia.com/771/44/gta-77144006.html | 2026-10-18 | medium (USPTO mirror) |
| Second "GTA" mark Reg. 6886747 (Ser. 87784380), Class 9, registered 2022-11-01, Take-Two | https://www.trademarkelite.com/trademark/trademark-detail/87784380/GTA | 2026-10-18 | medium |
| "GRAND THEFT AUTO" Reg. 4321159 (Ser. 85713489) live; GTA VI applications filed 2023-12-04 | https://uspto.report/TM/85713489 ; https://uspto.report/TM/98298407 | 2026-10-18 | medium |
| *Jack Daniel's v. VIP* (2023): Rogers does not apply when the mark is used as a designation of source for the infringer's own goods; dilution noncommercial-use exclusion doesn't cover parodies used as source identifiers | https://www.haynesboone.com/news/alerts/unanimous-supreme-court-finds-rogers-test-does-not-apply-when-trademark-is-used-as-source-identifier | 2026-10-18 | high |
| *Punchbowl v. AJ Press* (9th Cir. 2024-01-12): Rogers inapplicable where defendant uses the mark to identify its own products (publication name) | https://proskauer.com/blog/ninth-circuit-provides-further-guidance-on-trademark-lawsuits-involving-expressive-works | 2026-10-18 | medium-high |
| *E.S.S. v. Rock Star Videos* (9th Cir. 2008): GTA SA's "Pig Pen" parody of a real club protected under Rogers | https://cyberlaw.stanford.edu/blog/2009/02/first-amendment-protects-modified-use-strip-clubs-trademark-controversial-video-game | 2026-10-18 | medium-high |
| Take-Two trademark claim against Hazelight's *It Takes Two* (2021); Hazelight gave up its trademark while the dispute was ongoing (as of 2021-12-03) | https://kotaku.com/take-two-is-being-a-dick-1848155566 | 2026-10-18 | medium |
| Take-Two filed two UK oppositions to Remedy's logo on 2023-05-11 (similar to Rockstar "R") | https://gameinformer.com/news/2024/01/16/rockstar-parent-company-take-two-files-trademark-dispute-over-remedys-logo | 2026-10-18 | medium |
| Take-Two TTAB opposition against Rockstar Axe Throwing (2020) based on ROCKSTAR marks | https://www.techdirt.com/2020/10/15/take-two-opposes-trademark-entertainment-company-running-axe-throwing-facility/ | 2026-10-18 | medium |
| Take-Two v. Papenhoff et al. (N.D. Cal. 3:21-cv-06831), re3/reVC, filed after a DMCA counter-notice; sought statutory damages up to $150,000 per work; named defendants dismissed with prejudice after settlement (2023) | https://torrentfreak.com/take-two-sues-enthusiasts-behind-gta-fan-projects-re3-revc-210903/ ; https://torrentfreak.com/take-two-dismisses-claims-against-lead-defendants-in-gta-mods-lawsuit-230405/ | 2026-10-18 | medium-high |
| DOS Zone GTA Vice City browser port: DMCA notice from Ebrand on behalf of Take-Two (reported 2025-12-26); full play required users' own files | https://www.xda-developers.com/gta-vice-city-now-playable-in-a-browser-dos-zone/ | 2026-10-18 | medium |
| playgta5.com GTA V browser port went offline soon after going viral on 2026-10-06; reported as Take-Two action; site shows "Thanks for Playing!" | https://beebom.com/rockstar-shuts-down-free-gta-5-browser-port/ | 2026-10-18 | medium |
| Rockstar PC Single-Player Mods policy: Take-Two generally won't act against single-player, non-commercial, IP-respecting projects; excludes multiplayer/online, other IP, and "new games, stories, missions, or maps"; not a license; revocable | https://support.rockstargames.com/en-US/articles/5NVOAYjcTomO8v6SX2k76k/pc-single-player-mods | 2026-10-18 | high |
| Pricedown's free desktop license excludes webfonts, apps, games and software | https://www.dafont.com/pricedown.font | 2026-10-18 | medium |
| Cal. Civ. Code 3344: knowing use of name, voice, signature, photograph or likeness on products/for advertising without consent; greater of $750 or actual damages + profits + punitive + attorney's fees to prevailing party; exemption for news, public affairs, sports, political campaign | https://codes.findlaw.com/ca/civil-code/civ-sect-3344.html | 2026-10-18 | medium-high (official leginfo blocked by bot check) |
| Cal. Civ. Code 3344.1: (a)(1)(B)(i) audiovisual works of fictional/nonfictional entertainment are not products; (a)(2) digital replica without consent → greater of $10,000 or actual damages; exceptions incl. "comment, criticism, scholarship, satire, or parody", "fleeting or incidental", documentary/biographical, news; "digital replica" = "computer-generated, highly realistic electronic representation that is readily identifiable"; 70-year term; no damages for uses before successor registers with Secretary of State; video games not mentioned | https://codes.findlaw.com/ca/civil-code/civ-sect-3344-1.html | 2026-10-18 | medium-high (FindLaw current through 2026-01-01) |
| AB 1836 digital-replica amendment effective 2025-01-01 | https://www.dglaw.com/california-passes-new-legislation-prohibiting-unauthorized-ai-replicas/ | 2026-10-18 | medium-high |
| Labor Code 927 (AB 2602), eff. 2025-01-01: digital-replica clause unenforceable for new performances if it replaces in-person work and lacks a reasonably specific description of uses; carve-outs for counsel-negotiated terms and CBAs addressing replicas | https://proskauer.com/blog/california-enacts-generative-ai-law-addressing-digital-replicas-of-performers | 2026-10-18 | medium-high |
| *White v. Samsung* (9th Cir. 1992): common-law right "is not so confined" to name/likeness; "It is not important how the defendant has appropriated the plaintiff's identity, but whether"; robot not a 3344 "likeness" | https://law.resource.org/pub/us/case/reporter/F2/971/971.F2d.1395.90-55840.html | 2026-10-18 | high |
| *Waits v. Frito-Lay* (9th Cir. 1992): "when voice is a sufficient indicia of a celebrity's identity, the right of publicity protects against its imitation for commercial purposes without the celebrity's consent"; Lanham §43(a) false-endorsement standing | https://law.resource.org/pub/us/case/reporter/F2/978/978.F2d.1093.90-55981.html | 2026-10-18 | high |
| *Midler v. Ford* (9th Cir. 1988): deliberate imitation of a widely known professional singer's distinctive voice to sell a product is a California tort | https://patentdocs.org/2024/05/27/black-widow-versus-openai-and-what-it-means-for-singers-and-voice-actors/ | 2026-10-18 | medium |
| *Winter v. DC Comics* (Cal. 2003): half-human/half-worm "Autumn brothers" caricatures transformative and protected; "fanciful, creative characters" | https://scocal.stanford.edu/opinion/winter-v-dc-comics-33304 | 2026-10-18 | medium-high |
| *Kirby v. Sega* (Cal. Ct. App. 2006): Ulala "more than a mere likeness or literal depiction"; transformative needs only new expression; summary judgment and fees for Sega | https://www.fenwick.com/insights/publications/litigation-alert-california-superior-court-finds-use-of-likeness-of-former-panamanian-dictator-manuel-noriega-in-video-game-transformative | 2026-10-18 | medium-high |
| *No Doubt v. Activision* (Cal. Ct. App. 2011): Band Hero avatars were literal recreations performing rock songs, not transformative; anti-SLAPP denial affirmed | https://www.loeb.com/en/insights/publications/2011/02/no-doubt-v-activision-publishing-inc | 2026-10-18 | medium-high |
| *Keller / In re NCAA* (9th Cir. 2013), 724 F.3d 1268: literal recreation "in the very setting in which he had achieved renown" not transformative; Rogers rejected for publicity; follows *Hart v. EA* (3d Cir. 2013) | https://wlo.willamette.edu/9thcir/2013/07/samuel-keller-v.-electronic-arts,-inc.-.html | 2026-10-18 | high |
| *Noriega v. Activision* (L.A. Super. Ct., 2014-10-27): anti-SLAPP granted, dismissed with prejudice; transformative; small part of a complex game | https://cdas.com/rightofpublicitydecision/ | 2026-10-18 | medium |
| *Lohan v. Take-Two* (N.Y. 2018-03-29): computer-generated image may be a "portrait", but GTA V images were "satirical representations of the style, look, and persona of a modern, beach-going young woman", not identifiable; Gravano also dismissed | https://blog.ericgoldman.org/?p=18511 | 2026-10-18 | high |
| *Alexander v. Take-Two* (S.D. Ill.): jury (2022-09-30) found WWE 2K's depiction of Randy Orton's tattoos infringing, $3,750; fair use rejected; damages later zeroed on post-trial motions | https://news.bloomberglaw.com/ip-law/wwe-game-maker-owe-artist-3-750-after-tattoo-copyright-trial ; https://blog.ericgoldman.org/?p=26869 | 2026-10-18 | medium |
| NO FAKES Act of 2026 (S.4591) introduced 2026-05-20; advanced by Senate Judiciary 2026-06-18; House H.R.8915; not enacted | https://www.govtrack.us/congress/bills/119/s4591 ; https://www.hklaw.com/en/insights/publications/2026/06/senate-judiciary-committee-advances-legislation-to-protect-name | 2026-10-18 | medium-high |
| SAG-AFTRA 2025 Interactive Media Agreement ratified (95.04%) July 2025: written consent and disclosure for AI replicas; real-time generation ≥7.5× scale | https://technologylaw.fkks.com/post/102mewu/inside-the-new-sag-aftra-interactive-media-agreement-new-standards-for-ai-and-di | 2026-10-18 | medium |
| Marshawn Lynch filed "I'm just here so I won't get fined" (2015); holds "Beast Mode" marks; 2024 "BeastMode" snack application opposed | https://abc7news.com/post/lynch-seeks-im-just-here-trademark/531796/ ; https://www.mandourlaw.com/marshawn-lynch-beast-mode-trademark/ | 2026-10-18 | medium |
| Steph Curry's SC30 Inc. filed "NIGHT NIGHT" variants (2022-06-26) and "Nuit. Nuit." (2024) | https://www.nbcsportsbayarea.com/nba/golden-state-warriors/curry-trademarked-night-night-phrase-10-days-after-finals/1428073/ | 2026-10-18 | medium |
| "E-40" word mark registered Class 33 (Dec 2016), owner an individual | https://trademark.justia.com/864/20/e-86420721.html | 2026-10-18 | medium |
| Mac Dre died 2004-11-01 (Kansas City); mother Wanda Salvatto heads estate/Thizz; MAC DRE marks owned by Wanda Salvatto | https://www.kqed.org/arts/13935501/steph-curry-mac-dre-documentary-bay-area-hip-hop ; https://trademarks.justia.com/owners/salvatto-wanda-1332994 | 2026-10-18 | medium |
| NBPA group licensing covers 3+ players (video games a main category); THINK450 renamed PLYRS UNTD (2026) | https://www.sportico.com/business/commerce/2020/player-control-marketing-rights-think450-ab-inbev-1234618953/ ; https://www.licenseglobal.com/sports/inside-the-nbpa-s-launch-of-plyrs-untd | 2026-10-18 | medium |
| OpenAI usage policies (eff. 2025-10-29): no use of someone's likeness incl. photorealistic image or voice without consent in ways that could confuse authenticity; Service Terms: no reproducing likeness (visual) or voice (Prompt-to-Voice) of any person without express consent | https://openai.com/policies/usage-policies/ ; https://openai.com/policies/service-terms/ | 2026-10-18 | medium (search snippets; pages bot-blocked) |
| fal AUP: §1.3 NCII; §3.3 "Identity theft, impersonation, or deepfakes"; §4.1 privacy/publicity; §4.2 IP; §7.1.5 likeness; §9.1 failure to report CSAM is a violation; §9.2 legally required age-gating; users 18+ | https://fal.ai/legal/acceptable-use-policy | 2026-10-18 | high |
| fal ToS last updated 2026-09-08: customer solely responsible for rights in inputs; indemnity incl. publicity claims; fal claims no IP in outputs; third-party model terms may apply | https://fal.ai/legal/terms-of-service | 2026-10-18 | high |
| fal API Services terms: "Client will not expose any of the Services APIs directly to any End Users"; client liable for end users; end-user agreements at least as protective | https://fal.ai/legal/api-services | 2026-10-18 | high |
| MiniMax H3 Community License (2026-08-02): Excluded Territories US, EU, UK, Korea; using works or outputs outside territory not authorized; impersonation ban; label public machine-generated content; "MiniMax claims no rights over the Outputs" | https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE | 2026-10-18 | high |
| *Disney v. MiniMax* (C.D. Cal.): motion to dismiss denied 2026-05-22; outputs plausibly infringing; contributory infringement via advertising adequately pleaded | https://www.loeb.com/en/insights/publications/2026/06/disney-enterprises-inc-v-minimax | 2026-10-18 | medium-high |
| ElevenLabs Music model-specific terms (updated 2026-10-09): no artist real/stage names, songwriter, song/album titles, publisher/label names in prompts; no output mimicking a recording artist; self-serve + Enterprise Music Lite exclude film, TV, radio, Studio Games; Indie Game <$500k game revenue and <$1M entity game revenue; 60 days to upgrade; user retains rights | https://elevenlabs.io/eleven-music-model-specific-terms | 2026-10-18 | high |
| ElevenLabs Prohibited Use Policy (2026-10-09): no cloning/impersonating a living person's voice/likeness without explicit informed consent; no political candidates/officials; disclose AI; under-18-directed apps need approval; PVC own voice only | https://elevenlabs.io/use-policy (via research/ai-npc-runtime.md) | 2026-10-18 | high |
| Anthropic AUP (eff. 2026-11-12): AI disclosure at session start or in UI; "does not prohibit clearly disclosed parody, satire, or fiction" | https://www.anthropic.com/legal/aup (via research/ai-npc-runtime.md) | 2026-10-18 | high |
| Copyright Office Part 2 (2025-01-29): "prompts alone do not provide sufficient human control"; human selection/arrangement/modification can be protected | https://copyrightalliance.org/ai-report-part-2-copyrightability/ | 2026-10-18 | high |
| *Thaler v. Perlmutter*: cert denied 2026-03-02 (No. 25-449), leaving D.C. Cir. (2025-03-18) human-authorship holding | https://www.finnegan.com/en/insights/ip-updates/supreme-court-declines-to-hear-thaler-v-perlmutter-leaving-human-authorship-requirement-intact.html | 2026-10-18 | high |
| Udio disabled downloads 2025-10-30 after the UMG settlement (2025-10-29); walled garden | https://www.digitalmusicnews.com/2025/10/29/umg-udio-deal-everything-we-know/ | 2026-10-18 | high |
| Suno free-plan songs non-commercial, no retroactive license; WMG settlement Nov 2025; paid-only downloads | https://www.digitalmusicnews.com/2025/12/22/suno-warner-music-deal-changes/ | 2026-10-18 | medium |
| ACE-Step 1.5 code licensed MIT (README); weights license not stated there | https://github.com/ace-step/ACE-Step-1.5 | 2026-10-18 | medium |
| 17 U.S.C. 512(c)(1)–(3), (g)(2) restore 10–14 business days, (i)(1)(A) repeat-infringer policy | https://www.law.cornell.edu/uscode/text/17/512 | 2026-10-18 | high |
| DMCA agent designation: $6 per designation/amendment/resubmission; expires 3 years after registration; reminders 90/60/30/7 days; lapse can cost §512 protection | https://www.copyright.gov/dmca-directory/faq.html | 2026-10-18 | high |
| 47 U.S.C. 230(e)(2): "Nothing in this section shall be construed to limit or expand any law pertaining to intellectual property." | https://www.law.cornell.edu/uscode/text/47/230 | 2026-10-18 | high |
| TAKE IT DOWN Act: effective 2026-05-19; remove content and known identical copies within 48 h of valid request; clear and conspicuous notice; covers AI digital forgeries; covered platforms include gaming platforms primarily providing UGC forums; $53,088 per violation | https://www.ftc.gov/business-guidance/resources/complying-take-it-down-act | 2026-10-18 | high |
| 18 U.S.C. 2258A: report to CyberTipline "as soon as reasonably possible after obtaining actual knowledge"; preserve 1 year (Pub. L. 118-59); fines $600k/$850k (<100M MAU) first/repeat; no monitoring duty | https://www.law.cornell.edu/uscode/text/18/2258A | 2026-10-18 | high |
| Cloudflare CSAM Scanning Tool compares content served through the Cloudflare cache to known CSAM lists; daily email; blocks where possible; R2/Workers coverage not stated | https://developers.cloudflare.com/cache/reference/csam-scanning/ | 2026-10-18 | high |
| CA SB 243 (companion chatbots) signed 2025-10-13; excludes video-game bots that only discuss the game (and cannot discuss mental health, self-harm, sexually explicit topics); private action ≥$1,000 per violation; reporting from 2027-07-01 | https://www.skadden.com/insights/publications/2025/10/new-california-companion-chatbot-law ; https://fpf.org/blog/understanding-the-new-wave-of-chatbot-legislation-california-sb-243-and-beyond/ | 2026-10-18 | medium (statute text not fetched) |
| EU AI Act Art. 50 transparency applies from 2026-08-02; Digital Omnibus (Reg. 2026/1744) did not delay it; marking deadline 2026-12-02 for systems already on market | https://www.legalithm.com/en/blog/eu-ai-act-what-applies-2-august-2026 | 2026-10-18 | medium |
| COPPA Rule amendments: published 2025-04-22, effective 2025-06-23, compliance 2026-04-22; separate opt-in for targeted ads | https://jonesday.com/en/insights/2025/05/ftc-finalizes-amendments-to-coppa--rule | 2026-10-18 | medium-high |
| COPPA FAQ guidance: neutral age screen lets users freely enter month/day/year; screens must not encourage falsification | https://www.zwillgen.com/ftc-state-ag/ftc-revised-faqs-coppa-compliance/ | 2026-10-18 | medium |
| FTC v. Epic (2022-12-19): $275M COPPA penalty + $245M dark-patterns refunds; voice/text chat off by default for kids/teens | https://www.hunton.com/privacy-and-cybersecurity-law-blog/ftc-announces-520-million-in-settlements-with-epic-games | 2026-10-18 | high |
| FTC v. HoYoverse (Genshin, Jan 2025): $20M; no loot boxes to under-16s without parental consent; odds and exchange-rate disclosure | https://ftc.gov/business-guidance/blog/2025/01/level-tips-businesses-ftcs-settlement-genshin-impact-developer-hoyoverse | 2026-10-18 | high |
| CA AB 1043 Digital Age Assurance Act signed 2025-10-13, effective 2027-01-01; OS age-bracket signal; developer receiving it deemed to have actual knowledge | https://www.troutmanprivacy.com/2025/10/analyzing-californias-digital-age-assurance-act/ | 2026-10-18 | medium-high |
| MediaPipe Pose Landmarker web task: browser JS loading WASM; IMAGE and VIDEO modes; `outputSegmentationMasks` default false; page updated 2026-08-17 | https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js | 2026-10-18 | high |
| CCPA "biometric information" includes face imagery, gait patterns, voice recordings; sensitive PI when processed to identify | https://california.public.law/codes/civil_code_section_1798.140 | 2026-10-18 | medium |
| Illinois BIPA: biometric identifier = retina/iris scan, fingerprint, voiceprint, scan of hand or face geometry; photographs excluded | https://lig.ilga.gov/legislation/ilcs/documents/074000140K10.htm | 2026-10-18 | high |
| SEC *Stoner Cats 2* order (2023-09-13): 10,320 NFTs at 0.35 ETH (~$8.2M) funding an animated series = unregistered securities offering; 2.5% resale royalty; $1M penalty | https://www.sec.gov/newsroom/press-releases/2023-178 | 2026-10-18 | high |
| Thirdweb terms: no token "that may constitute a security"; no illegal online gambling/wagering; under-13 use prohibited; sanctions | https://thirdweb.com/terms | 2026-10-18 | high |
| Cal. Penal Code 330b "thing of value"; *Mai v. Supercell* / *Coffee v. Google*: in-game-only, non-cashable loot items not things of value; contrary older *Score Family Fun Center* | https://wsgr.com/en/insights/recent-rulings-suggest-defendant-wins-in-loot-box-cases-are-common-appeals-all-pending.html | 2026-10-18 | medium |
| 17 U.S.C. 120(a): no right to prevent pictorial representations of a constructed architectural work visible from a public place | https://www.law.cornell.edu/uscode/text/17/120 | 2026-10-18 | high |
| Transamerica Pyramid image design mark Reg. 4813212 (Ser. 85785201), registered 2015-09-15, §8/15 accepted | https://trademark.justia.com/857/85/n-85785201.html | 2026-10-18 | medium |
| Golden Gate Bridge District holds registered marks; its photography license is limited to a named project and reserves enforcement to the District | https://www.goldengate.org/assets/1/6/license-agreement-use-of-photography.pdf ; https://trademarks.justia.com/owners/golden-gate-bridge-highway-and-transportation-district-1195138 | 2026-10-18 | medium |
| *AM General v. Activision* (S.D.N.Y. 2020-03-31): Humvees in Call of Duty protected under Rogers (realism) | https://tushnet.com/2020/04/17/humvees-in-call-of-duty-are-constitutionally-protected-realism-not-confusing-diluting/ | 2026-10-18 | medium-high |
| San Fierro is GTA San Andreas' San Francisco analogue; Gant Bridge = Golden Gate analogue | https://gta.fandom.com/wiki/San_Fierro_(3D_Universe) | 2026-10-18 | medium |
| GTA HD-universe fictional makes include Bravado, Declasse, Grotti, Karin, Pegassi, Vapid | https://www.grandtheftwiki.com/Bravado | 2026-10-18 | medium |
| GitHub trademark policy: may suspend accounts with clear intent to mislead, let holders resolve confusion, or release usernames to trademark holders | https://docs.github.com/en/site-policy/content-removal-policies/github-trademark-policy | 2026-10-18 | high |
| REUSE spec 3.3; `reuse lint` verifies compliance; tool GPL-3.0-or-later (pre-commit rev v6.2.0) | https://github.com/fsfe/reuse-tool | 2026-10-18 | high |
| ScanCode Toolkit detects licenses, copyrights, package manifests in source and binaries; Apache-2.0 | https://github.com/aboutcode-org/scancode-toolkit | 2026-10-18 | high |
| Local: playgta5 inventory has 1,528 `.rpf` files with RPF7 bytes `37 46 50 52` (LE 0x52504637), 1,134 `.fxc` (DXBC), RSC7 resources, `.ytd/.ydd/.yft/.awc/.ymt/.ugc`; Grand-V `oyun_turkce.py` handles GXT2 magic `2TXG`; gta-sa-earth parses `.dff/.txd/.img/.ipl/.ide/.col/.scm/.ifp` from users' files; no LICENSE in gta-sa-earth, San-Francisco, playgta5; SK8V Apache-2.0 with GTA V/Skate 3 integration and GPL later upstream; universal-modder MIT with `um publish check` | `${REPOS}/playgta5/{INVESTIGATION.md,snapshot/asset-evidence.json,snapshot/files.jsonl}`, `${REPOS}/Grand-V/LauncherApp/web-tr/oyun_turkce.py`, `${REPOS}/gta-sa-earth/{README.md,index.html}`, `${REPOS}/SK8V/NOTICE`, `${REPOS}/universal-modder/skills/mod-any-game/references/safety.md` | 2026-10-18 | high |

## Unverified

- Exact current statutory text of Civ. Code 3344/3344.1 and SB 243 from leginfo.legislature.ca.gov (blocked by a bot challenge). FindLaw (current through 2026-01-01) and law-firm summaries were used. Two September 2026 bills reportedly amended the SB 243 chapter (SB 1119 removing minor-specific duties; SB 867 on toys), from one source only.
- Whether 3344.1's "audiovisual work" exemption and digital-replica rules apply to interactive games (the statute does not mention games). Whether a stylized, non-photoreal caricature can ever be a "highly realistic" digital replica (likely not, by definition; needs counsel).
- Whether 17 U.S.C. 120(a) covers navigable 3D models (versus 2D pictorial representations).
- Whether §230 bars state right-of-publicity claims against us for UGC in the Ninth Circuit (*Perfect 10 v. CCBill*) versus the Third Circuit (*Hepp v. Facebook*). Not checked this session.
- *Kater v. Churchill Downs* and other "thing of value" decisions outside California.
- Tennessee ELVIS Act, New York's digital-replica statutes, and other states' publicity or post-mortem laws. Not checked.
- Current registration status of Lynch's "Beast Mode"/"I'm just here…", Curry's "NIGHT NIGHT"/"Nuit. Nuit.", "Thizz", and any marks of Too Short, P-Lo, Jay Anthony, 1 Umbrella, Adil Mania or Ray Fernando.
- Whether the Mac Dre estate has a California Secretary of State successor-in-interest registration (3344.1(f)).
- Owner of the Transamerica image mark; any Golden Gate Bridge District policy for games.
- OpenAI's current API refusal behaviour for public-figure images, and the identity of the owner's "OpenAI Sunburst" (owned by genai-pipeline-fal). The OpenAI policy pages were bot-blocked, so wording comes from search snippets.
- Which fal endpoint serves the owner's "MiniMax H3 Max Turbo" and whether its terms cover US commercial use. fal model-specific licence pages were not fetched (genai-pipeline-fal decides).
- ACE-Step weights licence; Suno's current ownership clause and V6 launch details; ElevenLabs Enterprise Music pricing.
- Cloudflare CSAM Scanning Tool coverage of R2 objects served through Workers or custom domains, and the availability/pricing of PhotoDNA or Thorn Safer for a small studio.
- *Midler v. Ford* holding wording (secondary only); *Alexander v. Take-Two* 2024 damages ruling (secondary only); NO FAKES floor objection on 2026-09-30 (single source).
- UK Online Safety Act and EU DSA duties for a US-only v1 with incidental EU/UK visitors.
- Rockstar's 2007 removal of GTA parody elements ("Grand Theft Scratchy") from *The Simpsons Game* (commentary source only; not used for any rule).
- Clearance of the candidate titles ("Dee-Verse: Tha Bay" etc.) and of "Dee-Verse" itself at the USPTO. Not searched.
- Real Bay Area radio call signs and DJ names for the M5 denylist (to be compiled by S05).
- The full Rockstar in-world brand list (beyond the six makes verified) for `ip:strings`.

## Open questions

1. **Title (owner + counsel):** accept "Dee-Verse: Tha Bay" (or another candidate) as the shipped name, keeping "GTA – Tha Bay" as the internal codename only? Default applied: yes.
2. **G2 follow-up:** which subjects will the owner approach for consent first? Recommended order: Ray Fernando, Adil Mania, P-Lo, Jay Anthony, 1 Umbrella. Will the owner fund individual deals for Curry, Lynch, E-40 or Too Short, or keep them `parody`/`fictionalized`?
3. **Mac Dre:** contact the estate (Wanda Salvatto) for an homage? Until then he stays `fictionalized` (no name, voice, marks or likeness).
4. **Counsel:** who signs off on the parody-tier rules, the ToS/UGC licence, the consent release template and the DMCA/NCII processes, and by which milestone?
5. **Age rating:** confirm 17+ (assumed). A teen rating changes voice vendors, chat defaults, NPC memory and camera consent.
6. **Geography:** confirm a US-only v1 geo-gate. When does an EU/UK compliance pass happen?
7. **Music budget:** stay under ElevenLabs Music "Indie Game" limits, budget Enterprise Music, or commission human composers for the soundtrack core?
8. **Trademark search budget** for the chosen title and the "Dee-Verse" brand (USPTO knock-out + counsel opinion)?
9. **Hash-matching vendor** for CSAM/NCII (PhotoDNA, Thorn Safer, or Cloudflare cache-only)?
10. **Fighter roster:** with parody subjects barred from their fame domain and from marketing, does the owner still want named-person-inspired fighters at launch, or original fighters with real-person cameos only after consent?
11. **Repo visibility:** when will `gratitude5dee/GTA-Tha-Bay` become public? The rename and `history:scan` must happen before then.
12. **Mod remix:** may user experiences reuse first-party `fictionalized`/`original` characters (`ugc_remix`), and under what licence?
