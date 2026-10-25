import type { Archetype, DraftFields } from '@dv/shared/npc';
import { stripUserMarkup } from '@dv/shared/npc';
import { BUILDER, districts, voiceAllowed } from './data.ts';

/** Validation of the author's fields (04-npc-builder.md section C1 screen 1: name 2-40, pitch up to 280, archetype, district, tags). */
const ARCHETYPES: readonly Archetype[] = ['rapper', 'founder', 'vc', 'influencer', 'athlete', 'civilian', 'police', 'vendor', 'official', 'other'];
const TAG = /^[a-z0-9-]{2,32}$/;
const PRESET = /^[a-z0-9][a-z0-9._-]{0,39}$/;
// Controls, zero-width and bidi formatting, and angle brackets never belong in a name or pitch.
const STRIP = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿<>]/gu;

/** A single-line text as stored: NFC, controls and brackets out, runs of blanks collapsed, markup that could close the sheet removed. */
export const cleanLine = (s: string): string => stripUserMarkup(s.normalize('NFC').replace(STRIP, ' ').replace(/\s+/g, ' ').trim());

/** Backstory text as stored: NFC, controls other than line breaks out, tab folded to a space, CRLF folded. */
export function cleanBackstory(s: string): string {
  return stripUserMarkup(
    s
      .normalize('NFC')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/gu, ' ')
      .replace(/\t/g, ' '),
  );
}

export type FieldsResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Checks a full set of fields (create) or the given keys of a partial set (update). */
export function checkFields(input: unknown, partial: boolean): FieldsResult<Partial<DraftFields>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, message: 'fields must be an object' };
  const f = input as Record<string, unknown>;
  const out: Partial<DraftFields> = {};
  const need = (k: string): boolean => {
    if (f[k] === undefined) return !partial;
    return false;
  };
  for (const k of Object.keys(f)) if (!['name', 'shortBio', 'archetype', 'tags', 'district', 'voiceRef', 'appearancePreset'].includes(k)) return { ok: false, message: `unknown field ${k}` };
  if (f['name'] !== undefined) {
    if (typeof f['name'] !== 'string') return { ok: false, message: 'name must be text' };
    const name = cleanLine(f['name']);
    if (Array.from(name).length < 2 || Array.from(name).length > 40) return { ok: false, message: 'name must be 2 to 40 characters' };
    out.name = name;
  } else if (need('name')) return { ok: false, message: 'name is required' };
  if (f['shortBio'] !== undefined) {
    if (typeof f['shortBio'] !== 'string') return { ok: false, message: 'shortBio must be text' };
    const bio = cleanLine(f['shortBio']);
    if (Array.from(bio).length > 280) return { ok: false, message: 'shortBio must be at most 280 characters' };
    out.shortBio = bio;
  } else if (need('shortBio')) return { ok: false, message: 'shortBio is required' };
  if (f['archetype'] !== undefined) {
    if (typeof f['archetype'] !== 'string' || !ARCHETYPES.includes(f['archetype'] as Archetype)) return { ok: false, message: 'archetype is not one of the archetypes' };
    out.archetype = f['archetype'] as Archetype;
  } else if (need('archetype')) return { ok: false, message: 'archetype is required' };
  if (f['tags'] !== undefined) {
    if (!Array.isArray(f['tags']) || f['tags'].length > 16 || f['tags'].some((t) => typeof t !== 'string' || !TAG.test(t))) return { ok: false, message: 'tags must be up to 16 words of a-z, 0-9 and dashes' };
    out.tags = [...new Set(f['tags'] as string[])];
  } else if (need('tags')) out.tags = [];
  if (f['district'] !== undefined) {
    if (typeof f['district'] !== 'string' || !districts().includes(f['district'])) return { ok: false, message: 'district is not a district with places to live in yet' };
    out.district = f['district'];
  } else if (need('district')) return { ok: false, message: 'district is required' };
  if (f['voiceRef'] !== undefined) {
    if (f['voiceRef'] !== null && typeof f['voiceRef'] !== 'string') return { ok: false, message: 'voiceRef must be a voice id or null' };
    if (!voiceAllowed(f['voiceRef'] as string | null)) return { ok: false, message: 'voiceRef is not a voice a user character may use' };
    out.voiceRef = f['voiceRef'] as DraftFields['voiceRef'];
  } else if (need('voiceRef')) out.voiceRef = null;
  if (f['appearancePreset'] !== undefined) {
    if (f['appearancePreset'] !== null && (typeof f['appearancePreset'] !== 'string' || !PRESET.test(f['appearancePreset']))) return { ok: false, message: 'appearancePreset must be a preset id or null' };
    out.appearancePreset = f['appearancePreset'] as string | null;
  } else if (need('appearancePreset')) out.appearancePreset = null;
  return { ok: true, value: out };
}

/** Which voices the picker offers (the t1 catalog entries every likeness tier may use). */
export const voiceChoices = (): string[] => BUILDER.voices.filter((v) => v.tier === 't1').map((v) => v.voiceRef);
