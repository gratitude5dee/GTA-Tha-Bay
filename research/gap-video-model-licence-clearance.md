# gap-video-model-licence-clearance: licence clearance of cutscene video models on fal (MiniMax H3 family and fallbacks)

Research dimension `gap-video-model-licence-clearance` (S00). Checked 2026-10-18. **This is engineering research, not legal advice.** Every place where counsel must decide is marked **[COUNSEL]**.

This report extends `research/genai-pipeline-fal.md` §6.2–6.3, the "Unverified" list and rec 3 (ADR-GENAI-01), and `research/legal-ip-likeness.md` §3.4 and §8. It does not repeat their endpoint catalogue, prices or likeness tiers. Requirements in scope: R-CUT-01..03, R-ENG-03, R-IP-02, R-NPC-03/04 and the 17+ audience assumption (legal-ip-likeness §5.3 item 1). Owner updates apply: US-only, SF-first.

**Method.** Primary texts were downloaded with `curl` and read in full:
- the fal ToS, API Services Supplemental Terms, AUP, Trust & Safety and `/verify` pages;
- fal model pages: the embedded `endpointBilling` JSON (`provider_type`, `is_partner_api`, `hostingType`, `enterprise_status`) and `llms.txt`;
- the fal registry API;
- fal's H3 pages: the blog post, the landing pages and the H3-vs-H3-Max comparison;
- MiniMax's sources: the H3 `LICENSE` and `docs/QA-about-License.md` on Hugging Face, the HF licence Q&A thread (#12), the MiniMax Open Platform ToS (from the page's `__NEXT_DATA__`) and the H3 licence-request form bundle;
- vendor terms: Google's Gemini API Additional Terms, the Google Cloud Service Specific Terms and Google's Prohibited Use Policy; the LTX-2.x Community License on GitHub; Comfy's MiniMax licence page.

I also downloaded the example output MP4 from each fal model page and inspected it with `ffprobe` and a byte-level C2PA/JUMBF scan. Kling's, BytePlus's and Alibaba's terms pages render only with JavaScript and could not be read, so their rows rely on secondary sources and are labelled. Raw files: `/tmp/claude-0/-home-user/d5596183-032b-5cac-9516-8839e0bfb562/scratchpad/s00lic/`.

---

## 0. Headline

1. **fal publishes no H3-specific licence, and no public document shows that fal holds a MiniMax licence covering its US customers.** The H3 Max and Turbo model pages show only a "Commercial use" badge (registry `license_type: commercial`, `githubUrl: ""`). fal's H3 landing pages say "Content generated through the fal.ai API can be used in commercial projects. Check fal.ai's terms of service…". The fal ToS and API Services Terms never mention MiniMax, H3 or territory.
   - The `commercial` flag does not take territory into account. 195 of the first 200 registry entries carry it, including `fal-ai/hunyuan-video`, whose Tencent licence "DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA".
   - fal is a San Francisco company that openly post-trains and serves an H3 Model Derivative. It calls itself a "Day 0 ecosystem partner". This makes some MiniMax authorization likely, but its scope (whether it covers customers' US outputs) is **UNVERIFIED**.
2. **MiniMax's own documents separate the API from the open weights.** MiniMax's licence Q&A in its HF repo says "API: Globally available with built-in safeguards", and "Keep MiniMax-H3 API available globally". The MiniMax Open Platform ToS (effective 2026-03-30, Nanonoble Pte. Ltd.) has no territory exclusion. It contemplates a US service region and says "you retain your ownership rights in Client input and generated content". It also adds an IP indemnity, a **deep-synthesis labelling duty** and a ban on "violent, murderous … content". So the partner path `minimax/h3/*` has the strongest primary-source footing of the three H3 paths. Whether fal's partner endpoint passes through these API terms is still **UNVERIFIED**. Oddly, it is flagged `hostingType: serverless` rather than `proxy`.
3. **H3 Max and Turbo are still blocked.** fal calls them post-trains of the open-weight H3. That makes them "Model Derivatives" under a licence whose §V.4 bars using or displaying "the MiniMax H3 Works or any of their Outputs … outside the Applicable Territory" (which excludes the USA). Only a written MiniMax authorization that covers fal's customers can clear them. MiniMax runs an excluded-territory request form at `platform.minimax.io/h3-license`. Comfy, as a reseller, sells commercial licences but excludes "API aggregator, inference-as-a-service" use.
4. **The 18+ clause is fal ToS §2 (Eligibility), not §4(b).** §2 says that a Customer "with a Customer Solution for your own End Users … [is] responsible for ensuring that your End Users are at least 18". "End Users" means "your end user customers who use the Customer Solution". Read literally, a game whose backend calls fal makes every player an End User, including viewers of cached clips.
   - **Mitigation:** generate all cutscenes in an internal production pipeline (§4(a) "personal or internal business use"). Then the public game never calls fal and arguably is not a Customer Solution. **[COUNSEL]**
   - The NPC builder (user-triggered generation) is a Customer Solution under any reading, so it needs an 18+ gate.
5. **Google's terms forbid use in apps "likely to be accessed by individuals under the age of 18".** This appears in both the Gemini API Additional Terms and Google Cloud SST §20(d). It conflicts with a 17+ game unless counsel accepts the internal-pipeline reading. So the earlier fallback choice (Gemini Omni Flash as `video.fallback`) is downgraded.
6. **New primary evidence on outputs:**
   - Every H3-family example output carries a **C2PA manifest signed by "fal - Features & Labels Inc."**. It holds `digitalSourceType: trainedAlgorithmicMedia` and an `ai.fal.info` assertion naming the internal endpoint and request id.
   - The Gemini example carries Google's C2PA manifest with the action "Added imperceptible SynthID watermark".
   - The Kling, Seedance, Wan and LTX examples carry no C2PA, and no visible watermark appears in their last frames.
   - All outputs are MP4 with **H.264 + AAC** at 24/25/30 fps. H3 768P renders at 1344×768 and 8–13 Mbps. This resolves two UNVERIFIEDs in genai-pipeline-fal.md.
   - Our planned transcode to a 720p/HLS rendition would strip C2PA. The LTX licence forbids removing provenance "applied to any Output".
7. **Recommended video stack:**
   - Default: **`minimax/h3/{image,reference}-to-video`** (MiniMax partner path), gated on two written answers (Q-F4, Q-M1).
   - Promote **`minimax/h3-max-turbo/image-to-video`** (the owner's choice; 33% cheaper) only after fal and MiniMax confirm in writing that Turbo outputs may be used in the US.
   - Fallback 1: **`lightricks/ltx-2.5/image-to-video/fast`**. It is the most licence-resilient option: open weights, no territory carve-out, no age clause, free below $10M revenue.
   - Fallback 2: **`google/gemini-omni-flash/v1.1/reference-to-video`**. It has the cleanest vendor terms and built-in SynthID+C2PA, but it is usable only if the game is 18+ or counsel accepts the internal-pipeline reading.
   - M05b ships with a mock provider and the in-engine fallback. Live production calls stay blocked until ADR-GENAI-01 records `cleared`.

---

## 1. Licence matrix

Legend:
- **US commercial use allowed?**
  - **Yes-P**: yes, by a primary text that binds the party we contract with.
  - **Likely**: primary vendor text says yes, but whether it passes through fal is not public.
  - **Blocked**: a primary text bars it absent an authorization we have not seen.
  - **?**: terms unreadable.
- **fal layer**: applies to every row. It contains:
  - fal ToS 2026-09-08: §2 18+ End Users; §4(a) internal-use grant; §4(b) Customer Solution grant and "Client will not expose any of the Services APIs directly to any End Users"; §4(c) no originality or non-infringement warranty; §14(b) third-party terms "may" apply; §15 indemnity, including publicity claims.
  - API Services Terms: End User agreements "as protective"; fal "will identify … which AI models are accessed via such a third-party API partner".
  - AUP: "You will not use the Services if: you are under 18"; "legally required age-gating".

| Endpoint | Host (registry/page JSON) | Licence / terms URL(s) | US commercial use allowed? | Output ownership | Display / attribution duties | Age / End-User duties | Confidence |
|---|---|---|---|---|---|---|---|
| `minimax/h3-max-turbo/{text,image}-to-video`, `/extend-video` | fal (`provider_type: fal`, `is_partner_api: false`, `hostingType: serverless`). fal's own post-train of open-weight H3, so a Model Derivative | fal ToS + H3 Community License (HF `MiniMaxAI/MiniMax-H3/LICENSE`, 2026-08-02). No fal model-specific terms exist | **Blocked** under the licence text (§V.4, AUP item 1). fal's FAQ says "can be used in commercial projects" but is silent on territory. Any MiniMax authorization fal holds is not public | Licence §VI.4: "MiniMax claims no rights over the Outputs". fal §4(c) claims no IP. **Neither assigns ownership** | Licence §IV.2: "prominently display 'MiniMax H3'" on the commercial product's UI. AUP item 12: disclose machine generation "clearly and prominently". §V.2: bind users to §V and Exhibit A terms. §V.5: safeguards and a reporting mechanism. fal signs outputs with C2PA (observed) | fal §2: End Users 18+ (see §4). The licence has no age clause; AUP item 6 bans harming minors | High (texts); Low (whether fal holds an authorization) |
| `minimax/h3-max/*` (ref2v, i2v, t2v, lip-sync, 3d-to-video…) | same as Turbo | same | **Blocked** (same) | same | same | same | same |
| `minimax/h3/{text,image,reference}-to-video` (+ `/lora`) | MiniMax partner (`provider_type: partner`, `is_partner_api: true`) but **`hostingType: serverless`**, whereas the older `fal-ai/minimax/hailuo-2.3/*` endpoints are `proxy`. The C2PA softwareAgent is `fal-ai/minimax` | MiniMax Open Platform ToS (`platform.minimax.io/protocol/terms-of-service`, effective 2026-03-30) **if** it passes through. MiniMax's H3 licence Q&A (HF `docs/QA-about-License.md`). fal ToS §14(b) | **Likely**. MiniMax says the API is "Globally available". Its ToS has a US service region and no territory exclusion. Pass-through via fal is **UNVERIFIED** | MiniMax ToS IP §3: "you retain your ownership rights in Client input and generated content". MiniMax may use them "to provide, maintain, develop, and improve". MiniMax ToS IP §4: MiniMax defends patent and copyright claims (within liability caps; reach to fal's customers UNVERIFIED) | MiniMax ToS "User Rights" §1: "add non-intrusive identifiers… place a prominent mark… within generated or edited content to inform the public of the use of deep synthesis technology". Prohibited content includes "violent, murderous … content". fal C2PA observed | MiniMax ToS: under-18s "read this Agreement with a guardian". No end-user age floor. fal §2 still applies | Medium |
| MiniMax direct API (not on fal; for comparison) | MiniMax (Nanonoble Pte. Ltd., Singapore; SIAC arbitration) | same MiniMax ToS | **Yes-P** (no exclusion; US region exists) | as above | as above. H3 licence AUP item 12 is not part of the API ToS | as above | High (text); Medium (whether the H3 licence also attaches to API outputs) |
| `google/gemini-omni-flash/v1.1/reference-to-video` | Google partner via fal proxy (`hostingType: proxy`). Whether fal uses the Gemini API or Vertex AI is UNVERIFIED | Gemini API Additional Terms (last updated 2026-04-28); Google Cloud SST §20 (last modified 2026-10-12); Generative AI Prohibited Use Policy (2024-12-17) | **Yes-P** for commercial use. **But** both channels bar use in a service "directed towards or is likely to be accessed by individuals under the age of 18" | Gemini API: "Google won't claim ownership over that content". GCP: "Google does not assert any ownership rights in any new intellectual property created in the Generated Output". Google's output indemnity covers only direct GCP customers and excludes third-party services | PUP bars "Impersonating an individual … without explicit disclosure, in order to deceive" and "Misrepresenting the provenance of generated content". SynthID + Google C2PA are embedded (observed) | **Under-18 restriction** (both channels); 18+ to use the APIs | High (texts); Medium (channel) |
| `fal-ai/kling-video/o3/pro/reference-to-video` | Kuaishou partner via proxy | Kling "Terms of API Paid Service" (`kling.ai/document-api/guides/protocols/paid-service`): **JS-only, not read** | **?** Secondary sources say paid and API use permits commercial use (§3.1.2 or §6.4 cited inconsistently) | **?** Secondary sources conflict on ownership versus Kling's licence to use content | **?** No C2PA and no visible mark in the fal example | **?** | Low |
| `bytedance/seedance-2.5/us/reference-to-video` | ByteDance partner via proxy, labelled "US-hosted" | BytePlus "Specific Terms for the BytePlus Video Generation Model Services" (last updated 2026-09-08): **JS-only, not read** | **?** fal's "US-hosted" label suggests US service is intended | **?** | Secondary: visible watermark and C2PA on BytePlus output. Neither was observed in the fal example | **?** Secondary: ModelArk rejects reference images or videos with real human faces | Low |
| `alibaba/wan-3.0/reference-to-video` | Alibaba partner via proxy. **No open weights** (HF `Wan-AI` has none for 3.0) | Alibaba Cloud Model Studio terms: **not read** | **?** | **?** | Secondary: the Model Studio API `watermark` parameter defaults to false for Wan 3.0 | **?** | Low |
| `lightricks/ltx-2.5/image-to-video/fast` | Lightricks partner via proxy (`ltx-2.5-api` group). Open weights also exist (HF `Lightricks/LTX-2.5`, 2026-07-23) | LTX API Terms of Use (help-centre summary only; secondary). **LTX-2.x Community License** (2026-08-11) for the weights | **Yes** (weights licence: no territory exclusion; entities with ≥$10M annual revenue need a paid Commercial Use Agreement). API: secondary summary says outputs are yours, including commercially | Licence §5: "Licensor claims no rights in the Output you generate". API: secondary | Licence §6: comply with the EU AI Act and the California AI Transparency Act; "shall not remove, disable, alter, or circumvent … metadata, watermarking, content provenance … applied to any Output". Attachment A item 7: no impersonation or deepfakes without consent | Attachment A: do not harm minors. No age floor | High (weights licence); Low (API terms via fal) |

**Reading the matrix:**
- No row clears US commercial use through fal on primary text alone.
- Gemini clears commercial use but collides with the 17+ audience.
- LTX clears it on the open-weights licence, and that remains available as a self-host escape hatch. Whether the API terms behind fal match is unconfirmed.
- The H3 partner path is "Likely". Turbo/Max are "Blocked" until a written authorization exists.

---

## 2. Q1: Does fal publish H3-specific terms or claim a MiniMax licence?

| Source | What it says (verbatim where it matters) |
|---|---|
| Model pages `minimax/h3-max-turbo/*`, `minimax/h3-max/*` | Only a "Commercial use" badge. `"licenseType":"commercial"`, `"githubUrl":""`. `endpointBilling`: `"provider_type":"fal","is_partner_api":false`. The only legal link is `termsOfService: https://fal.ai/legal/terms-of-service`. Registry description: "fal's H3 Max Turbo is a post-trained variant of MiniMax H3…" |
| Blog "Introducing H3 Max by fal" (2026-08-26) | "a post-trained version of MiniMax H3 developed by fal Research"; "We started with the open-weights MiniMax H3 model and introduced substantial new data during post-training". Compares against "the official MiniMax H3 endpoint". **No licence or territory text.** |
| Landing `fal.ai/minimax-h3-max` and `fal.ai/minimax-h3` | "Can I use MiniMax H3 Max for commercial projects? Yes. Content generated through the fal.ai API can be used in commercial projects. Check fal.ai's terms of service for full details on usage rights and licensing." The H3 page adds: "fal is a Day 0 ecosystem partner, which means you can call the hosted MiniMax H3 API on fal.ai from launch". |
| fal Learn "MiniMax H3 vs. MiniMax H3 Max" (2026-08-31) | Table row "Commercial use: Yes, subject to fal's terms" for both. "We at fal trained MiniMax H3 Max using H3's open weights". "Post-trained from the open-weight base, no separate weights release listed". Attribution caption used: "Generated using MiniMax H3 Max on fal, an AI model post-trained by fal from MiniMax H3." |
| fal ToS / API Services Terms | No mention of MiniMax, H3 or territory. API Services Terms define the Company Platform as "proprietary and third-party licensed machine learning and diffusion models". fal ToS §14(b): third-party materials "may be subject to additional terms, conditions, and policies". |
| fal platform changelog (`docs.fal.ai/changelog`) | No H3 or C2PA entries. |
| fal ↔ MiniMax partner agreement | Not public. A press release ("fal Launches MiniMax H3 as an Official API Partner", openPR) was seen only in search; fetching it returned 403. |

**Conclusion.**
- fal makes a marketing-level commercial-use statement and points to its ToS. The ToS grants no output licence and warrants nothing (§4(c)).
- fal does **not** claim, anywhere public, a separate commercial licence from MiniMax.
- The facts make an authorization plausible: fal is US-based, openly post-trains, and is a "Day 0 ecosystem partner". MiniMax also publicly invites US persons to request licences. But plausible is not cleared. **[COUNSEL]** must decide whether fal's FAQ statement is a representation we can rely on. Engineering should treat it as not sufficient.

**Licence mechanics that bind a fal customer if fal relies on the Community License:**
- §III, last sentence: "If you receive the MiniMax H3 Works from a Licensee as part of an integrated end-user product, the provisions of Section III … do not apply to you, but Section V and Exhibit A remain applicable." So §V.4 (no use or display of Outputs outside the territory) would follow the outputs to us.
- §V.2 obliges fal to "bind each recipient or user to enforceable terms at least as protective as the use restrictions in this Section V and Exhibit A". fal's public ToS contains no such flow-down. Either fal's arrangement is not the Community License, or fal has not flowed it down. Ask (Q-F3).

**MiniMax's own channel for excluded territories.**
- The licence §II says: "should any person in such Excluded Territories be interested in deploying our models, you are welcome to contact us about obtaining a license".
- The form at `platform.minimax.io/h3-license` asks the applicant to comply with the licence and AUP "except to the extent any territorial restriction would otherwise preclude our use in the Excluded Territory". It also requires safeguards and a reporting mechanism, "bind each recipient or user", confidentiality and an indemnity.
- A MiniMax org member on HF (discussion #12) wrote: "US-based persons looking to deploy MiniMax-H3 may submit formal licensing requests". For the Swiss production-service case: "If you sign https://platform.minimax.io/h3-license, it's ok for you to provider globally". This is a forum statement, not a contract amendment.

---

## 3. Q2: MiniMax API terms and whether the H3 territory clause reaches API outputs

**MiniMax Open Platform ToS** (`platform.minimax.io/protocol/terms-of-service`; the old `intl.minimaxi.com` and `minimax.io/platform` URLs redirect there; "Effective Date: March 30, 2026"; provider Nanonoble Pte. Ltd., Singapore):

- **Territory.** No excluded territories. §User Rights 8: "If you select the United States as the service region, you … may not: (a) Process or store any content subject to … ITAR … or (b) … HIPAA". So the US is a supported region. Sanctions apply (OFAC/EU/UN lists; Crimea, DPR, LPR and similar).
- **Output ownership.** IP §3: "As between you and us, and to the extent permitted by applicable laws, you retain your ownership rights in Client input and generated content. We may use the input and generated content to provide, maintain, develop, and improve our Services…".
- **IP indemnity.** IP §4: MiniMax "will defend you" against third-party patent or copyright claims about "your or your end-users' use", "within the limitations of liability". There are exclusions for breach, Client Data and combinations.
- **Commercial use.** Allowed implicitly (paid service). §User Rights 7(c) bars "Independently sublicense, resell, or distribute any or all services outside of any integrated applications".
- **Labelling.** User Rights §1: "adopt technical measures to add non-intrusive identifiers, maintain log information…, and place a prominent mark in reasonable positions or areas within generated or edited content to inform the public of the use of deep synthesis technology".
- **Content rules.** Prohibits "Creating or disseminating obscene, pornographic, violent, murderous, terroristic, or criminal incitement content" and "Insulting or slandering others". This matters for crime-parody cutscenes. **[COUNSEL]**
- **End users.** "You are responsible for all use of the service by end-users … and you must ensure that each end-user complies with applicable terms". There is no age floor. Under-18 contracting parties should read with a guardian.

**Does the H3 Community License territory clause apply to API outputs?**
- **No, per MiniMax's own published Q&A** in the H3 repo (`docs/QA-about-License.md`, committed 2026-08-06): "Why can MiniMax-H3 API be used globally if open weights are restricted in some regions? The difference is the distribution model… API: Globally available with built-in safeguards… Open weights: Temporarily limited in certain regions". Its commitments include "Keep MiniMax-H3 API available globally".
- **But the licence text pulls the other way.** Its definitions reach use "through any Hosted Services". "Output" is defined as results "(including through Hosted Services)". The Q&A is not incorporated into the licence.
- **[COUNSEL]** must confirm that MiniMax's API customers, and customers of MiniMax's partner endpoint on fal, are not licensees under the Community License. The cleanest answer is a written statement from MiniMax (Q-M1).

**Is `minimax/h3/*` on fal "MiniMax's API"?**
- For: fal marks it `is_partner_api: true`. The API Services Terms say fal "will identify … which AI models are accessed via such a third-party API partner". fal's blog contrasts H3 Max with "the official MiniMax H3 endpoint".
- Against: `hostingType` is `serverless`, not the `proxy` used for every other partner checked (Hailuo 2.3, Speech 2.8, Google, Kling, ByteDance, Alibaba, Lightricks, OpenAI, Meshy). The C2PA manifest is signed by fal with softwareAgent `fal-ai/minimax` and internal endpoint `fal-ai/minimax/hailuo-03/reference-to-video`.
- Conclusion: which entity runs inference, and which terms govern it, is **UNVERIFIED** (Q-F4).

---

## 4. Q4: fal "End User" definition and players who only watch cached clips

**Verbatim (fal ToS, Last Updated September 8, 2026, `fal.ai/legal/terms-of-service`):**
- §2 Eligibility: "In order to use ourServices, you must be 18 years of age… As described further below in Section 4(b), if you are a Customer with a Customer Solution for your own End Users, or if you otherwise create a Team Organization account, you are responsible for ensuring that your End Users are at least 18 years of age (or the age of legal majority in the jurisdiction of the End Users)."
- §3(a): "'Customer Solution' means your product or services that integrate or interface with the Services through application programming interfaces ('APIs') and is made available to your End Users."
- §3(c): "'End Users' means your end user customers who use the Customer Solution."
- §4(a): "…for your own personal or internal business use."
- §4(b): "The following provisions apply if your use case involves accessing the Services through a Customer Solution using our APIs: (i) … (C) allow End Users to access and use the Services through the Customer Solution…; (ii) … Client will not expose any of the Services APIs directly to any End Users."
- API Services Terms: "'End Users' means customers of Client who use the Client Solution." "End User Agreements. Client will enter into legally enforceable agreements with its End Users … as protective of the Services…".
- AUP, "Other Restrictions": "You will not use the Services if: you are under 18 years of age". "Managing End User Accounts": a violation if you "Fail to employ, with respect to your End Users, any legally required age-gating and verification."

**Correction to earlier reports:** the 18+ End User duty sits in §2, which cross-refers to §4(b). §4(b) itself contains the grant and the no-direct-exposure sentence, not an age clause.

**Analysis (engineering view) [COUNSEL]:**
- **Literal reading.** If the game's backend calls fal (for example, a Worker that generates a cutscene on a cache miss), the game "integrate[s] … with the Services through APIs". It is then a Customer Solution, and *every* player "who use[s] the Customer Solution" is an End User. On that reading, a 17-year-old who only watches cached MP4s is an End User for whom we must "ensure… at least 18".
- **Narrow reading.** The duty attaches to End Users who "access and use the Services through the Customer Solution" (§4(b)(i)(C)). A viewer of a static file in R2 does not access fal's Services. This is plausible, but the definitions do not say it.
- **Architecture that avoids the question.**
  1. Run all cutscene generation as an internal production activity under §4(a): admin-only Workflow or CLI, fal key held by staff, all operators 18+.
  2. The public game has **no code path that reaches fal**. A cache miss falls back to the in-engine DirectorScript (R-CUT-03) and is never queued automatically.
  3. MP4s ship as release assets from R2.
  - Then the game arguably is not a Customer Solution and players are not End Users.
  - Open point: whether producing commercial game assets counts as "internal business use". By analogy to using a tool to make assets, it plausibly does. **[COUNSEL]**
- **NPC builder.** User-triggered generation (R-NPC-03) makes the game a Customer Solution under any reading. Ship it only behind sign-in, an 18+ age gate and a ToS flow-down, as genai-pipeline-fal rec 16 already says. If counsel adopts the literal reading, enabling the builder may pull the *whole* game into Customer-Solution status. Then either the product becomes 18+, or the builder runs as a separate service. **[COUNSEL]**
- **The same pattern applies to Google.** The restriction bites when the service is used "as part of a website, Customer Application, or other online service" likely accessed by under-18s. An offline production pipeline is arguably not "part of" the game. **[COUNSEL]**

---

## 5. Q3: Fallback terms (details behind the matrix)

- **Google Gemini Omni Flash 1.1**
  - Gemini API Additional Terms (last updated 2026-04-28): "You must be 18 years of age or older to use the APIs. You also will not use the Services as part of a website, application, or other service… that is directed towards or is likely to be accessed by individuals under the age of 18." "Google won't claim ownership over that content." "Use of Google AI Studio and Gemini API is for developers building with Google AI models for professional or business purposes".
  - Google Cloud SST §20 (last modified 2026-10-12): §20(a): "Google does not assert any ownership rights in any new intellectual property created in the Generated Output". §20(d) has the same under-18 restriction. §20(i) indemnity "does not apply to allegations arising from … any Third-Party Service through which Customer accesses any AI/ML Service". That excludes access through fal.
  - Prohibited Use Policy (2024-12-17): "Impersonating an individual (living or dead) without explicit disclosure, in order to deceive" and "Misrepresenting the provenance of generated content by claiming it was created solely by a human".
  - Product notes: 3–10 s clips, 16:9 or 9:16 only (genai-pipeline-fal). Example output: Google C2PA, "Created by Google Generative AI.", "Added imperceptible SynthID watermark".
- **Kling O3 Pro.** Kling's API agreements (`kling.ai/document-api/guides/protocols/paid-service`, `…/service-agreement`) are SPA pages; the text was not retrievable. Secondary sources (wavespeed.ai, glbgpt.com, adtestbench.com) say paid and API use allows commercial use. They also report that the general ToS §4.6 requires written permission for commercial use by non-members, and that Kling may use content for promotion. **UNVERIFIED.** The fal example had no C2PA and no visible mark. The `enable_safety_checker` toggle needs account authorization to disable.
- **Seedance 2.5 US.** The BytePlus specific terms page (last updated 2026-09-08) and the "Copyright and Portrait Feature Usage Rules" are JS-only and were not read. Secondary sources (aividpipeline.com, seedrouter.ai, thenextweb.com):
  - ModelArk rejects references containing real human faces unless the person is authorized through ByteDance's own workflow or a virtual-portrait library.
  - Output carries a visible watermark and C2PA.
  - The fal example showed neither.
  - The price is 4–10× H3 (genai-pipeline-fal). **UNVERIFIED.**
- **Wan 3.0.** API-only (no Wan 3.0 weights on HF `Wan-AI`). The Alibaba Cloud Model Studio terms were not read. Secondary (Model Studio API reference via search): the `watermark` parameter defaults to false for Wan 3.0; older Wan versions add an "AI Generated" mark at the lower right. **UNVERIFIED.**
- **LTX-2.5.**
  - Open weights `Lightricks/LTX-2.5` (HF card `license: other`, `license_name: ltx-2.x-community-license-agreement`, link `github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x`, licence date 2026-08-11).
  - No territory carve-out beyond sanctions.
  - Entities with "annual revenues of at least $10,000,000" need a paid Commercial Use Agreement (`licensing@ltx.io`).
  - §5: "Licensor claims no rights in the Output".
  - §6: AI-regulation compliance (it names the EU AI Act and Cal. Bus. & Prof. Code §22757) and the anti-stripping rule for provenance and watermarks.
  - Attachment A: no deepfakes without consent; do not harm minors.
  - The fal endpoint is a Lightricks API proxy. The LTX Help Center (secondary; 403 to direct fetch) says API outputs are the user's, including for commercial use.
  - **The weights licence is a real escape hatch:** if fal access ever ends, we can self-host LTX-2.5 on our own GPUs with no US exclusion.

---

## 6. Q5: Disclosure and labelling duties per vendor

| Vendor / text | Duty | Observed in fal example output (2026-10-18) |
|---|---|---|
| MiniMax H3 Community License | §IV.2: "prominently display 'MiniMax H3'" on the commercial product's UI. AUP item 12: disclose machine generation "clearly and prominently" in public environments. §III.3 (encouraged only): "Powered by MiniMax H3" and an AI-generation identifier on files. HF staff answer (2026-08-06): an end-credit disclosure is sufficient, and "If any H3 generated used in final output, it needed" | H3 Max Turbo, H3 Max and H3 partner examples carry a fal-signed C2PA manifest (`c2pa.created`, `trainedAlgorithmicMedia`, `ai.fal.info` {endpoint, request_id}). No visible mark |
| MiniMax Open Platform ToS | Non-intrusive identifiers, logs, and "a prominent mark … within generated or edited content" | — |
| fal | No contractual labelling duty in the ToS. `/verify` says media from fal's hosted applications is "signed with Content Credentials (C2PA) … and embedded with an invisible watermark". Limits: "fal-hosted apps only… or via fal in configurations that don't apply signing". The AUP bans "Extracting any metadata or reverse-engineering model behavior to infer … content provenance" | H3 family: C2PA present. Partner proxies (Kling, Seedance, Wan, LTX): absent |
| Google | PUP: no deceptive impersonation without disclosure; no misrepresenting provenance. SynthID and C2PA applied by Google | Google C2PA + SynthID action present |
| Lightricks (LTX-2.x licence §6) | Comply with AI transparency laws. **Do not remove** provenance, watermarks or latent disclosures "applied to any Output" | None present in the example |
| Kling, ByteDance, Alibaba | UNVERIFIED (see §5) | None present |
| California AI Transparency Act (SB 942 as amended by AB 853; Bus. & Prof. Code §22757 et seq.) | Operative 2026-08-02 per multiple secondary sources. The duties (latent disclosure, optional manifest disclosure, detection tool) fall on **covered providers** (GenAI systems with >1M monthly users per the original text; a threshold change is reported but UNVERIFIED). AB 853 adds platform and capture-device duties from 2027 (dates UNVERIFIED). Engineering view: we are not a covered provider for pre-rendered cutscenes. A future public NPC builder might be. **[COUNSEL]** | — |

**Pipeline consequence.** genai-pipeline-fal §2.3 plans to transcode MP4s to 720p or HLS. Any re-encode drops the C2PA box. To meet MiniMax's identifier duty, the LTX anti-stripping clause and SB 942 hygiene:
1. Keep the provider's signed original as `master.mp4` in R2, immutable.
2. Re-sign each derived rendition with our own C2PA claim (c2pa-rs or `c2patool`), listing the master as an ingredient and asserting `trainedAlgorithmicMedia`.
3. Show a visible "AI-generated" badge on cutscene playback (UI overlay, not burnt in).
4. Name the model in credits and settings.

---

## 7. Default endpoint and fallbacks (decision)

| Rank | Endpoint(s) | Why | Conditions before production use |
|---|---|---|---|
| **Default** | `minimax/h3/image-to-video` (Recipe K: keyframe-first, first and last frame) + `minimax/h3/reference-to-video` (Recipe R) | Satisfies R-CUT-01 ("MiniMax's video model via fal"). Strongest primary basis among H3 paths: MiniMax says its API is global; its ToS grants output ownership and an IP defence. 768p at $0.06/s; first 5 refs free. Latency doesn't matter because rendering is offline | Q-F4 (who serves it and which terms) and Q-M1 (the territory clause does not reach API or partner outputs) answered in writing. Q-M6 (violence) answered. Attribution UI shipped |
| **Promote when cleared** | `minimax/h3-max-turbo/image-to-video` (+ `/extend-video`); `minimax/h3-max/reference-to-video` for Recipe R | The owner's named model. $0.04/s versus $0.06/s. Better adherence (fal-measured) | Q-F1, Q-F2 and Q-M2 (or our own Q-M3 licence) in writing: a MiniMax authorization covering fal customers' US commercial outputs |
| **Fallback 1** | `lightricks/ltx-2.5/image-to-video/fast` | Most licence-resilient: open-weights licence with no territory carve-out and no age clause; self-host path; Recipe K fits (image-to-video); 6–20 s; $0.09/s at 720p | Confirm the LTX API terms behind fal (Q-F6). A $10M revenue trigger needs a paid licence. Keep provenance (licence §6). Test identity consistency in the M00 spike |
| **Fallback 2** | `google/gemini-omni-flash/v1.1/reference-to-video` | Best-documented vendor terms; reference mode; SynthID + C2PA included | Only if counsel accepts the internal-pipeline reading of Google's under-18 clause, or the product becomes 18+. 3–10 s and 16:9 or 9:16 only |
| Not recommended now | Kling O3 Pro, Seedance 2.5 US, Wan 3.0 | Terms unreadable (UNVERIFIED). Seedance costs 4–10× more | Re-assess if their terms are obtained in writing |

**Recipe and cache-key implications** (extends genai-pipeline-fal §2.1–2.2 and gamedesign §4.5 C09):
- **Keyframe-first (K) becomes the portable default.** All three ranked providers accept a start image. Reference-to-video (R) is provider-specific: H3 accepts ≤9 images, Gemini ≤10, and LTX-fast has no reference mode. Keep R as a per-provider enhancement, not a contract.
- **Shot-duration contract.** Durations differ: H3 partner 5–15 s, H3 Max 0.92–15 s, LTX 6–20 s, Gemini 3–10 s. A provider-portable shot is **6–10 s**. Otherwise the provider adapter splits or merges shots and records the mapping.
- **Delivery resolution.** Normalize renditions to 1280×720 (H3 768P is 1344×768; Gemini 720p; LTX 720p+). Keep the master untouched.
- **Cache key.** It already includes `gen.endpoint`, so switching providers creates new keys and never overwrites. Do **not** put licence status in the key. Put `licence.{gate, status, termsSnapshotSha256[], clearedBy, clearedAt}` in the manifest row. A licence revocation must be able to delist a key without regenerating others.
- **Cost of the v1 video set** (100 × 15 s story cutscenes plus 222 × 5 s fighter clips, 1.5× retakes, 3,915 generated seconds; LTX needs 6 s minimum shots, so 4,248 s):

  | Provider | Cost |
  |---|---|
  | Turbo | ≈ $157 |
  | H3 partner | ≈ $235 |
  | H3 Max ref | ≈ $313 |
  | LTX fast | ≈ $382 |
  | Gemini 720p | ≈ $392 |
  | Kling (audio on) | ≈ $548 |
  | Seedance US 720p | ≈ $1,852 |

  Add ≈ $0.04 per Sunburst keyframe. Price does not decide this; the licence does.

---

## 8. ADR text: ADR-GENAI-01 "Video provider gating"

```markdown
# ADR-GENAI-01: Video provider gating (licence-gated, provider-swappable cutscene rendering)
Status: Accepted (gate states: see config/genai/video-providers.json) · Date: 2026-10-18 · Owners: S03 (cutscenes), S05 (asset pipeline), S10 (legal pages)
Requirements: R-CUT-01, R-CUT-03, R-ENG-03, R-IP-01/02, R-NPC-03

### Context
- R-CUT-01 names "MiniMax's video model via fal.ai". fal's H3 Max / H3 Max Turbo are post-trains of open-weight MiniMax H3, whose Community License (2026-08-02) excludes the USA and bars use or display of Outputs outside its territory (§V.4). No public fal or MiniMax document clears US commercial use of fal-hosted H3 outputs.
- MiniMax states its H3 API is "globally available"; whether fal's `minimax/h3/*` partner endpoint carries those API terms is unconfirmed.
- fal ToS §2/§3(c): End Users of a Customer Solution must be 18+. Google's terms bar services likely accessed by under-18s. The game targets 17+.
- Video vendor terms change often (fal ToS 2026-09-08; Google SST 2026-10-12; endpoints deprecated, e.g. Veo 3 on fal).

### Decision
1. All video generation goes through one `VideoProvider` interface (packages/genai-core/src/video/provider.ts). Providers are config entries, not code branches. Shot specs are provider-neutral (6–10 s shots, start keyframe, optional end keyframe, optional refs).
2. Every provider entry carries a licence record: `status: cleared | pending | blocked`, `usCommercialOutputs`, `under18Audience: allowed | forbidden | unknown`, `endUserMode: internal-pipeline-only | customer-solution`, `duties` (UI credit text, per-clip AI label, keep-C2PA), and `evidence[]` (URL, sha256 of the stored terms snapshot, checkedAt, written-confirmation file path).
3. Production generation is an internal production pipeline (admin Workflow/CLI, staff fal key). The public game has no path to fal. A cache miss plays the in-engine DirectorScript (R-CUT-03) and emits `cutscene_miss` telemetry; it never auto-enqueues generation.
4. Provider order: default `h3.partner` (minimax/h3/*); `h3.maxTurbo` promoted only on clearance; fallback-1 `ltx25.fast`; fallback-2 `gemini.omniFlash11` (only if `under18Audience` is resolved to allowed for our mode or the product is 18+).
5. Provenance: store the provider's signed original as `cutscenes/{key}/master.mp4` (immutable); each rendition is re-signed with our C2PA claim (ingredient = master, digitalSourceType = trainedAlgorithmicMedia). Playback shows an "AI-generated" badge; credits and Settings › About list "Cutscenes generated with <model> via fal" (for any H3-family provider: the literal string "MiniMax H3").
6. User-triggered video generation (NPC builder) is out of v1; when added it is a Customer Solution: sign-in, 18+ age gate, ToS flow-down of fal AUP + provider terms, server-side only.

### Gates (what blocks M05b live calls)
M05b may merge with `MockVideoProvider` (recorded fixtures) and the DirectorScript fallback. Live calls with the production fal key are blocked unless ALL hold for the selected provider:
- G1 `status: cleared` in config, backed by a written confirmation stored in docs/legal/confirmations/ (fal and, for H3, MiniMax) answering US commercial use of outputs.
- G2 Counsel sign-off recorded in this ADR's log for: End-User/age reading (fal §2), Google under-18 clause (if Gemini), H3 attribution duty, MiniMax content rules (violence, parody).
- G3 Terms snapshots stored and hashed; the weekly `terms-watch` job is green (no unreviewed changes).
- G4 Attribution UI (credits + Settings + per-clip badge) and C2PA re-signing implemented and tested.
- G5 Budget caps and the admin-only prewarm path in place (R-ENG-03).
A non-production "previs" fal key may call `pending` providers; outputs go to R2 `previs/`, carry `x-dee-previs: true`, and CI fails any release AssetManifest that references `previs/`.

### Consequences
+ Swapping providers is a config change plus new cache keys; old clips stay valid under their recorded licence.
+ The 17+ question is decoupled from cutscenes.
− No on-demand cutscenes for late keys; content must be prewarmed before release.
− Re-signing adds a C2PA tool to the pipeline.
− If no H3 path clears, R-CUT-01 is amended to "a licence-cleared video model via fal (MiniMax preferred)".

### Log
- 2026-10-18: created; h3.partner = pending (Q-F4, Q-M1); h3.maxTurbo/h3.max = blocked (Q-F1, Q-F2, Q-M2); ltx25.fast = pending (Q-F6); gemini.omniFlash11 = pending (counsel: under-18); kling/seedance/wan = pending (terms unread).
```

Config sketch the ADR refers to:

```ts
// packages/genai-core/src/video/provider.ts
export type LicenceStatus = 'cleared' | 'pending' | 'blocked';
export interface ShotSpec { shotId: string; durationS: number /* 6..10 portable */; startFrameSha256: string; endFrameSha256?: string;
  refImageSha256?: string[]; prompt: string; aspect: '16:9'; seed?: number; audio: 'none' | 'native' }
export interface VideoProviderEntry {
  key: 'h3.partner' | 'h3.maxTurbo' | 'h3.max' | 'ltx25.fast' | 'gemini.omniFlash11' | 'kling.o3pro';
  endpoints: { i2v?: string; ref2v?: string; extend?: string };
  caps: { minS: number; maxS: number; res: string[]; firstLastFrame: boolean; maxRefImages: number; nativeAudio: boolean };
  licence: { gate: 'ADR-GENAI-01'; status: LicenceStatus; usCommercialOutputs: boolean | 'unknown';
    under18Audience: 'allowed' | 'forbidden' | 'unknown'; endUserMode: 'internal-pipeline-only' | 'customer-solution';
    duties: { uiCredit?: string; perClipAiLabel: true; keepC2pa: boolean; visibleMark?: boolean };
    evidence: { url: string; termsSnapshotSha256: string; checkedAt: string; confirmationPath?: string }[] };
  price: { usdPerS: number; resolution: string; checkedAt: string };
}
export interface VideoProvider { entry: VideoProviderEntry;
  plan(shots: ShotSpec[]): ShotSpec[];               // split/merge to caps; deterministic
  submit(shot: ShotSpec, webhookUrl: string): Promise<{ requestId: string }>;
  result(requestId: string): Promise<{ url: string; contentType: string; seed?: number; c2pa: boolean }>; }
export function assertCallable(e: VideoProviderEntry, env: 'production' | 'previs') {
  if (env === 'production' && e.licence.status !== 'cleared') throw new Error(`ADR-GENAI-01: ${e.key} not cleared`);
  if (e.licence.status === 'blocked') throw new Error(`ADR-GENAI-01: ${e.key} blocked`);
}
```

---

## 9. Written questions to send

**To fal** (legal@ / sales; ask for a signed letter or an enterprise addendum):
- **Q-F1.** Does fal (Features & Labels, Inc.) hold a written licence or authorization from MiniMax (Nanonoble Pte. Ltd.) that permits fal to post-train MiniMax H3 and to serve `minimax/h3-max/*` and `minimax/h3-max-turbo/*` to customers located in the United States? Please identify the instrument (parties, date) or confirm its existence in writing.
- **Q-F2.** Under that authorization, may a US company that is a fal customer use, reproduce, distribute and publicly display Outputs from those endpoints in a commercial video game distributed only in the United States, with no MiniMax H3 territorial restriction (Community License §V.4 and AUP item 1) applying to us?
- **Q-F3.** Which MiniMax obligations flow down to fal customers for H3 Max/Turbo:
  - (a) the "MiniMax H3" UI display (§IV.2);
  - (b) the §V.2 duty to bind our users to §V and Exhibit A terms;
  - (c) the §V.5 safeguards and reporting mechanism;
  - (d) AUP item 12 disclosure?
  What exact attribution text and placement does fal accept (credits screen, settings page, per-clip label)?
- **Q-F4.** For `minimax/h3/{text,image,reference}-to-video` (`is_partner_api: true`, but `hostingType: serverless`):
  - Which entity runs inference?
  - Which terms govern our outputs: the MiniMax Open Platform ToS (effective 2026-03-30), the H3 Community License, or a fal–MiniMax agreement?
  - Is US commercial use and distribution of outputs permitted?
- **Q-F5.** ToS §2, §3(a), §3(c) and §4(a)/(b). Our public game will never call fal and will only display MP4 files that our staff generate through an internal production pipeline under our fal account.
  - (a) Are players of that game "End Users" for the purposes of the 18+ requirement?
  - (b) Does that pipeline fall under §4(a) "internal business use"?
  - (c) If we later add user-triggered generation for signed-in adults, does the 18+ duty then extend to all players of the game, or only to users of that feature?
- **Q-F6.** For `google/gemini-omni-flash/v1.1/*`, `fal-ai/kling-video/o3/*`, `bytedance/seedance-2.5/us/*`, `alibaba/wan-3.0/*` and `lightricks/ltx-2.5/*`:
  - Please list the upstream terms that apply to fal customers (URLs and versions).
  - Does Google's restriction on services "likely to be accessed by individuals under the age of 18" apply to fal customers?
  - Which Google channel do you use (Gemini API or Vertex AI)?
- **Q-F7.** Are API outputs from all endpoints signed with fal C2PA Content Credentials and an invisible watermark, or only fal-hosted ones? Can signing be requested per call? Which watermark technology is used? (We observed fal-signed C2PA in H3-family example outputs only.)
- **Q-F8.** Under an enterprise agreement:
  - Will fal provide IP and third-party-claims indemnity for outputs of H3 Max/Turbo?
  - Will fal notify us of any change to, or termination of, its MiniMax authorization?
  - What happens to outputs generated before such a change?
- **Q-F9.** Is the registry `license_type: "commercial"` flag intended to account for territorial restrictions? (`fal-ai/hunyuan-video` is flagged `commercial`, but Tencent's licence excludes the EU, UK and South Korea.)

**To MiniMax** (via `api@minimax.io`, and the `platform.minimax.io/h3-license` form if they direct us there; keep confirmations shareable with counsel, which their HF staff said is permitted):
- **Q-M1.** Does the MiniMax H3 Community License, including §V.4 and AUP item 1, apply to Outputs a US company obtains through:
  - (a) MiniMax's Open Platform API;
  - (b) MiniMax's partner endpoint on fal (`minimax/h3/*`);
  - (c) fal's post-trained H3 Max / H3 Max Turbo?
  Your Q&A says "API: Globally available"; does that cover partner-hosted endpoints?
- **Q-M2.** Has MiniMax authorized Features & Labels, Inc. (fal) to create and serve H3 Model Derivatives (H3 Max, H3 Max Turbo) to customers in the United States? Does that authorization extend to those customers' commercial distribution of Outputs in the US?
- **Q-M3.** If our company needs its own authorization to use fal-hosted H3 Max Outputs in a US commercial game (17+, US-only, about 100–400 pre-rendered clips of 15 s or less), will MiniMax grant it via `platform.minimax.io/h3-license`? What compliance controls do you require?
- **Q-M4.** For a game, does the following satisfy §IV.2 and AUP item 12?
  - "MiniMax H3" named in the credits screen and Settings › About;
  - an "AI-generated" badge during each cutscene;
  - C2PA metadata on each file.
  Is an end-credit disclosure alone sufficient, as stated on HF discussion #12?
- **Q-M5.** Does the Open Platform ToS deep-synthesis clause ("place a prominent mark… within generated or edited content") apply to outputs obtained via fal? Does it require a burnt-in mark, or does an on-screen UI badge plus C2PA suffice?
- **Q-M6.** Does the Open Platform ToS ban on "violent, murderous … content" prohibit stylized, non-graphic action (chases, melee, no gore, no firearms) in a 17+ crime-parody game? Which content rules apply to partner-platform customers?
- **Q-M7.** Is "impersonation" (AUP item 13) triggered by parody characters inspired by real public figures when no photographs and no names are sent to the model and the game carries a parody disclaimer?
- **Q-M8.** Does MiniMax's patent and copyright defence (Open Platform ToS IP §4) extend to customers who access MiniMax models through partner platforms such as fal?

---

## Verified facts

| fact | source URL | date checked | confidence |
|---|---|---|---|
| H3 Max Turbo I2V page JSON: `provider_type: fal`, `is_partner_api: false`, `hostingType: serverless`, `enterprise_status: ready`, `licenseType: commercial`, `githubUrl: ""`; only legal link is the fal ToS | https://fal.ai/models/minimax/h3-max-turbo/image-to-video | 2026-10-18 | high |
| `minimax/h3/*` page JSON: `provider_type: partner`, `is_partner_api: true`, **`hostingType: serverless`**; older `fal-ai/minimax/hailuo-2.3/*` are `proxy` | https://fal.ai/models/minimax/h3/reference-to-video ; https://fal.ai/models/fal-ai/minimax/hailuo-2.3/pro/image-to-video | 2026-10-18 | high |
| Gemini Omni Flash, Kling O3, Seedance 2.5 US, Wan 3.0 and LTX-2.5 fast are all `partner` / `proxy` / `is_partner_api: true` / `enterprise_status: ready` | fal model pages for each endpoint | 2026-10-18 | high |
| Registry descriptions: H3 Max/Turbo are "a post-trained variant of MiniMax H3"; Seedance "US-hosted"; LTX-2.5 "Lightricks' open-source audio-video model" | https://api.fal.ai/v1/models?endpoint_id=minimax/h3-max-turbo/image-to-video (and the other ids) | 2026-10-18 | high |
| Registry `license_type` is `commercial` on 195 of the first 200 entries, including `fal-ai/hunyuan-video` and `fal-ai/flux/dev` | https://api.fal.ai/v1/models?limit=200 ; https://api.fal.ai/v1/models?endpoint_id=fal-ai/hunyuan-video | 2026-10-18 | high |
| Tencent HunyuanVideo licence: "DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA" | https://huggingface.co/tencent/HunyuanVideo/raw/main/LICENSE | 2026-10-18 | high |
| fal blog: H3 Max is "a post-trained version of MiniMax H3 developed by fal Research"; "started with the open-weights MiniMax H3 model"; no licence text | https://fal.ai/learn/devs/introducing-h3-max-by-fal | 2026-10-18 | high |
| fal landing pages: "Yes. Content generated through the fal.ai API can be used in commercial projects. Check fal.ai's terms of service…"; "fal is a Day 0 ecosystem partner" | https://fal.ai/minimax-h3-max ; https://fal.ai/minimax-h3 | 2026-10-18 | high |
| fal Learn comparison (2026-08-31): "Commercial use: Yes, subject to fal's terms"; "We at fal trained MiniMax H3 Max using H3's open weights" | https://fal.ai/learn/devs/minimax-h3-vs-minimax-h3-max | 2026-10-18 | high |
| fal ToS (Last Updated 2026-09-08): §2 End Users 18+ (cross-refers to §4(b)); §3(a) Customer Solution; §3(c) End Users; §4(a) personal or internal business use; §4(b) "Client will not expose any of the Services APIs directly to any End Users"; §4(c) no originality or non-infringement warranty and no fal IP in Output; §6(b) Customer owns Customer Input (no Output assignment); §14(b) third-party terms; governing law California | https://fal.ai/legal/terms-of-service | 2026-10-18 | high |
| fal API Services Terms: Company Platform includes "third-party licensed" models; fal "will identify … which AI models are accessed via such a third-party API partner"; End User Agreements "as protective"; no training on Client Content except "Pending Enterprise Ready" models | https://fal.ai/legal/api-services | 2026-10-18 | high |
| fal AUP: "You will not use the Services if: you are under 18"; violation to "Fail to employ … any legally required age-gating"; impersonation and deepfake ban; ban on extracting metadata to infer "content provenance" | https://fal.ai/legal/acceptable-use-policy | 2026-10-18 | high |
| fal `/verify`: media from "fal's hosted applications is signed with Content Credentials (C2PA) … and embedded with an invisible watermark"; limitation "fal-hosted apps only" | https://fal.ai/verify | 2026-10-18 | high |
| H3 Max Turbo, H3 Max and H3 partner example MP4s carry C2PA signed by "fal - Features & Labels Inc." (claim generator `fal-ai/minimax-h3-turbo` or `fal-ai/minimax`; `trainedAlgorithmicMedia`; `ai.fal.info` with endpoint and request_id) | example outputs linked from the three model pages (e.g. https://v3b.fal.media/files/b/0aa8e7f1/h6xLvyfV4xLB1a4m3ssje_minimax-h3.mp4) | 2026-10-18 | high (byte inspection) |
| Gemini Omni Flash example carries Google C2PA: "Created by Google Generative AI.", "Added imperceptible SynthID watermark" | https://v3b.fal.media/files/b/0aa7d096/mt8aUj_yUrazqLoPrkVK1_824d0e2970f641299ef635842bb30051.mp4 | 2026-10-18 | high |
| Kling O3, Seedance 2.5 US, Wan 3.0 and LTX-2.5 example outputs: no C2PA box; no visible watermark in the last frame (640 px check) | example outputs on each fal model page | 2026-10-18 | medium (one sample each; may predate signing) |
| Output format: MP4, H.264 + AAC; H3 768P = 1344×768 at 24 fps, 8.1–12.8 Mbps; Gemini 1280×720 at 24 fps; LTX 1920×1080 at 25 fps | ffprobe of the example outputs above | 2026-10-18 | high |
| H3 Community License (2026-08-02; file unchanged since prior check, sha256 59b99642…): Excluded Territories = EU, UK, Korea, USA; Hosted Services; Model Derivatives; §III last sentence (integrated end-user product: §V and Exhibit A still apply); §IV.1 $20M; §IV.2 "MiniMax H3" UI display; §V.2 bind users; §V.4 Outputs outside territory; §V.5 safeguards; §VI.4 no rights over Outputs; AUP items 1, 12, 13 | https://huggingface.co/MiniMaxAI/MiniMax-H3/raw/main/LICENSE | 2026-10-18 | high |
| MiniMax licence Q&A: "API: Globally available with built-in safeguards"; "Keep MiniMax-H3 API available globally"; organizations in restricted regions "can apply for a formal license" | https://huggingface.co/MiniMaxAI/MiniMax-H3/raw/main/docs/QA-about-License.md | 2026-10-18 | high (MiniMax doc, not contractual) |
| MiniMax org member on HF #12: US persons "may submit formal licensing requests"; an end-credit disclosure is sufficient; "If you sign https://platform.minimax.io/h3-license, it's ok for you to provider globally" | https://huggingface.co/MiniMaxAI/MiniMax-H3/discussions/12 | 2026-10-18 | medium (forum statements) |
| H3 licence request form (excluded territories): comply with the licence "except to the extent any territorial restriction would otherwise preclude our use"; safeguards; bind users; confidentiality; indemnity; asks whether revenue exceeds $20M | https://platform.minimax.io/h3-license (bundle `h3-license-eec3f34ef7b8624a.js`) | 2026-10-18 | high |
| MiniMax Open Platform ToS (effective 2026-03-30; Nanonoble Pte. Ltd.): US service region (ITAR/HIPAA carve-outs); "you retain your ownership rights in Client input and generated content"; IP defence §4; deep-synthesis mark duty; "violent, murderous" content banned; Singapore law and SIAC | https://platform.minimax.io/protocol/terms-of-service | 2026-10-18 | high |
| Comfy: "only official reseller of MiniMax commercial-use licenses" for local use; Professional from $5,000/month; excludes "API aggregator, inference-as-a-service"; "MiniMax requires pricing parity across its Commercial License resellers"; US/EU/UK/KR need a licence via platform.minimax.io/h3-license | https://comfy.org/minimax/license | 2026-10-18 | high (Comfy page) |
| Gemini API Additional Terms (last updated 2026-04-28): 18+; no use in services "likely to be accessed by individuals under the age of 18"; "Google won't claim ownership" | https://ai.google.dev/gemini-api/terms | 2026-10-18 | high |
| Google Cloud SST (last modified 2026-10-12) §20(a) no ownership claim; §20(d) same under-18 restriction; §20(i) output indemnity; indemnity excludes third-party services used to access AI/ML services | https://cloud.google.com/terms/service-terms | 2026-10-18 | high |
| Google Generative AI Prohibited Use Policy (2024-12-17): impersonation "without explicit disclosure, in order to deceive"; misrepresenting provenance | https://policies.google.com/terms/generative-ai/use-policy | 2026-10-18 | high |
| LTX-2.x Community License (2026-08-11): ≥$10M revenue needs a paid licence; "Licensor claims no rights in the Output"; must not remove provenance or watermarks applied to Outputs; cites the EU AI Act and Cal. B&P §22757; no deepfakes without consent | https://raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE-2_x | 2026-10-18 | high |
| `Lightricks/LTX-2.5` weights on HF (2026-07-23), licence `ltx-2.x-community-license-agreement` | https://huggingface.co/api/models/Lightricks/LTX-2.5 | 2026-10-18 | high |
| No Wan 3.0 weights in the HF `Wan-AI` org (latest: Wan2.2-Animate-2, Wan-Dancer) | https://huggingface.co/api/models?author=Wan-AI&sort=createdAt | 2026-10-18 | high |
| BytePlus video-model specific terms page exists, "Last updated: September 8, 2026"; body is JS-only | https://docs.byteplus.com/en/docs/ModelArk/Specific_Terms_for_the_BytePlus_Video_Generation_Model_Services | 2026-10-18 | high (existence only) |
| Kling "Terms of API Paid Service" route `guides/protocols/paid-service` exists (doc bundle); body is JS-only | https://kling.ai/document-api/guides/protocols/paid-service | 2026-10-18 | high (existence only) |

## Unverified

- UNVERIFIED: whether fal holds a MiniMax authorization, and its scope (fal customers, US outputs). The circumstantial evidence: US-based fal openly serves an H3 derivative; "Day 0 ecosystem partner"; MiniMax's US licence channel exists.
- UNVERIFIED: whether `minimax/h3/*` on fal is governed by the MiniMax Open Platform ToS, the H3 Community License or a private fal–MiniMax agreement, and who runs inference (`serverless` + `partner` anomaly).
- UNVERIFIED: whether the H3 licence (Hosted Services and Output definitions) reaches MiniMax API outputs despite MiniMax's Q&A. Counsel issue.
- UNVERIFIED: which Google channel fal uses for Gemini Omni Flash, and whether Google's under-18 clause binds fal customers.
- UNVERIFIED: Kling API terms (ownership, commercial use, likeness, labelling); only secondary sources with inconsistent section numbers.
- UNVERIFIED: BytePlus/Seedance terms: ownership, US availability, the real-face reference ban (secondary), and watermark/C2PA (secondary; absent in the fal sample).
- UNVERIFIED: Alibaba Model Studio terms for Wan 3.0; the watermark default (false) comes from a secondary reading of the API reference.
- UNVERIFIED: LTX API Terms of Use (Help Center summary via search only; the page returned 403).
- UNVERIFIED: whether current fal API outputs of partner endpoints are C2PA-signed (the samples may predate signing), and whether fal's invisible watermark is present on H3 outputs (the detector is not public).
- UNVERIFIED: openPR press release "fal Launches MiniMax H3 as an Official API Partner" (search only; 403).
- UNVERIFIED: SB 942 / AB 853 details: the coverage threshold change (reported SB 1000 / June 2026 bill version) and the 2027 platform dates. Secondary sources only; leginfo was not read.
- UNVERIFIED: that an internal production pipeline qualifies as fal §4(a) "internal business use" and takes the game out of "Customer Solution" status. Counsel interpretation.

## Recommendations for the spec

1. **Adopt ADR-GENAI-01 as written in §8** and add `config/genai/video-providers.json` with the five entries and states in its Log. Point R-CUT-01's wording at the ADR: "MiniMax H3 family via fal when cleared; otherwise the ADR's cleared fallback".
2. **Default provider = `h3.partner`** (`minimax/h3/image-to-video` for Recipe K, `minimax/h3/reference-to-video` for Recipe R). Keep H3 Max/Turbo `blocked` until Q-F1, Q-F2 and Q-M2 are answered in writing. Then promote Turbo and record the evidence in the ADR log.
3. **Fallback order:** `ltx25.fast`, then `gemini.omniFlash11`. The second applies only if counsel clears Google's under-18 clause for the internal-pipeline mode or the product is 18+. Remove Gemini as the unconditional `video.fallback` in genai-pipeline-fal §4.2.
4. **Make generation internal-only in v1.** Generation runs through an admin Workflow or the repo CLI with a staff fal key. The public Worker exposes no route that can trigger fal. A cache miss plays the DirectorScript and logs `cutscene_miss`. Prewarm all keys before each release; CI fails if any `CutsceneRef` in the release has no cleared R2 asset or fallback.
5. **Portable shot contract.** Use 6–10 s shots, start keyframe required, end keyframe optional, refs optional. The adapter's `plan()` splits or merges to provider caps deterministically and records the mapping in the manifest.
6. **Provenance pipeline.**
   - Keep `master.mp4` (provider-signed; immutable; R2 object lock or versioning).
   - Re-sign every rendition with our C2PA claim (ingredient = master; `trainedAlgorithmicMedia`).
   - Add a `check:c2pa` CI job that fails a release if any shipped cutscene lacks a manifest.
   - Never strip provenance from LTX outputs (licence §6).
7. **Attribution UI (S10).**
   - Credits and Settings › About: "Cutscenes generated with MiniMax H3 [Max/Turbo] via fal" for H3-family providers, with the literal string "MiniMax H3".
   - Per-cutscene "AI-generated" badge (corner, 2 s at start, also in the pause menu).
   - ToS and Help: an AI-content disclosure.
   - Drive the text from `licence.duties.uiCredit` so a provider swap updates it.
8. **Manifest fields** (extends C09 / genai-pipeline-fal §2.2): `provider.key`, `licence.status@generation`, `licence.evidence[].termsSnapshotSha256`, `c2pa.master: true|false`, `c2pa.rendition: true`, `attributionText`. Licence status is *not* in the cache key.
9. **Terms watch.** Add a weekly scheduled job (`tools/legal/terms-watch.ts`). It fetches and normalizes these texts, compares sha256 with `docs/legal/terms-snapshots/`, and opens an issue on change:
   - fal ToS, API Services Terms, AUP and `/verify`;
   - H3 LICENSE and QA doc;
   - MiniMax Open Platform ToS (via `__NEXT_DATA__`);
   - Gemini API terms and Google Cloud SST;
   - LTX LICENSE-2_x.
   A change to a `cleared` provider's terms flips it to `pending` until reviewed.
10. **NPC builder (R-NPC-03) video/image generation** stays out of v1 video. When built: sign-in, an 18+ age gate with "legally required" verification per fal AUP, ToS flow-down (fal AUP, H3 AUP items 12–13 if H3, Google PUP if Gemini), and a separate Worker service. That way counsel can, if needed, scope "Customer Solution" to the builder only.
11. **Content rules for prompts** (S03 linter, extends legal-ip-likeness §2.4 `ip:strings`):
    - no gore, no firearms (matches gamedesign §2.12), no real names, no photos of real people;
    - stylized action only, until Q-M6 is answered;
    - block `minimax/h3-max/recast` and any face-swap endpoints (already in genai-pipeline-fal).
12. **Send Q-F1..Q-F9 and Q-M1..Q-M8 (§9) before M05b starts.** Store replies in `docs/legal/confirmations/`. Give counsel the matrix (§1) and this report's quotes.
13. **M00 spike addition (≤ $10):**
    - Generate one 5 s clip on each of `minimax/h3/image-to-video`, `minimax/h3-max-turbo/image-to-video`, `lightricks/ltx-2.5/image-to-video/fast` and `google/gemini-omni-flash/v1.1/reference-to-video` with our own key.
    - Record whether *our* outputs carry C2PA (`c2patool <file>`), the signer, the visible marks and the codec.
    - Store the results in `research/`.

## Risks

- **H3 never clears for US use (medium likelihood, high impact on R-CUT-01).** Mitigation: the `h3.partner` default and fallbacks via config; cached keys include the endpoint; DirectorScript fallback; amend R-CUT-01 if needed.
- **Licence revoked or changed after clips ship (low–medium, high).** The H3 licence §VI.3 terminates on IP suits. Termination requires ceasing distribution and notifying downstream recipients. fal or MiniMax terms may change without notice (MiniMax ToS: adjustments "effective immediately upon publication"). Mitigation: per-clip licence record; delist-by-provider switch; regenerate on a fallback; terms watch; ask for change-notice clauses (Q-F8).
- **Age-clause exposure (medium, high).** A literal reading of fal §2 and Google's under-18 clause conflicts with a 17+ audience. Mitigation: internal-pipeline-only generation; no Gemini by default; 18+ gate for any user-triggered generation; counsel decision recorded in the ADR.
- **Content-rule conflict (medium, medium).** MiniMax's API ToS bans "violent, murderous" content in a crime-parody game. Mitigation: stylized, non-graphic action; prompt linter; Q-M6.
- **Provenance loss (high likelihood if unaddressed, medium impact).** Transcoding strips C2PA, which can breach the LTX licence §6 and weakens MiniMax/SB 942 compliance. Mitigation: master retention plus re-signing; CI check.
- **Reliance on marketing statements (medium, medium).** fal's "commercial use: yes" FAQ is not a licence grant, and the ToS disclaims warranties. Mitigation: only written confirmations count as `cleared`.
- **Partner-path opacity (medium, medium).** `minimax/h3/*` is labelled partner but hosted `serverless`. Mitigation: Q-F4; keep it `pending` until answered.
- **Unreadable vendor terms (high, low–medium).** Kling, BytePlus and Alibaba terms are not verified. Mitigation: keep them out of the ranked list until terms arrive in writing.
- **Revenue thresholds (low now, medium later).** H3 needs written authorization above $20M revenue; LTX needs a paid licence at ≥$10M. Mitigation: record thresholds in the provider entry; finance alert.
- **Indemnity gap (medium, medium).** fal makes us indemnify it (§15). Google's indemnity does not reach fal-mediated use. MiniMax's IP defence reach to partner customers is unknown. Mitigation: Q-F8, Q-M8; an enterprise addendum; E&O insurance (counsel).

## Open questions

1. Will fal confirm in writing that it holds a MiniMax authorization covering US customers' commercial use of H3 Max/Turbo outputs (Q-F1, Q-F2)? This blocks promoting Turbo.
2. Which terms govern `minimax/h3/*` on fal, and who runs inference (Q-F4, Q-M1)? This blocks the default's `cleared` state.
3. Does counsel accept the internal-pipeline reading: players of a game that never calls fal are not fal "End Users", and not users of a Google service "as part of" the game (Q-F5)? This decides the 17+ versus 18+ product rating and whether Gemini is usable.
4. Is the product rating 17+ or 18+? An 18+ product removes the Google and fal age conflicts but changes legal-ip-likeness §5.3/§8 and the audience.
5. What attribution placement will MiniMax and fal accept for a game (Q-F3, Q-M4)? Does MiniMax's deep-synthesis "prominent mark" require burnt-in pixels (Q-M5)?
6. Does MiniMax's "violent, murderous content" ban permit stylized action cutscenes (Q-M6)? Does it apply through fal?
7. Are fal API outputs (not only the playground examples) C2PA-signed for every endpoint we use (Q-F7, spike rec 13)?
8. Should the team instead apply directly for a MiniMax US licence (`platform.minimax.io/h3-license`) to remove dependence on fal's arrangement (Q-M3)? What indemnity does the form's "Indemnity Confirmation" impose?
9. Will Kling, ByteDance/BytePlus and Alibaba provide readable or signed terms if a fourth fallback is needed?
10. If no H3 path clears before M05c content lock, does the owner accept amending R-CUT-01 to "a licence-cleared video model via fal (MiniMax preferred)" with LTX-2.5 as production default?
