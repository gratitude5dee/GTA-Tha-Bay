import { Group, type Camera, type Scene, type WebGPURenderer } from 'three/webgpu';

/**
 * The XR smoke test of M01b2 (R-PLAT-02, risk retirement only): a QA-only "Enter VR (smoke)" button that starts an
 * `immersive-vr` session on the gray-box block and exits back to the flat page. The full port (locomotion, input, comfort)
 * is M11b1.
 *
 * Rules it follows (11-platform-xr.md section 5.1, CLAUDE.md "XR"): `navigator.xr.requestSession` is called inside the click
 * handler with nothing awaited before it; `renderer.xr.enabled` was set before `init()` by the renderer host; rendering stays
 * on the main thread; the engine's frame hook runs on every XR frame because the host's animation loop is the session's.
 */
export interface XrSessionLike {
  end(): Promise<void>;
  addEventListener(type: 'end', listener: () => void): void;
}
export interface XrSystemLike {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, init?: { optionalFeatures?: string[]; requiredFeatures?: string[] }): Promise<XrSessionLike>;
}

export interface XrSmokeDeps {
  renderer: () => Pick<WebGPURenderer, 'xr'>;
  scene: Pick<Scene, 'add' | 'remove'>;
  /** The camera the host renders with. During a session it hangs under a group that follows the player's feet. */
  camera: Camera;
  /** `navigator.xr`. */
  xr: XrSystemLike | undefined;
  container: HTMLElement;
  /** Label of the button (English default; the i18n catalog does not carry QA strings). */
  label?: string;
  /** Called with the session just before the renderer takes it, and again with null after it ends. */
  onSession: (session: XrSessionLike | null) => void;
  /** The player's feet and heading right now, ENU metres and radians; null when there is no player in the snapshot. */
  feet: () => { x: number; y: number; z: number; yaw: number } | null;
}

export interface XrSmoke {
  readonly button: HTMLButtonElement;
  readonly session: XrSessionLike | null;
  /** XR frames rendered (the host's count) are read by the caller; this is the number of sessions started. */
  readonly sessions: number;
  /** Moves the rig group to the player's feet. Call once per frame while presenting. */
  update(): void;
  end(): Promise<void>;
  dispose(): void;
}

/** True when `immersive-vr` is supported; false when there is no `navigator.xr` or the query throws. */
export async function immersiveVrSupported(xr: XrSystemLike | undefined): Promise<boolean> {
  if (!xr) return false;
  try {
    return await xr.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}

/** Builds the button when the browser supports `immersive-vr`; resolves to null otherwise. */
export async function installXrSmoke(deps: XrSmokeDeps): Promise<XrSmoke | null> {
  const xr = deps.xr;
  if (!xr || !(await immersiveVrSupported(xr))) return null;
  const doc = deps.container.ownerDocument;

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'dv-xr-smoke';
  button.dataset['dvXrSmoke'] = '';
  button.textContent = deps.label ?? 'Enter VR (smoke)';
  Object.assign(button.style, {
    position: 'fixed', insetBlockStart: '8px', insetInlineEnd: '72px', zIndex: '9', padding: '8px 12px', font: '600 14px system-ui, sans-serif',
    color: '#fff', background: '#2257c9', border: '0', borderRadius: '6px', minBlockSize: '44px',
  });
  deps.container.append(button);

  const rig = new Group();
  rig.name = 'xr-rig';
  let session: XrSessionLike | null = null;
  let sessions = 0;
  let disposed = false;

  const restore = (): void => {
    if (rig.parent) deps.scene.remove(rig);
    rig.remove(deps.camera);
    deps.camera.position.set(0, 0, 0);
    session = null;
    button.disabled = false;
    deps.onSession(null);
  };

  const smoke: XrSmoke = {
    button,
    get session() {
      return session;
    },
    get sessions() {
      return sessions;
    },
    update() {
      if (!session) return;
      const f = deps.feet();
      if (!f) return;
      rig.position.set(f.x, f.y, f.z);
    },
    async end() {
      const s = session;
      if (s) await s.end();
    },
    dispose() {
      disposed = true;
      button.remove();
      if (session) void session.end().catch(() => {});
    },
  };

  // The handler must call requestSession first, with nothing awaited before it (user activation does not survive an await).
  button.addEventListener('click', () => {
    if (session || disposed) return;
    button.disabled = true;
    const request = xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    void request.then(
      async (s) => {
        const renderer = deps.renderer();
        renderer.xr.setReferenceSpaceType('local-floor');
        const f = deps.feet();
        rig.rotation.set(0, f?.yaw ?? 0, 0);
        deps.scene.add(rig);
        rig.add(deps.camera);
        deps.camera.position.set(0, 0, 0);
        smoke.update();
        s.addEventListener('end', restore);
        session = s;
        sessions++;
        deps.onSession(s);
        await renderer.xr.setSession(s as unknown as XRSession);
      },
      (error: unknown) => {
        console.warn('immersive-vr was refused', error);
        button.disabled = false;
      },
    );
  });

  return smoke;
}
