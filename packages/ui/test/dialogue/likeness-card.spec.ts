/**
 * M06a5 AC-4: the likeness card. A non-original NPC the save profile has not met shows its fixed text once, before the first line; an
 * original NPC shows none; a second conversation shows none. The UI never writes C05: it tells the talk path through `markMet`.
 */
import { describe, expect, it } from 'vitest';
import { DialogueBubble } from '../../src/dialogue/DialogueBubble.tsx';
import { LikenessCard, likenessText } from '../../src/dialogue/LikenessCard.tsx';
import { ReportButton } from '../../src/kit/report.tsx';
import { FakeRuntime, byTestId, ctxOf, happyTurn, makeSession, textOf } from './helpers.ts';

const OPAQUE = [ReportButton];
const actions = { choose() {}, send() {}, showFull() {}, close() {}, dismissLikeness() {}, toggleResources() {}, report() {} };

describe('likeness card (AC-4)', () => {
  const cases = [
    ['parody_pal', 'parody', 'Parody. Not affiliated with or endorsed by any real person.'],
    ['fiction_pal', 'fictional', 'Fictional character.'],
    ['courtesy_pal', 'courtesy', 'Appears courtesy of Courtesy Pal.'],
  ] as const;

  for (const [npc, kind, text] of cases) {
    it(`${kind}: the fixed text shows once before the first line`, async () => {
      const met: string[] = [];
      const { session, runtime } = makeSession({ markMet: (id) => met.push(id) }, new FakeRuntime(() => happyTurn('Hey there.')));
      session.open(npc);
      const card = session.state().card;
      expect(card).toMatchObject({ kind: 'likeness', disclaimer: kind });
      expect(likenessText(kind, session.state().speaker)).toBe(text);

      // the bubble shows the card, not a line, and a turn asked for now waits behind it
      const tree = DialogueBubble({ view: session.state(), actions, reportsOn: false });
      expect(byTestId(tree, 'dialogue-likeness', OPAQUE)).toBeDefined();
      expect(byTestId(tree, 'dialogue-line', OPAQUE)).toBeUndefined();
      const waiting = session.choose('greet');
      expect(runtime.calls).toHaveLength(0);
      expect(met).toEqual([]);

      session.dismissCard();
      await waiting;
      expect(runtime.calls).toHaveLength(1);
      expect(met).toEqual([npc]);
      expect(session.state().card).toBeNull();
      expect(session.state().full).toBe('Hey there.');

      // a second conversation with the same NPC shows no card
      session.close();
      session.open(npc);
      expect(session.state().card).toBeNull();
      expect(met).toEqual([npc]);
    });
  }

  it('disclaimer none: no card, and the turn starts at once', async () => {
    const { session, runtime } = makeSession();
    session.open('npc_test', { intent: 'greet' });
    expect(session.state().card).toBeNull();
    expect(runtime.calls).toHaveLength(1);
  });

  it('an NPC the profile has already met (C05 npcRelations[id].met) shows no card', () => {
    const { session } = makeSession({ context: () => ctxOf({ relation: { trust: 10, met: true } }) });
    session.open('parody_pal');
    expect(session.state().card).toBeNull();
  });

  it('the card component renders its text and one Continue button', () => {
    const tree = LikenessCard({ disclaimer: 'fictional', name: 'Fiction Pal', onContinue() {} });
    expect(textOf(tree)).toContain('Fictional character.');
    expect(byTestId(tree, 'dialogue-likeness-continue')).toBeDefined();
  });

  it('a conversation closed while the card is up releases a turn that was waiting', async () => {
    const { session, runtime } = makeSession();
    session.open('parody_pal');
    const waiting = session.choose('greet');
    session.close();
    await expect(waiting).resolves.toBeNull();
    expect(runtime.calls).toHaveLength(0);
  });
});
