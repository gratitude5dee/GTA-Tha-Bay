import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * The Basis Universal transcoder for the surface textures (M10d0): `basis_transcoder.js` and `basis_transcoder.wasm` of the pinned `three`
 * package (examples/jsm/libs/basis, Apache-2.0), served at `/basis/` and copied byte for byte into `dist/basis/`. `KTX2Loader` reads them
 * from there (`TRANSCODER_PATH` of packages/world/src/client/textures/ktx2.ts), so they stay same-origin under the isolation headers
 * (COEP and CORP) and no CDN is involved. The wasm is a ship file: `assets/provenance` holds its record (its hash is that of the `three`
 * release in the lockfile), and the credits page carries the attribution through that record.
 */
const FILES = ['basis_transcoder.js', 'basis_transcoder.wasm'] as const;
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm' };

export function basisTranscoder(repoRoot: string): Plugin {
  // The pinned three of the world package.
  const req = createRequire(path.join(repoRoot, 'packages', 'world', 'package.json'));
  const dir = path.dirname(req.resolve('three/examples/jsm/libs/basis/basis_transcoder.js'));
  return {
    name: 'dv-basis-transcoder',
    configureServer(server) {
      server.middlewares.use('/basis', (reqIn, res, next) => {
        const name = decodeURIComponent((reqIn.url ?? '/').split('?')[0] ?? '/').replace(/^\//, '');
        if (!(FILES as readonly string[]).includes(name)) {
          next();
          return;
        }
        res.setHeader('Content-Type', TYPES[path.extname(name)] ?? 'application/octet-stream');
        res.end(readFileSync(path.join(dir, name)));
      });
    },
    generateBundle() {
      for (const name of FILES) this.emitFile({ type: 'asset', fileName: `basis/${name}`, source: readFileSync(path.join(dir, name)) });
    },
  };
}
