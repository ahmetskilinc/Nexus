/// Bookkeeping for in-flight requests, reproducing the Rust run-registry
/// semantics exactly:
///
///  - `cancel` always succeeds (responds `{}`) even for unknown run ids.
///  - Cancelling a live run aborts it, emits the cancelled error envelope on
///    the *run's* id, and marks it settled so the run's own eventual
///    completion or failure is suppressed (never two responses per request).
///  - `agent.approve` deliveries route to the run's registered handler and
///    are dropped when the run is gone.
export type RunHandle = {
  abort: AbortController;
  settled: boolean;
  deliverApproval?: (callId: string, approved: boolean) => void;
};

export class RunRegistry {
  private runs = new Map<string, RunHandle>();

  register(id: string): RunHandle {
    const handle: RunHandle = { abort: new AbortController(), settled: false };
    this.runs.set(id, handle);
    return handle;
  }

  /// Marks the request settled; returns false when it already was (i.e. the
  /// cancel path owned the response and the caller must stay silent).
  trySettle(id: string): boolean {
    const handle = this.runs.get(id);
    if (!handle || handle.settled) return false;
    handle.settled = true;
    return true;
  }

  remove(id: string) {
    this.runs.delete(id);
  }

  /// Returns true when a live (unsettled) run was cancelled — the caller then
  /// emits the cancelled error on the run's id.
  cancel(runId: string): boolean {
    const handle = this.runs.get(runId);
    if (!handle || handle.settled) return false;
    handle.settled = true;
    handle.abort.abort();
    return true;
  }

  deliverApproval(runId: string, callId: string, approved: boolean) {
    this.runs.get(runId)?.deliverApproval?.(callId, approved);
  }

  /// Aborts everything (transport death / shutdown).
  abortAll() {
    for (const handle of this.runs.values()) {
      handle.settled = true;
      handle.abort.abort();
    }
    this.runs.clear();
  }
}
