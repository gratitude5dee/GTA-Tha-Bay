/**
 * The one rule for "is there room" (11-platform-pwa.md section 5): free quota must cover 1.2 x the missing bytes. A separate module so
 * the page's boot prefetch (M02f2) can use the same factor without pulling the pack store into its chunk.
 */
export const DOWNLOAD_ALL_QUOTA_FACTOR = 1.2;

/** No estimate counts as room. */
export function quotaFits(freeBytes: number | null, missingBytes: number): boolean {
  return freeBytes === null || freeBytes >= DOWNLOAD_ALL_QUOTA_FACTOR * missingBytes;
}
