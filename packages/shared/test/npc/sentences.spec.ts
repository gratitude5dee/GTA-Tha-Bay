import { describe, expect, it } from 'vitest';
import { splitSentences } from '../../src/npc/sentences.ts';

describe('splitSentences', () => {
  it('splits on . ! ? and keeps the terminators', () => {
    expect(splitSentences('You again. What did you break? Nothing!')).toEqual(['You again.', 'What did you break?', 'Nothing!']);
  });

  it('keeps abbreviations, initials and decimals together', () => {
    expect(splitSentences('Dr. Quill met J. Vale at 3.5 percent. Fine.')).toEqual(['Dr. Quill met J. Vale at 3.5 percent.', 'Fine.']);
    expect(splitSentences('Mr. Alder lives on Fourth St. near the cart. He waves.')).toEqual(['Mr. Alder lives on Fourth St. near the cart.', 'He waves.']);
  });

  it('treats an ellipsis as one boundary', () => {
    expect(splitSentences('Well... maybe. Ask me later…  Okay.')).toEqual(['Well... maybe.', 'Ask me later…', 'Okay.']);
  });

  it('keeps closing quotes and brackets with their sentence', () => {
    expect(splitSentences('She said "go." Then left (quietly). Done.')).toEqual(['She said "go."', 'Then left (quietly).', 'Done.']);
  });

  it('returns a sentence without a terminator as the last item', () => {
    expect(splitSentences('First one. And then a trailing thought')).toEqual(['First one.', 'And then a trailing thought']);
  });

  it('handles empty and whitespace-only input and collapses whitespace', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('  \n ')).toEqual([]);
    expect(splitSentences('One.\n\nTwo   words.')).toEqual(['One.', 'Two words.']);
  });

  it('is stable when joined and split again', () => {
    const s = splitSentences('Engine don\'t lie. Park it in the second bay! Ahorita?');
    expect(splitSentences(s.join(' '))).toEqual(s);
  });
});
