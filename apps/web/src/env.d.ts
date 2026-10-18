/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' in dev, test and preview builds; anything else (or unset) in production. Gates QA flags and the bridge. */
  readonly VITE_DV_QA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
