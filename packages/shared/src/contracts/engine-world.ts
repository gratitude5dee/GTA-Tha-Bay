// Copied from spec/domains/01-engine-save-modes.md (Time-of-day and weather clock) and the 1.1 weekdayOf addition.
export type WeatherPreset = 'clear' | 'karl-fog' | 'overcast' | 'rain' | 'smoke' | 'golden'; // [research/repos-world.md P10]
export interface WorldClockState { t: number /* integer game half-seconds since day 0 */; rate: 1 /* half-seconds per tick */; paused: boolean; lockedBy: string | null }
export interface WeatherState { current: WeatherPreset; next: WeatherPreset; blend: number /* u16 0..65535 */; changeAtT: number; fogBankM: number /* marine-layer height */; rain: number /* u8 */ }
export interface EnvState { hour: number; night: number; dark: number; weather: WeatherPreset; next: WeatherPreset; blend: number; fogBankM: number; rain: number }
export interface WorldClockApi {
  now(): Readonly<WorldClockState>; env(): Readonly<EnvState>;
  setHour(h: number): void; pause(on: boolean): void;
  lock(by: string, hour?: number, weather?: WeatherPreset): void; unlock(by: string): void;
  forceWeather(w: WeatherPreset, blendSec: number): void;
}

/** engine-world.ts: pure weekday of the C06 clock; t in half-seconds, 172,800 per game day, t = 0 is Monday 00:00 (S04). */
export const weekdayOf = (t: number): 0 | 1 | 2 | 3 | 4 | 5 | 6 => (Math.floor(t / 172800) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
