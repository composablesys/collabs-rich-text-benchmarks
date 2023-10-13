import ReconnectingWebSocket from "reconnecting-websocket";

/**
 * Mixin that modifies the class WebSocket/ReconnectingWebSocket to
 * batch remote messages.
 *
 * They are delivered in a batch at most once every batchRemoteMS,
 * inside a call to batchWrapper. Our Yjs and ShareDB editors use
 * this to update Quill's state only at the end of a batch.
 * (Collabs does likewise, but its implementation is built-in to
 * @collabs/ws-client instead of using this mixin.)
 */
export function makeBatchWebSocket<
  T extends typeof WebSocket | typeof ReconnectingWebSocket
>(
  Base: T,
  batchRemoteMS: number | null,
  batchWrapper: (f: () => void) => void
): T {
  return class BatchWebSocket extends Base {
    private readonly ourListeners = new Map<any, any>();
    private varListener: any | undefined = undefined;

    set onmessage(listener: any) {
      if (listener) {
        this.addEventListener("message", listener);
        this.varListener = listener;
      } else {
        if (this.varListener !== undefined)
          this.removeEventListener("message", this.varListener);
        this.varListener = undefined;
      }
    }

    addEventListener(type: any, listener: any, options?: any): void {
      if (batchRemoteMS !== null && type === "message") {
        let nextBatch: MessageEvent[] = [];
        function ourListener(e: MessageEvent) {
          if (nextBatch.length === 0) {
            // Start of a new batch.
            setTimeout(() => {
              // Deliver the batch.
              batchWrapper(() => {
                for (const message of nextBatch) {
                  listener(message);
                }
              });
              nextBatch = [];
            }, batchRemoteMS!);
          }
          nextBatch.push(e);
        }
        super.addEventListener(type, ourListener, options);
        this.ourListeners.set(listener, ourListener);
      } else super.addEventListener(type, listener, options);
    }

    removeEventListener(type: any, listener: any, options?: any): void {
      if (batchRemoteMS !== null && type === "message") {
        const ourListener = this.ourListeners.get(listener);
        if (ourListener) super.removeEventListener(type, ourListener, options);
      } else super.removeEventListener(type, listener, options);
    }
  };
}
