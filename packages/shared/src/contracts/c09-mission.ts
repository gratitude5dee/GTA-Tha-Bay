// Partial C09 mission file: only what c09-cutscene.ts imports. M05a1 completes it with the types of
// spec/domains/03-story-missions.md section C3 (M05b1 creates the stub because M04c has not landed; same content as M04c).
export const C09_VERSION = '1.0.0' as const;

export type LineId = `line.${string}`;             // key into lines.<lang>.json; every line has subtitle text
export type CastName = string;                     // ^[a-z][a-z0-9_]{0,31}$
export type LatLngTuple = [lat: number, lng: number];   // WGS84 in authored data only (06 §4.3)
