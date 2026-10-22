import type { InkKnot } from '@dv/shared/contracts/c10-npc';
import { knotChain } from '@dv/shared/npc';

/**
 * InkRunner: plays the compiled ink of one NPC (`data/ink.<id>`, built by `pnpm npc:build`; the compiler stays in tools). It is the
 * offline and fallback voice of every named NPC (04-npc.md section 5.5): the dialogue client hands over to it on a `fallback` event, a
 * network failure, one of the four offline ApiError codes, or the setting "AI dialogue: off". Missions only ever use ink (`playKnot`).
 *
 * The inkjs runtime is imported when the first story is made, so a session that never talks to anyone does not load it, and each
 * NPC's JSON is loaded on its first line (under 50 KB each). A knot the story does not define falls back along `knotChain`.
 */
export interface InkLine {
  text: string;
  tags: string[];
}

interface InkStory {
  ResetState(): void;
  ChoosePathString(path: string): void;
  readonly canContinue: boolean;
  Continue(): string | null;
  readonly currentTags: string[] | null;
  readonly mainContentContainer: { namedContent: Map<string, unknown> };
}
type StoryCtor = new (json: string) => InkStory;

let storyCtor: Promise<StoryCtor> | null = null;
const loadStoryCtor = (): Promise<StoryCtor> => (storyCtor ??= import('inkjs').then((m) => m.Story as unknown as StoryCtor));

/** Hard stop for a knot that never ends (a loop in an authored story): a line limit, not a time limit. */
const MAX_LINES = 40;

export class InkRunner {
  private readonly story: InkStory;
  private readonly knots: ReadonlySet<string>;

  private constructor(story: InkStory) {
    this.story = story;
    this.knots = new Set(story.mainContentContainer.namedContent.keys());
  }

  /** Builds a runner from the compiled JSON (text or an already parsed object). */
  static async create(compiled: string | object): Promise<InkRunner> {
    const Story = await loadStoryCtor();
    return new InkRunner(new Story(typeof compiled === 'string' ? compiled.replace(/^﻿/, '') : JSON.stringify(compiled)));
  }

  /** True when the story defines the knot. */
  has(knot: InkKnot): boolean {
    return this.knots.has(knot);
  }

  /** The knot that will actually play for `knot`: itself, else smalltalk, greeting, busy; null when the story has none of them. */
  resolve(knot: InkKnot): InkKnot | null {
    return knotChain(knot).find((k) => this.has(k)) ?? null;
  }

  /** The lines of a knot, from its start to its end (a choice point ends it; ink choices are not offered). Empty when nothing resolves. */
  play(knot: InkKnot): InkLine[] {
    const target = this.resolve(knot);
    if (target === null) return [];
    this.story.ResetState();
    this.story.ChoosePathString(target);
    const lines: InkLine[] = [];
    while (this.story.canContinue && lines.length < MAX_LINES) {
      const text = (this.story.Continue() ?? '').trim();
      if (text !== '') lines.push({ text, tags: [...(this.story.currentTags ?? [])] });
    }
    return lines;
  }
}
