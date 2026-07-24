import type {
  AppState,
  Effort,
  ModelsEntry,
  ProviderProfile,
} from "@nexus/protocol";
import { useState } from "react";
import {
  type AppOp,
  clearSessionEffort,
  selectEffort as selectEffortOp,
  selectModel as selectModelOp,
} from "../lib/ops";
import {
  resolveEffort,
  resolveEffortOptions,
  resolveModel,
} from "../lib/session";

/// Everything the model/effort picker needs, as one typed bundle — the module
/// travels App → Composer → ModelEffortMenu as a single prop instead of an
/// 11-prop tunnel.
export type ModelSelection = {
  providers: ProviderProfile[];
  modelsByProvider: Record<string, ModelsEntry>;
  currentProviderId?: string;
  currentModel?: string;
  currentEffort?: Effort;
  effortOptions: Effort[];
  /// Image input is advertised by the selected model's catalog metadata.
  supportsImages: boolean;
  requestModels: (providerId: string) => void;
  selectModel: (providerId: string, model: string) => void;
  selectEffort: (effort: Effort) => void;
  resetEffort: () => void;
};

/// The provider→models catalog cache plus its fetch trigger. Owned once by the
/// App and shared across panes, so a split view doesn't fetch each provider's
/// model list twice.
export type ModelCatalog = {
  modelsByProvider: Record<string, ModelsEntry>;
  requestModels: (providerId: string) => void;
};

export function useModelCatalog(): ModelCatalog {
  const [modelsByProvider, setModelsByProvider] = useState<
    Record<string, ModelsEntry>
  >({});

  function requestModels(providerId: string) {
    setModelsByProvider((current) => ({
      ...current,
      [providerId]: { ...current[providerId], loading: true, error: undefined },
    }));
    window.nexus
      .listModels(providerId)
      .then((models) =>
        setModelsByProvider((current) => ({
          ...current,
          [providerId]: { models, loading: false },
        })),
      )
      .catch((reason: unknown) =>
        setModelsByProvider((current) => ({
          ...current,
          [providerId]: {
            loading: false,
            error:
              reason instanceof Error
                ? reason.message
                : "Could not load models.",
          },
        })),
      );
  }

  return { modelsByProvider, requestModels };
}

/// Resolves one session's current selection (session override → global default
/// → clamped effort) and binds the selection writes to that session. Pure
/// derivation over the shared catalog — instantiable per pane.
export function modelSelectionFor(
  state: AppState | undefined,
  apply: (op: AppOp) => void,
  sessionId: string | undefined,
  catalog: ModelCatalog,
): ModelSelection {
  const session = state?.sessions.find((item) => item.id === sessionId);
  const resolved = state ? resolveModel(session, state) : {};

  function selectModel(providerId: string, model: string) {
    if (session) apply(selectModelOp(session.id, providerId, model));
  }

  function selectEffort(effort: Effort) {
    if (session) apply(selectEffortOp(session.id, effort));
  }

  // "Reset to default" clears the per-session override so the run falls back to
  // the global default effort.
  function resetEffort() {
    if (session) apply(clearSessionEffort(session.id));
  }

  const currentInfo = resolved.providerId
    ? catalog.modelsByProvider[resolved.providerId]?.models?.find(
        (item) => item.id === resolved.model,
      )
    : undefined;
  return {
    providers: state?.providers ?? [],
    modelsByProvider: catalog.modelsByProvider,
    currentProviderId: resolved.providerId,
    currentModel: resolved.model,
    currentEffort: state ? resolveEffort(session, state) : undefined,
    effortOptions: state
      ? resolveEffortOptions(state, session, catalog.modelsByProvider)
      : [],
    supportsImages: currentInfo?.modalities?.includes("image") ?? false,
    requestModels: catalog.requestModels,
    selectModel,
    selectEffort,
    resetEffort,
  };
}
