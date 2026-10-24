import type { UiCommand } from '@dv/shared';

/** The part of the transport the sender uses. False from `sendUi` means the command ring was full and the command was dropped. */
export interface UiCommandTransport {
  sendUi(cmd: UiCommand): boolean;
}

/** `mode.cmd` arguments are capped at 512 bytes of JSON (C06 `UiCommand`). */
const MODE_CMD_MAX_BYTES = 512;

/**
 * The page's end of the UI command channel (C06 1.1): validates a `UiCommand` and sends it over the command ring of the sim transport.
 * Commands that cannot be sent (no transport yet, or a full ring) are counted and reported through the return value; the UI shows
 * nothing different for them, the caller may retry.
 */
export class UiCommandSender {
  sent = 0;
  dropped = 0;
  rejected = 0;

  constructor(private readonly transport: () => UiCommandTransport | null) {}

  send(cmd: UiCommand): boolean {
    if (cmd.t === 'mode.cmd' && JSON.stringify(cmd.args ?? {}).length > MODE_CMD_MAX_BYTES) {
      this.rejected++;
      return false;
    }
    const ok = this.transport()?.sendUi(cmd) ?? false;
    if (ok) this.sent++;
    else this.dropped++;
    return ok;
  }
}
