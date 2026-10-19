// Type-only shim (DL-232): @dv/shared has no DOM lib, but C09 PreparedClip names HTMLVideoElement.
// The interface merges with the DOM declaration where lib.dom is present; the shape is unchanged.
// Programs without the DOM lib (services/edge, services/pipeline) list this file in their tsconfig `include`.
export {};
declare global {
  interface HTMLVideoElement {}
}
