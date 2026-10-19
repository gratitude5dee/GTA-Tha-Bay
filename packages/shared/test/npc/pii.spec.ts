import { describe, expect, it } from 'vitest';
import { findContactInfo, scrubPii } from '../../src/npc/pii.ts';

describe('scrubPii (AC-5)', () => {
  it('removes e-mail addresses', () => {
    const r = scrubPii('Write me at jane.doe+game@example.org or Jane_D@mail.example.co.uk, thanks.');
    expect(r.text).toBe('Write me at [removed] or [removed], thanks.');
    expect(r.removed).toBe(2);
  });

  it.each([
    '415-555-0134',
    '(415) 555-0134',
    '415.555.0134',
    '4155550134',
    '+1 415 555 0134',
    '1-415-555-0134',
  ])('removes the phone number %s', (phone) => {
    const r = scrubPii(`Call ${phone} tonight`);
    expect(r.text).toBe('Call [removed] tonight');
    expect(r.removed).toBe(1);
  });

  it.each([
    '1234 Mission Street',
    '88 Valencia St.',
    '2200 Van Ness Avenue, Apt 4B',
    '17 Dolores Alley',
    '400 Pine Blvd #12',
  ])('removes the street address %s', (addr) => {
    const r = scrubPii(`I live at ${addr} if you want to come by`);
    expect(r.text).toBe('I live at [removed] if you want to come by');
    expect(r.removed).toBe(1);
  });

  it('leaves game text alone', () => {
    const text = 'Race at midnight on 24th Street, bring 3 friends and 2500 dollars of parts. Lap 4 of 10, speed 120.5.';
    expect(scrubPii(text)).toEqual({ text, removed: 0 });
  });

  it('counts every removal in a mixed message', () => {
    const r = scrubPii('Email a@b.io, phone 415-555-0100, home 12 Bay Street.');
    expect(r.removed).toBe(3);
    expect(r.text).not.toMatch(/@|555|Bay Street/);
  });

  it('is deterministic and idempotent', () => {
    const once = scrubPii('mail me at x@y.zz');
    expect(scrubPii(once.text)).toEqual({ text: once.text, removed: 0 });
  });
});

describe('findContactInfo (lint L6)', () => {
  it('finds URLs, e-mail addresses and phone numbers', () => {
    const hits = findContactInfo('See https://example.com/a and www.example.org, mail a@b.io, phone 415-555-0100.');
    expect(hits.map((h) => h.kind).sort()).toEqual(['email', 'phone', 'url', 'url']);
  });
  it('ignores hashes, versions and times', () => {
    expect(findContactInfo('sha 0000000000000000000000000000000000000000000000000000000000000000 v1.0.0 at 21:00-24:00 height 1.63')).toEqual([]);
  });
});
