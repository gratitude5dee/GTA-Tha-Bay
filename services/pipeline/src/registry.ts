import type { GenAiRegistry } from '@dv/shared';
import raw from '../../../config/genai-endpoints.json';

/** config/genai-endpoints.json, typed. `check:assets` validates the file; the gate reads provider status from here. */
export const GENAI_REGISTRY = raw as unknown as GenAiRegistry;
