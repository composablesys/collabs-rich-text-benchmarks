import Quill from "quill";

export interface SyncFramework {
  /**
   * Promise that resolves when the framework is ready to start
   * benchmarking (WebSocket connected, initial doc loaded).
   */
  readonly ready: Promise<void>;
  getSavedState(): Uint8Array | string;
}

export type SyncFrameworkClass = new (
  wsURL: string,
  docID: string,
  editor: Quill,
  batchRemoteMS: number | null,
  batchSendMS: number | null
) => SyncFramework;
