// Barrel for code that is safe in production builds. The QA probe and the perf tooling are imported by their own subpaths
// (dynamic import behind VITE_DV_QA) so the IWER emulator, the PerfHud and the bridge stay out of production bundles.
// `createPlatform` loads the renderer host (and with it three) through a dynamic import, so importing this barrel is cheap.
export * from './qa-flags.ts';
export * from './diagnostics.ts';
export { createPlatform } from './create-platform.ts';
export type { CreatePlatformOptions, Platform } from './create-platform.ts';
