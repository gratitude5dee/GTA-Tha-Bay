/** Types for the part of `gltf-validator` (Khronos, Apache-2.0) that the character gate A3 uses. */
declare module 'gltf-validator' {
  interface ValidatorOptions {
    maxIssues?: number;
    ignoredIssues?: string[];
  }
  const validator: {
    version(): string;
    validateBytes(data: Uint8Array, options?: ValidatorOptions): Promise<unknown>;
    validateString(json: string, options?: ValidatorOptions): Promise<unknown>;
  };
  export default validator;
}
