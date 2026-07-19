import { Popover } from "@base-ui/react/popover";
import type { ModelInfo, ModelsEntry, ProviderProfile } from "@nexus/protocol";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ModelSelection } from "../hooks/useModelSelection";
import { EFFORT_LABEL } from "../lib/capabilities";
import { formatTokens, shortModel } from "../lib/format";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FlashIcon,
  SearchIcon,
} from "./Icons";

type View = "main" | "provider" | "model" | "effort";

/// Matches a model on either its display name or its raw id.
function modelMatches(model: ModelInfo, query: string): boolean {
  return (
    model.name.toLowerCase().includes(query) ||
    model.id.toLowerCase().includes(query)
  );
}

export function ModelEffortMenu({
  selection,
  onOpenSettings,
}: {
  selection: ModelSelection;
  onOpenSettings: () => void;
}) {
  const {
    providers,
    modelsByProvider,
    currentProviderId,
    currentModel,
    currentEffort,
    effortOptions,
    requestModels: onRequestModels,
    selectModel: onSelectModel,
    selectEffort: onSelectEffort,
    resetEffort: onResetDefaults,
  } = selection;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("main");
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState<string>();
  const searchRef = useRef<HTMLInputElement>(null);
  const hasProviders = providers.length > 0;
  const multiProvider = providers.length > 1;
  const effortEnabled = effortOptions.length > 0;

  // The Model list is scoped to one provider at a time. Default to the active
  // provider; the Provider drill-down lets you switch which one is in focus.
  const focusedProviderId = focused ?? currentProviderId ?? providers[0]?.id;
  const focusedProvider = providers.find(
    (item) => item.id === focusedProviderId,
  );
  const focusedEntry = focusedProviderId
    ? modelsByProvider[focusedProviderId]
    : undefined;

  const q = query.trim().toLowerCase();
  const focusedMatches =
    focusedEntry?.models?.filter((model) => modelMatches(model, q)).length ?? 0;
  const showEmpty =
    q.length > 0 && !focusedEntry?.loading && focusedMatches === 0;

  // Focus the filter when entering the model list; clear it on the way out so
  // the next visit starts fresh.
  useEffect(() => {
    if (view === "model") searchRef.current?.focus();
    else setQuery("");
  }, [view]);

  function onOpenChange(next: boolean) {
    // No providers yet: the pill is a shortcut into Settings, not a menu.
    if (next && !hasProviders) {
      onOpenSettings();
      return;
    }
    if (next) {
      setView("main");
      setFocused(undefined);
      for (const item of providers) {
        const entry = modelsByProvider[item.id];
        if (!entry?.models && !entry?.loading) onRequestModels(item.id);
      }
    }
    setOpen(next);
  }

  const label = currentModel
    ? shortModel(currentModel)
    : hasProviders
      ? "Select a model"
      : "Connect a provider";

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger className="flex items-center gap-1.5 rounded-lg border border-border-soft bg-muted py-1.5 pr-2 pl-2.5 text-[12px] font-medium text-muted-foreground outline-none transition hover:border-border hover:text-foreground">
        <FlashIcon
          size={13}
          className={currentModel ? "text-primary-soft" : "text-faint"}
        />
        <span>{label}</span>
        {currentModel && currentEffort && effortEnabled ? (
          <span className="text-faint">{EFFORT_LABEL[currentEffort]}</span>
        ) : null}
        {hasProviders ? (
          <ChevronDownIcon size={13} className="text-faint" />
        ) : null}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={8}
          className="z-50"
        >
          <Popover.Popup className="w-72 origin-[var(--transform-origin)] overflow-hidden rounded-lg border border-border bg-popover shadow-[var(--shadow-pop)] outline-none transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0">
            <AnimatePresence initial={false} mode="popLayout">
              {view === "main" ? (
                <m.div
                  key="main"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  className="py-1"
                >
                  {multiProvider ? (
                    <MenuRow
                      label="Provider"
                      value={focusedProvider?.name ?? "—"}
                      onClick={() => setView("provider")}
                    />
                  ) : null}
                  <MenuRow
                    label="Model"
                    value={shortModel(currentModel) ?? "—"}
                    onClick={() => setView("model")}
                  />
                  {effortEnabled ? (
                    <MenuRow
                      label="Effort"
                      value={
                        currentEffort ? EFFORT_LABEL[currentEffort] : "Default"
                      }
                      onClick={() => setView("effort")}
                    />
                  ) : null}
                  <div className="my-1 border-t border-border-soft" />
                  <button
                    type="button"
                    onClick={() => {
                      onResetDefaults();
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    Reset to default
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenSettings();
                      setOpen(false);
                    }}
                    className="w-full px-3 py-2 text-left text-[12px] font-medium text-primary-soft transition hover:bg-accent"
                  >
                    Manage providers
                  </button>
                </m.div>
              ) : view === "provider" ? (
                <m.div
                  key="provider"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                >
                  <SubmenuHeader
                    label="Provider"
                    onBack={() => setView("main")}
                  />
                  <div className="scrollbar-thin max-h-64 overflow-y-auto py-1">
                    {providers.map((item) => {
                      const active = item.id === focusedProviderId;
                      return (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => {
                            setFocused(item.id);
                            setView("model");
                          }}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] transition hover:bg-accent ${
                            active ? "text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          <span className="min-w-0 truncate">{item.name}</span>
                          {active ? (
                            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </m.div>
              ) : view === "model" ? (
                <m.div
                  key="model"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                >
                  <SubmenuHeader
                    label={
                      multiProvider
                        ? (focusedProvider?.name ?? "Model")
                        : "Model"
                    }
                    onBack={() => setView(multiProvider ? "provider" : "main")}
                  />
                  <div className="border-b border-border-soft px-2.5 py-2">
                    <div className="flex items-center gap-2 rounded-lg border border-border-soft bg-muted px-2.5 py-1.5 focus-within:border-primary-dim">
                      <SearchIcon size={13} className="text-faint" />
                      <input
                        ref={searchRef}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search models"
                        aria-label="Search models"
                        className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-faint"
                      />
                    </div>
                  </div>
                  <div className="scrollbar-thin max-h-64 overflow-y-auto py-1">
                    {!focusedProvider ? (
                      <p className="px-3 py-4 text-center text-[12px] text-faint">
                        No provider selected.
                      </p>
                    ) : showEmpty ? (
                      <p className="px-3 py-4 text-center text-[12px] text-faint">
                        No models match “{query.trim()}”.
                      </p>
                    ) : (
                      <ProviderModels
                        provider={focusedProvider}
                        entry={focusedEntry}
                        query={q}
                        showHeader={!multiProvider}
                        currentProviderId={currentProviderId}
                        currentModel={currentModel}
                        onRetry={() => onRequestModels(focusedProvider.id)}
                        onSelect={(model) => {
                          onSelectModel(focusedProvider.id, model);
                          setOpen(false);
                        }}
                      />
                    )}
                  </div>
                </m.div>
              ) : (
                <m.div
                  key="effort"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                >
                  <SubmenuHeader
                    label="Effort"
                    onBack={() => setView("main")}
                  />
                  <div className="py-1">
                    {effortOptions.map((level) => {
                      const active = level === currentEffort;
                      return (
                        <button
                          type="button"
                          key={level}
                          onClick={() => {
                            onSelectEffort(level);
                            setOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] transition hover:bg-accent ${
                            active ? "text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          {EFFORT_LABEL[level]}
                          {active ? (
                            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </m.div>
              )}
            </AnimatePresence>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MenuRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] transition hover:bg-accent"
    >
      <span className="font-medium text-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1 text-faint">
        <span className="truncate font-mono text-[11px]">{value}</span>
        <ChevronRightIcon size={13} />
      </span>
    </button>
  );
}

function SubmenuHeader({
  label,
  onBack,
}: {
  label: string;
  onBack: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex w-full items-center gap-1.5 border-b border-border-soft px-2.5 py-2 text-left text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
    >
      <ChevronLeftIcon size={14} />
      {label}
    </button>
  );
}

function ProviderModels({
  provider,
  entry,
  query,
  showHeader = true,
  currentProviderId,
  currentModel,
  onRetry,
  onSelect,
}: {
  provider: ProviderProfile;
  entry?: ModelsEntry;
  query: string;
  showHeader?: boolean;
  currentProviderId?: string;
  currentModel?: string;
  onRetry: () => void;
  onSelect: (model: string) => void;
}) {
  const matches = entry?.models?.filter((model) => modelMatches(model, query));

  // Hide a fully-loaded provider whose models don't match the active filter.
  if (query && entry?.models && (matches?.length ?? 0) === 0) return null;

  return (
    <div>
      {showHeader ? (
        <div className="sticky top-0 z-10 bg-popover px-3 pt-2 pb-1 text-[10px] font-semibold tracking-[0.1em] text-faint uppercase">
          {provider.name}
        </div>
      ) : null}
      {entry?.loading ? (
        <p className="px-3 py-1.5 text-[12px] text-faint">Loading models…</p>
      ) : entry?.error ? (
        <div className="px-3 py-1.5">
          <p className="text-[12px] leading-snug text-destructive">
            {entry.error}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 text-[11px] font-medium text-primary-soft hover:underline"
          >
            Retry
          </button>
        </div>
      ) : matches && matches.length > 0 ? (
        matches.map((model) => {
          const active =
            provider.id === currentProviderId && model.id === currentModel;
          return (
            <button
              type="button"
              key={model.id}
              onClick={() => onSelect(model.id)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition hover:bg-accent ${
                active ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[12px] font-medium">
                  {model.name}
                </span>
                <span className="flex items-center gap-1.5 truncate font-mono text-[10px] text-faint">
                  {model.id}
                  {model.context ? (
                    <span className="shrink-0">
                      · {formatTokens(model.context)}
                    </span>
                  ) : null}
                  {model.releaseDate ? (
                    <span className="shrink-0">· {model.releaseDate}</span>
                  ) : null}
                  {model.status ? (
                    <span className="shrink-0 uppercase">· {model.status}</span>
                  ) : null}
                  {(model.modalities?.length ?? 0) > 1 ? (
                    <span className="shrink-0">
                      · {model.modalities?.join("/")}
                    </span>
                  ) : null}
                </span>
              </span>
              {active ? (
                <span className="size-1.5 shrink-0 rounded-full bg-primary" />
              ) : null}
            </button>
          );
        })
      ) : (
        <p className="px-3 py-1.5 text-[12px] text-faint">
          No models available
        </p>
      )}
    </div>
  );
}
