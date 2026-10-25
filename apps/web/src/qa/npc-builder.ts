/**
 * QA builds only (M06b1): `window.__dvBridge.npc.buildTestNpc()` and two buttons in the "Talk to npc_test (QA)" box of the default scene. The builder screens are
 * M06b3's; until then this drives the API of route 33 from the page, with the page's own play token: create a draft, write a backstory, validate it, have the
 * soul written (the Worker probes it), wait for `private`, then make the runtime talk to it through the real dialogue panel.
 *
 * See it: open the QA build (`VITE_DV_QA=1`, a DV_WORLD=synth build is fine) at `/?play=off&tier=mobile-low`, pass the age screen, press "Make my NPC (builder)",
 * wait for the status line to say `private`, then press "Talk to my NPC". On the staging Worker and in Previews the Worker is in fixture mode, so the NPC is
 * a plain recorded character and every answer is labelled "recorded fixture, not a live model".
 */
import type { NpcBridge } from '@dv/npc/debug';

export interface BuiltNpc {
  npcId: string;
  state: string;
  soulVersion: number | null;
  failures: string[];
}

interface View {
  id: string;
  npcId: string;
  rev: number;
  state: string;
  publish: { soulVersion: number | null };
  probes: { failures: string[] } | null;
  lint: { rule: string; message: string }[];
}

const FIELDS = {
  name: 'Tomasa Quill',
  shortBio: 'Runs a late-night tamale cart in the Mission and knows which block hosts the next pop-up.',
  archetype: 'vendor',
  tags: ['street-food', 'night-owl'],
  district: 'mission',
  voiceRef: null,
  appearancePreset: null,
};
const BACKSTORY =
  'Tomasa started the cart the winter the bakery on her corner closed. Now she knows every regular, every corner that fills up after midnight and which block is hosting the next pop-up, and she feeds anyone who looks tired.';

export interface BuilderQaDeps {
  /** The `Authorization` value of the page (the play token), or null when it has none. */
  auth(): Promise<string | null>;
  /** Tells the runtime which soul version to ask for when talking to a user NPC. */
  register(npcId: string, soulVersion: number): void;
  fetch?: typeof fetch;
}

export function installBuilderQa(bridge: NpcBridge, deps: BuilderQaDeps, status: (line: string) => void): void {
  const f = deps.fetch ?? fetch.bind(globalThis);
  const call = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const auth = await deps.auth();
    return f(`/api/v1/npc-builder${path}`, {
      method,
      headers: { ...(auth === null ? {} : { Authorization: auth }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  const get = async (id: string): Promise<View> => (await (await call('GET', `/drafts/${id}`)).json()) as View;
  const until = async (id: string, done: (v: View) => boolean, label: string, ms: number): Promise<View> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await get(id);
      status(`${label}: ${v.state}`);
      if (done(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 1500));
    }
  };
  let last: BuiltNpc | null = null;

  const build = async (backstory = BACKSTORY): Promise<BuiltNpc> => {
    status('creating a draft');
    const made = await call('POST', '/drafts', { fields: FIELDS, attestation: 'original' });
    if (made.status !== 201) throw new Error(`create answered ${made.status}`);
    let v = (await made.json()) as View;
    const put = await call('PUT', `/drafts/${v.id}`, { rev: v.rev, backstory });
    if (put.status !== 200) throw new Error(`backstory answered ${put.status}`);
    if ((await call('POST', `/drafts/${v.id}/validate`)).status !== 202) throw new Error('validate was refused');
    v = await until(v.id, (x) => x.state !== 'draft' && x.state !== 'validating', 'checking the text', 60_000);
    if (v.state !== 'text_ok') return (last = { npcId: v.npcId, state: v.state, soulVersion: null, failures: v.lint.map((i) => i.message) });
    if ((await call('POST', `/drafts/${v.id}/soul`)).status !== 202) throw new Error('soul generation was refused');
    v = await until(v.id, (x) => ['private', 'soul_failed', 'soul_ready'].includes(x.state), 'writing the character', 150_000);
    if (v.state === 'private' && v.publish.soulVersion !== null) deps.register(v.npcId, v.publish.soulVersion);
    status(`${v.npcId}: ${v.state}`);
    return (last = { npcId: v.npcId, state: v.state, soulVersion: v.publish.soulVersion, failures: v.probes?.failures ?? v.lint.map((i) => i.message) });
  };
  Object.assign(bridge, { buildTestNpc: build, lastBuiltNpc: () => last });

  const box = document.querySelector('[data-testid="npc-overlay"]');
  if (box === null) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px';
  const line = document.createElement('div');
  line.dataset['testid'] = 'npc-builder-status';
  line.style.cssText = 'font-size:11px;margin-top:4px;opacity:.85';
  const mk = (label: string, testid: string, on: () => Promise<void>): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset['testid'] = testid;
    btn.addEventListener('click', () => {
      btn.disabled = true;
      void on()
        .catch((e: unknown) => status(`failed: ${e instanceof Error ? e.message : 'error'}`))
        .finally(() => (btn.disabled = false));
    });
    return btn;
  };
  row.append(
    mk('Make my NPC (builder)', 'npc-builder-make', async () => void (await build())),
    mk('Talk to my NPC', 'npc-builder-talk', async () => {
      if (last === null || last.state !== 'private') throw new Error('make an NPC first');
      await bridge.talk(last.npcId, { intent: 'greet' });
    }),
  );
  box.append(row, line);
}
