/** Internal cloud-sync port (M04b3). Not a contract; M12a1 adds `HttpCloudSync` behind the same shape. */
export type CloudSyncStatus = 'off' | 'idle' | 'syncing' | 'error';

export interface CloudSync {
  readonly kind: 'null' | 'http';
  status(): CloudSyncStatus;
  syncNow(): Promise<{ pushed: number; pulled: number }>;
  onStatus(cb: (status: CloudSyncStatus) => void): () => void;
}

/** The v1 default: no sync, no request, status always `off`. */
export class NullCloudSync implements CloudSync {
  readonly kind = 'null' as const;

  status(): CloudSyncStatus {
    return 'off';
  }

  syncNow(): Promise<{ pushed: number; pulled: number }> {
    return Promise.resolve({ pushed: 0, pulled: 0 });
  }

  /** The status never changes, so the callback is never called; the returned function is a no-op. */
  onStatus(_cb: (status: CloudSyncStatus) => void): () => void {
    return () => undefined;
  }
}
