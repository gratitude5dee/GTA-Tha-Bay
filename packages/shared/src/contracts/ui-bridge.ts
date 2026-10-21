// packages/shared/src/contracts/ui-bridge.ts (C06 1.1.0). Copied from spec/domains/10-ui.md section 3.3 without shape changes;
// S01 owns the file, S10 designed the shapes. `ToastKind` is declared here because @dv/shared cannot import packages/ui (DL-196).
import type { CutsceneOutcome, FallbackTrigger } from './c09-cutscene.ts';
import type { SaveReason, SlotId, JsonObject, JsonValue } from './c05-save.ts';
import type { GameModeId } from './c06-ids.ts';

export type VmKey = `hud.${string}` | `phone.${string}` | `sys.${string}` | `mode.${GameModeId}.${string}`;
export interface VmPatch { k: VmKey; rev: number; v: JsonValue | null }          // whole-value replace; null deletes
export interface ViewModelSource {
  get<T extends JsonValue>(k: VmKey): T | undefined;
  subscribe(k: VmKey | `${string}*`, cb: (v: JsonValue | undefined, k: VmKey) => void): () => void;
  readonly rev: number;
}
export type ToastKind = 'info' | 'success' | 'warning' | 'unlock' | 'error';
export interface UiBridge {                                                       // sim side = ModeContext.ui
  patch(k: VmKey, v: JsonValue | null): void;                                     // coalesced, <= 64 patches and <= 4 KiB per tick
  toast(t: { id: string; kind: ToastKind; text: string /* LocKey */; params?: Record<string, string | number> }): void;
  openApp(app: string): void; closeOverlay(): void;
}
export type UiCommand =
  | { t: 'mode.start'; id: GameModeId; slot?: SlotId } | { t: 'mode.quit' } | { t: 'pause'; on: boolean }
  | { t: 'save.request'; reason: SaveReason } | { t: 'save.settings'; data: JsonObject } | { t: 'save.avatar'; avatar: JsonObject }
  | { t: 'save.profile'; op: 'create' | 'rename' | 'delete' | 'select'; id?: string; name?: string }
  | { t: 'garage.call'; vehicleKey: string } | { t: 'garage.favorite'; vehicleKey: string }
  | { t: 'sandbox.set'; path: string; v: boolean | number } | { t: 'sandbox.teleport'; name: string }
  | { t: 'phone.waypoint'; x: number; z: number } | { t: 'cutscene.skip' }
  | { t: 'cutscene.state'; playId: string /* String(cut.request n), 03-story-cutscenes section D7 */; item?: number; state: 'video' | 'fallback' | 'done'; trigger?: FallbackTrigger; outcome?: CutsceneOutcome }   // C09 player -> sim (S03, DL-081)
  | { t: 'mode.cmd'; mode: GameModeId; name: string; args?: JsonObject };         // mode-owned commands (<= 512 B)
