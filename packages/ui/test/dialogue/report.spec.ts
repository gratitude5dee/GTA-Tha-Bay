/**
 * M06a5 AC-5: the report control. It renders only when `dialogueCapabilities.reports` is true (M06b2 turns it on with route 41), and it
 * files a C12 `ReportReq` for the line on screen through an injected client. The id keeps NPC turns apart from room chat (DL-543).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DialogueBubble, showsReport } from '../../src/dialogue/DialogueBubble.tsx';
import {
  DIALOGUE_REPORT_CATEGORIES, chatTurnId, dialogueCapabilities, reportRequest, setDialogueCapabilities, type ReportReq,
} from '../../src/dialogue/capabilities.ts';
import { ReportButton } from '../../src/kit/report.tsx';
import { FakeRuntime, byTestId, collect, happyTurn, inkTurn, makeSession } from './helpers.ts';

const OPAQUE = [ReportButton];
const actions = { choose() {}, send() {}, showFull() {}, close() {}, dismissLikeness() {}, toggleResources() {}, report() {} };

afterEach(() => setDialogueCapabilities({ reports: false }));

async function turnTwo(client: { report(req: ReportReq): Promise<void> } | null) {
  const made = makeSession({ reports: client }, new FakeRuntime((_t, n) => happyTurn(`Line ${n}.`, { turnIndex: n - 1 })));
  made.session.open('npc_test');
  await made.session.choose('greet');
  await made.session.choose('smalltalk');
  return made;
}

describe('report control (AC-5)', () => {
  it('is off by default: no button, whatever the line', async () => {
    expect(dialogueCapabilities.reports).toBe(false);
    const { session } = await turnTwo(null);
    expect(showsReport(session.state())).toBe(false);
    const tree = DialogueBubble({ view: session.state(), actions });
    expect(collect(tree, (v) => v.type === ReportButton, OPAQUE)).toHaveLength(0);
    expect(byTestId(tree, 'dialogue-report', OPAQUE)).toBeUndefined();
  });

  it('with reports on, renders the kit ReportButton for the turn and files ReportReq {chat_turn, enc:<npc>:<enc>:<turn>}', async () => {
    setDialogueCapabilities({ reports: true });
    const sent: ReportReq[] = [];
    const { session } = await turnTwo({ report: async (r) => void sent.push(r) });
    const view = session.state();
    expect(view.turn).toEqual({ npcId: 'npc_test', encounterId: 'E', turnIndex: 1 });
    expect(showsReport(view)).toBe(true);

    const tree = DialogueBubble({ view, actions });
    const [button] = collect(tree, (v) => v.type === ReportButton, OPAQUE);
    expect(button?.props['target']).toBe('enc:npc_test:E:1');
    expect(button?.props['categories']).toEqual(DIALOGUE_REPORT_CATEGORIES);

    // activating Report on turn 2 of encounter E (turnIndex is zero-based; the spec's "turn 2" is index 2)
    const two = await turnTwo({ report: async (r) => void sent.push(r) });
    await two.session.choose('compliment');
    expect(two.session.state().turn?.turnIndex).toBe(2);
    expect(await two.session.report('harassment_hate')).toBe(true);
    expect(sent.at(-1)).toEqual({ target: { kind: 'chat_turn', id: 'enc:npc_test:E:2' }, category: 'harassment_hate' });
    expect(two.session.state().reported).toBe(true);
  });

  it('an ink line has nothing to report, and a failing client reports false without an error state', async () => {
    setDialogueCapabilities({ reports: true });
    const ink = makeSession({ reports: { report: async () => undefined } }, new FakeRuntime(() => inkTurn(['Good day.'])));
    ink.session.open('npc_test');
    await ink.session.choose('greet');
    expect(showsReport(ink.session.state())).toBe(false);
    expect(await ink.session.report('other')).toBe(false);

    const failing = await turnTwo({ report: () => Promise.reject(new Error('offline')) });
    expect(await failing.session.report('other')).toBe(false);
    expect(failing.session.state().reported).toBe(false);
  });

  it('without a client the session files nothing', async () => {
    setDialogueCapabilities({ reports: true });
    const { session } = await turnTwo(null);
    expect(await session.report('other')).toBe(false);
  });

  it('the ids and request shape match the contract', () => {
    expect(chatTurnId('npc_test', 'E', 2)).toBe('enc:npc_test:E:2');
    expect(reportRequest('npc_test', 'E', 2, 'other')).toEqual({ target: { kind: 'chat_turn', id: 'enc:npc_test:E:2' }, category: 'other' });
    expect(DIALOGUE_REPORT_CATEGORIES).toContain('harassment_hate');
  });
});
