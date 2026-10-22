// AC-2: the DataPort contract suite against the Supabase implementation on the local stack. Run by `pnpm check:db`
// (vitest.db.config.ts), not by `check:workers`: it needs a database. DV_DB_API_URL and DV_DB_SECRET_KEY come from `supabase status`
// (or from the PostgREST that check:db starts in --pg-url mode); without them the file reports itself skipped.
import { describe, it } from 'vitest';
import { runDataPortContract } from '../../../../packages/shared/test/data-port/contract.ts';
import { supabaseDataPort } from '../../src/data/supabase/index.ts';

const url = process.env['DV_DB_API_URL'];
const secretKey = process.env['DV_DB_SECRET_KEY'];

if (url === undefined || url === '' || secretKey === undefined || secretKey === '') {
  describe.skip('DataPort contract: Supabase', () => {
    it('needs DV_DB_API_URL and DV_DB_SECRET_KEY (run pnpm check:db)', () => {});
  });
} else {
  runDataPortContract('Supabase (local stack)', () =>
    Promise.resolve({ port: supabaseDataPort({ url, secretKey, env: 'local-test' }), env: 'local-test' }),
  );
}
