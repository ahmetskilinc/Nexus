import type { CoreContext, RuntimeCore } from "./core";

/// Transitional core used while the real method handlers are being ported
/// from the Rust runtime. Answers `health`; everything else reports itself
/// as not yet migrated so the failure mode in the UI is explicit.
export class StubCore implements RuntimeCore {
  async handle(
    method: string,
    _params: unknown,
    context: CoreContext,
  ): Promise<unknown> {
    if (method === "health") {
      return {
        runtime: "nexus-runtime",
        version: context.config.appVersion,
      };
    }
    throw new Error(
      `The TypeScript runtime does not implement "${method}" yet.`,
    );
  }
}
