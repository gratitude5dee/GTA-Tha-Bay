// Barrel for code that is safe in production builds. The QA probe and the renderer host are imported by
// their own subpaths (dynamic import behind VITE_DV_QA) so three and IWER stay out of production bundles.
export * from './qa-flags.ts';
export * from './diagnostics.ts';
