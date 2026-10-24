/**
 * The phone's Messages app (M05c2). It replaces the `comingSoon` tile of M04b2 and is read-only: one thread per sender, showing the `text`
 * op lines the session has delivered (`mode.story.messages`, sender name from the cast table, text from `lines.en.json`), and one offer
 * per available mission whose giver is `{phone}` (`mode.story.jobs`). Activating an offer opens Jobs on that mission. The functions here
 * are pure; `PhonePage` holds the open thread and runs the presses.
 */
import { lk, t } from '../i18n/index.ts';
import type { ListRow, ScreenDef, Widget } from '../screen/types.ts';
import type { MissionJob } from './apps.ts';

/** One row of `mode.story.messages`. */
export interface PhoneMessage {
  from: string;
  /** The sender's display name. */
  name: string;
  text: string;
  /** Sim tick the message arrived at. */
  at: number;
}

export interface MessageOffer {
  missionId: string;
  title: string;
}

export interface MessageThread {
  from: string;
  name: string;
  lines: string[];
  offers: MessageOffer[];
  /** Order key: the tick of the latest message, or -1 for a sender who only has an offer. */
  last: number;
}

/** A readable name for a soul id that has no display name: `x_ramos` becomes `X Ramos`. */
export function senderName(id: string): string {
  return id.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The offers of the contacts: an available mission with a `phone` trigger and a giver. */
export function offersOf(jobs: readonly MissionJob[]): (MessageOffer & { from: string; fromName: string })[] {
  const out: (MessageOffer & { from: string; fromName: string })[] = [];
  for (const j of jobs) {
    if (j.state !== 'available' || j.trigger !== 'phone' || !j.giver) continue;
    out.push({ missionId: j.id, title: j.title, from: j.giver, fromName: j.giverName ?? senderName(j.giver) });
  }
  return out;
}

/** Threads per sender, the latest conversation first; a sender with only an offer comes after those with messages. */
export function buildThreads(messages: readonly PhoneMessage[], jobs: readonly MissionJob[]): MessageThread[] {
  const by = new Map<string, MessageThread>();
  const thread = (from: string, name: string): MessageThread => {
    let th = by.get(from);
    if (!th) {
      th = { from, name, lines: [], offers: [], last: -1 };
      by.set(from, th);
    }
    return th;
  };
  for (const m of messages) {
    const th = thread(m.from, m.name || senderName(m.from));
    th.lines.push(m.text);
    th.last = Math.max(th.last, m.at);
  }
  for (const o of offersOf(jobs)) thread(o.from, o.fromName).offers.push({ missionId: o.missionId, title: o.title });
  return [...by.values()].sort((a, b) => (a.last === b.last ? (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) : b.last - a.last));
}

const PREVIEW_CHARS = 60;
const preview = (s: string): string => (s.length > PREVIEW_CHARS ? `${s.slice(0, PREVIEW_CHARS - 1)}…` : s);

/** The thread list as rows: id `thread:<soul id>`, the name, the latest line (or the job offer) and a badge for open offers. */
export function threadRows(threads: readonly MessageThread[]): ListRow[] {
  return threads.map((th) => {
    const latest = th.lines[th.lines.length - 1];
    const row: ListRow = { id: `thread:${th.from}`, text: th.name, detail: latest !== undefined ? preview(latest) : t('phone.messages.offerOnly') };
    return th.offers.length > 0 ? { ...row, badge: t('phone.messages.offerBadge', { n: th.offers.length }) } : row;
  });
}

/** The offers of a thread as rows: id `offer:<mission id>`. */
export function offerRows(th: MessageThread): ListRow[] {
  return th.offers.map((o) => ({ id: `offer:${o.missionId}`, text: o.title, detail: t('phone.messages.offerDetail') }));
}

const back = (call: string, label: string): Widget => ({ k: 'button', id: call === 'phone.message.back' ? 'messages-back' : 'phone-home', label: lk(label), style: 'secondary', onPress: { call } });

/** The Messages screen: the thread list, or one thread when `open` names a sender who has one. */
export function messagesScreen(threads: readonly MessageThread[], open: string | null): ScreenDef {
  const head: Widget = { k: 'heading', text: lk('phone.app.messages'), level: 1 };
  const th = open ? threads.find((x) => x.from === open) : undefined;
  if (!th) {
    return {
      id: 'app-messages',
      title: lk('phone.app.messages'),
      children: [head, { k: 'list', id: 'phone-threads', rows: threadRows(threads), onPress: { call: 'phone.message.open' }, empty: lk('phone.messages.empty') }, back('phone.home', 'phone.home')],
    };
  }
  return {
    id: 'app-messages-thread',
    title: lk('phone.app.messages'),
    children: [
      head,
      { k: 'text', text: lk('phone.messages.threadWith'), params: { name: th.name } },
      ...(th.lines.length > 0 ? [{ k: 'table', columns: [lk('phone.messages.col.message')], rows: th.lines.map((l) => [l]) } as Widget] : []),
      ...(th.offers.length > 0
        ? [
            { k: 'heading', text: lk('phone.messages.offers'), level: 2 } as Widget,
            { k: 'list', id: 'phone-offers', rows: offerRows(th), onPress: { call: 'phone.message.offer' }, empty: lk('phone.messages.noOffers') } as Widget,
          ]
        : []),
      back('phone.message.back', 'phone.messages.back'),
    ],
  };
}

/** What a press on a row means: open a thread, or open Jobs on a mission. */
export function messagePress(rowId: string): { kind: 'thread'; from: string } | { kind: 'offer'; missionId: string } | null {
  if (rowId.startsWith('thread:')) return { kind: 'thread', from: rowId.slice('thread:'.length) };
  if (rowId.startsWith('offer:')) return { kind: 'offer', missionId: rowId.slice('offer:'.length) };
  return null;
}

/** Jobs opened from an offer: the mission's row first, with the offer badge, so the list "opens on" it. */
export function focusJobRows(rows: ListRow[], missionId: string | null | undefined): ListRow[] {
  if (!missionId) return rows;
  const at = rows.findIndex((r) => r.id === `mis:${missionId}`);
  if (at < 0) return rows;
  const focused = { ...(rows[at] as ListRow), badge: t('phone.messages.offerBadgeJobs') };
  return [focused, ...rows.slice(0, at), ...rows.slice(at + 1)];
}
