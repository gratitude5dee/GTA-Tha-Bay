import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';
import tokens from '../../config/ui/tokens.json' with { type: 'json' };

// `pnpm icons` regenerates public/icons/ from public/icon.svg. The PNGs are committed.
const background = tokens.manifest.backgroundColor;

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    transparent: { ...minimal2023Preset.transparent, favicons: [[48, 'icons/favicon.ico']] },
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background } },
    assetName: (type, size) => {
      const prefix = type === 'transparent' ? 'pwa' : type === 'maskable' ? 'maskable-icon' : 'apple-touch-icon';
      return `icons/${prefix}-${size.width}x${size.height}.png`;
    },
  },
  images: ['public/icon.svg'],
});
