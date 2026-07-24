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
  agent: boolean;
  deliverApproval?: (callId: string, approved: boolean) => void;
};

export class RunRegistry {
  private runs = new Map<string, RunHandle>();

  register(id: string, agent = false): RunHandle {
    const handle: RunHandle = {
      abort: new AbortController(),
      settled: false,
      agent,
    };
    this.runs.set(id, handle);
    return handle;
  }

  /// Agent runs are intentionally serialized. Model calls, MCP processes, and
  /// mutation checkpoints are resource-heavy; a second request stays queued in
  /// the server until no other live `agent.run` handle remains.
  hasActiveAgentExcept(id: string): boolean {
    return [...this.runs.entries()].some(
      ([otherId, handle]) => otherId !== id && handle.agent && !handle.settled,
    );
  }

  async waitForAgentSlot(id: string, signal: AbortSignal): Promise<void> {
    while (this.hasActiveAgentExcept(id)) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 50);
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    }
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
