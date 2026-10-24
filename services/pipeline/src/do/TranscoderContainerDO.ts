import { Container } from '@cloudflare/containers';

/** What the container class reads from the Worker: the C2PA signing material (Worker secrets, never in a client bundle). */
export interface TranscoderEnv {
  /** PEM of the signing certificate followed by its chain (ES256). */
  C2PA_CERT_CHAIN_PEM?: string | undefined;
  /** PKCS#8 PEM of the signing key. */
  C2PA_KEY_PEM?: string | undefined;
}

/**
 * The Transcoder Container (M05c3, DL-232): ffmpeg ladder `cut@1` and the C2PA re-signer of
 * `services/pipeline/transcoder/`. One instance per cutscene key (`env.TRANSCODER.getByName(key)`); it sleeps two minutes after
 * its last request. The server pings itself ready on port 8080 (`/ping`). The signing material is passed as process
 * environment at start; without it `/health` reports `signer: false` and the job refuses before it spends.
 */
export class TranscoderContainer extends Container<TranscoderEnv> {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = '2m';

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: TranscoderEnv) {
    super(ctx, env);
    const vars: Record<string, string> = {};
    if (env.C2PA_CERT_CHAIN_PEM) vars['C2PA_CERT_CHAIN_PEM'] = env.C2PA_CERT_CHAIN_PEM;
    if (env.C2PA_KEY_PEM) vars['C2PA_KEY_PEM'] = env.C2PA_KEY_PEM;
    this.envVars = vars;
  }
}
