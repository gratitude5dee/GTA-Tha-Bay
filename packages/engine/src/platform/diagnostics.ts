/**
 * Diagnostics string shown on the unsupported screen (11-platform.md section 5.1 step 5: "this browser cannot
 * run the game" plus a string a player can paste into a support request). No IP, no profile id, no free text.
 */
export interface DiagnosticSignals {
  userAgent: string;
  crossOriginIsolated: boolean;
  webgl2: boolean;
  webgpu: boolean;
  xr: boolean;
  standalone: boolean;
  screen: { w: number; h: number; dpr: number };
  build: string;
}

export const DIAG_PREFIX = 'dv-diag/1';

export function formatDiagnostics(s: DiagnosticSignals): string {
  const ua = s.userAgent.replace(/[\s|]+/g, ' ').slice(0, 120);
  const flag = (b: boolean): string => (b ? '1' : '0');
  return [
    DIAG_PREFIX,
    `build=${s.build}`,
    `coi=${flag(s.crossOriginIsolated)}`,
    `webgl2=${flag(s.webgl2)}`,
    `webgpu=${flag(s.webgpu)}`,
    `xr=${flag(s.xr)}`,
    `standalone=${flag(s.standalone)}`,
    `screen=${s.screen.w}x${s.screen.h}@${s.screen.dpr}`,
    `ua=${ua}`,
  ].join(' | ');
}

function hasWebGl2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

export function collectDiagnosticSignals(build: string): DiagnosticSignals {
  const nav = navigator as Navigator & { gpu?: unknown; xr?: unknown; standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    crossOriginIsolated: self.crossOriginIsolated,
    webgl2: hasWebGl2(),
    webgpu: nav.gpu !== undefined,
    xr: nav.xr !== undefined,
    standalone: matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
    screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
    build,
  };
}
