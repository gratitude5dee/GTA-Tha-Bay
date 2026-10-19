// Route 66 response (GET /api/v1/legal/:doc, M00e). A module type of the legal pages, not a C12 shape (DL-241 rule).

export interface LegalSection {
  id: string;
  heading: string;
  /** Plain text paragraphs. `{brand}` is replaced by the client; `{contact}` by the Worker from LEGAL_CONTACT. */
  paragraphs: string[];
}

export interface LegalDocRes {
  doc: 'terms' | 'privacy';
  /** Equals TERMS_VERSION (config/terms.ts). */
  version: string;
  /** Epoch ms of the last edit. */
  updated: number;
  /** False until counsel has reviewed the text (Q-23). */
  counselReviewed: boolean;
  sections: LegalSection[];
}
