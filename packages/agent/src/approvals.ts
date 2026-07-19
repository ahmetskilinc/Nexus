/// The approval rendezvous between the agent loop and the desktop app,
/// reproducing the Rust unbounded-channel semantics exactly:
///
///  - replies may arrive BEFORE the loop starts waiting (the desktop can
///    answer as soon as it sees the approval_request event, or even earlier
///    in tests) — they are buffered, never lost;
///  - a stale reply for a different call id is skipped, not delivered;
///  - closing the mailbox (run shutdown) resolves any wait as a decline.
export type ApprovalReply = { callId: string; approved: boolean };

export class ApprovalMailbox {
  private queue: ApprovalReply[] = [];
  private waiter:
    | { callId: string; resolve: (approved: boolean) => void }
    | undefined;
  private closed = false;

  /// Called by the `agent.approve` dispatch path.
  deliver(reply: ApprovalReply) {
    if (this.waiter) {
      if (reply.callId === this.waiter.callId) {
        const { resolve } = this.waiter;
        this.waiter = undefined;
        resolve(reply.approved);
      }
      // else: a stale reply for an earlier call — drop it, keep waiting.
      return;
    }
    this.queue.push(reply);
  }

  /// Blocks until a reply for `callId` arrives (or the mailbox closes / the
  /// run aborts, both treated as a decline).
  wait(callId: string, signal?: AbortSignal): Promise<boolean> {
    // Drain buffered replies first, skipping stale ids.
    while (this.queue.length > 0) {
      const reply = this.queue.shift();
      if (reply && reply.callId === callId)
        return Promise.resolve(reply.approved);
    }
    if (this.closed || signal?.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.waiter = { callId, resolve };
      signal?.addEventListener(
        "abort",
        () => {
          if (this.waiter?.callId === callId) {
            this.waiter = undefined;
            resolve(false);
          }
        },
        { once: true },
      );
    });
  }

  /// The run is shutting down; decline rather than block forever.
  close() {
    this.closed = true;
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.resolve(false);
  }
}
