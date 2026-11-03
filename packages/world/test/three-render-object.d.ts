/**
 * Types for the one internal module of three 0.186.1 the pedestrian tests read (BD-REPAIR-M10d4-04): `RenderObject`, whose material cache
 * key decides whether two meshes share a render program (WebGL2) or pipeline (WebGPU). `@types/three` ships no declaration for it.
 */
declare module 'three/src/renderers/common/RenderObject.js' {
  const RenderObject: {
    prototype: {
      getMaterialCacheKey(this: unknown): number;
      getGeometryCacheKey(this: unknown): string;
    };
  };
  export default RenderObject;
}
