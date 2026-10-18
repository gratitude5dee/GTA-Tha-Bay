/**
 * The single source of the product name (R-IP-01, R-NAME-1).
 * Every user-visible occurrence of the name comes from here; catalogs carry the `{brand}` placeholder.
 * The disclaimer sentence is fixed by R-NAME-2 (research/legal-ip-likeness.md); the IP string gate
 * exempts exactly this sentence.
 */
export const BRAND = {
  codename: 'tha-bay',
  displayName: 'Dee-Verse: Tha Bay',
  shortName: 'Tha Bay',
  // Operating entity is not decided (counsel list, Q-23); Builder decision BD-M00-02.
  legalName: 'Dee-Verse (operating entity pending counsel review)',
  tagline: 'An original story set in a Bay Area that feels like home.',
  disclaimer: 'Not affiliated with, endorsed by, or sponsored by Rockstar Games or Take-Two Interactive.',
} as const;

export const DISPLAY_NAME: string = BRAND.displayName;
export const SHORT_NAME: string = BRAND.shortName;
