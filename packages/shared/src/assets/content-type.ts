/** Content type per file extension: spec/domains/05-assets.md section 4.4, plus .png and .pack (M01d). Never a Content-Encoding. */
const TABLE: Readonly<Record<string, string>> = {
  glb: 'model/gltf-binary',
  ktx2: 'image/ktx2',
  opus: 'audio/ogg; codecs=opus',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  json: 'application/json',
  png: 'image/png',
  pack: 'application/octet-stream',
};

export function contentTypeOf(ext: string): string {
  const e = ext.replace(/^\./, '').toLowerCase();
  const t = TABLE[e];
  if (!t) throw new Error(`no content type for extension: ${ext}`);
  return t;
}

/** Extensions uploaded by `assets:publish`, one rclone invocation each, in this order. */
export const CONTENT_CLASSES: readonly string[] = ['json', 'png', 'ktx2', 'glb', 'pack'];
