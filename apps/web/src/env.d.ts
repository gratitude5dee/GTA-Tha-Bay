/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' in dev, test and preview builds; anything else (or unset) in production. Gates QA flags and the bridge. */
  readonly VITE_DV_QA?: string;
  /** Build id (the commit short sha, or 'dev'). Tier decisions are re-run when it changes. */
  readonly VITE_DV_BUILD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
