// Type-only shim (DL-232): @dv/shared has no DOM lib, but C09 PreparedClip names HTMLVideoElement.
// The interface merges with the DOM declaration where lib.dom is present; the shape is unchanged.
export {};
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- merges with lib.dom where present
  interface HTMLVideoElement {}
}
