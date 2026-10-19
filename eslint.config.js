// ESLint flat config. The C02 determinism rules (config/eslint/determinism.mjs) apply to sim source only; tests,
// scripts and fixtures are outside the scope. no-glsl-in-engine applies to packages/**.
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

import { GLSL_SYNTAX, SIM_FILES, SIM_IGNORES, determinismConfig } from './config/eslint/determinism.mjs';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.wrangler/**',
    'test-results/**',
    'playwright-report/**',
    '.spike/**',
    '.claude/**',
    'spec/**',
    'research/**',
    'prompt-pack/**',
    'docs/**',
    'apps/web/public/**',
  ]),
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...GLSL_SYNTAX] },
  },
  {
    // The HTMLVideoElement shim is an intentionally empty interface that merges with lib.dom (DL-232).
    files: ['packages/shared/src/contracts/dom-media.d.ts'],
    rules: { '@typescript-eslint/no-empty-object-type': 'off' },
  },
  determinismConfig(SIM_FILES, SIM_IGNORES),
]);
