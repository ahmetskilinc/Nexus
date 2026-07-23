import type { AppState } from "@nexus/protocol";
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  MotionConfig,
  m,
} from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPane } from "./components/ChatPane";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  AiIcon,
  CloseIcon,
  ComposeIcon,
  GitBranchIcon,
  PanelLeftIcon,
  PanelRightIcon,
  ReviewIcon,
  TerminalIcon,
} from "./components/Icons";
import { LeftNav, LeftNavDrawer } from "./components/LeftNav";
import { PlanPanel } from "./components/PlanPanel";
import { ResearchPanel } from "./components/ResearchPanel";
import { ReviewPanel } from "./components/ReviewPanel";
import { RightPanel } from "./components/RightPanel";
import { SettingsScreen } from "./components/SettingsScreen";
import { TerminalPanel } from "./components/TerminalPanel";
import { Hint, TooltipProvider } from "./components/Tooltip";
import { TopBar } from "./components/TopBar";
import { Welcome } from "./components/Welcome";
import { useAgentRun } from "./hooks/useAgentRun";
import { useEditorTabs } from "./hooks/useEditorTabs";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useModelCatalog } from "./hooks/useModelSelection";
import { usePanels } from "./hooks/usePanels";
import { useSessions } from "./hooks/useSessions";
import { useWorkspaceFiles } from "./hooks/useWorkspaceFiles";
import { basename, createId } from "./lib/format";
import { rise } from "./lib/motion";
import {
  type AppOp,
  addSession,
  closeSplitPane,
  focusSession,
  markCheckpointFilesRestored,
  markCheckpointRestored,
  setSplitRatio,
} from "./lib/ops";
import {
  groupSessions,
  newSession,
  sanitizeImportedSession,
} from "./lib/session";
import { useAppliedTheme } from "./lib/theme";
import type { RuntimeStatus } from "./lib/types";

// Right-corner panel toggles stack leftward from the window edge; the always-on
// files toggle sits at the corner and optional ones step left by TOGGLE_STEP.
const TOGGLE_BASE = 10;
const TOGGLE_STEP = 36;

// Composition root: state/effects live in dedicated hooks (useWorkspaceFiles,
// usePanels, useAgentRun, useModelCatalog, useSessions, useGlobalShortcuts);
// the remaining length is the cohesive app layout. React Doctor's own guidance
// allows a long, cohesive JSX-heavy component — this is a deliberate keep.
export function App() {
  const [state, setState] = useState<AppState>();
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("checking");
  const [error, setError] = useState<string>();
  const [showSettings, setShowSettings] = useState(false);

  // The single mutation funnel: leaves receive `apply` and named ops, never
  // the raw whole-state setter. Functional updates mean an op fired after an
  // await composes with the latest state instead of clobbering it.
  const apply = useCallback(
    (op: AppOp) => setState((current) => current && op(current)),
    [],
  );

  const resolvedTheme = useAppliedTheme(state?.theme ?? "system");
  const codeTheme = resolvedTheme === "light" ? "pierre-light" : "pierre-dark";
  const reduceMotion = state?.reduceMotion ?? false;

  const {
    files,
    changes,
    branch,
    branches,
    sync,
    switchBranch,
    pushCommits,
    stageFiles,
    unstageFiles,
    commitChanges,
    discardFile,
    resetFiles,
    loadFiles,
    reloadFiles,
  } = useWorkspaceFiles(state?.workspacePath, setError, () =>
    state ? window.nexus.saveState(state) : Promise.resolve(),
  );

  const editor = useEditorTabs(state?.workspacePath, setError);

  const {
    leftOpen,
    setLeftOpen,
    rightOpen,
    setRightOpen,
    rightView,
    sidebarWidth,
    rightWidth,
    treeVisible,
    toggleTree,
    treeWidth,
    resizing,
    startResize,
    resizeWithKeyboard,
    splitRatio,
    startSplitResize,
    splitResizeWithKeyboard,
    resetSplit,
    toggleRight,
    togglePlan,
    openPlan,
    toggleResearch,
    openResearch,
    toggleReview,
    toggleTerminal,
  } = usePanels(() => void loadFiles(), {
    // The divider position lives in AppState so it persists across restarts.
    ratio: state?.splitRatio ?? 0.5,
    onRatioChange: (ratio) => apply(setSplitRatio(ratio)),
  });

  // Below this width the left sidebar can't dock without starving the chat, so
  // it becomes an overlay Drawer instead of a grid column.
  const isNarrow = useMediaQuery("(max-width: 767px)");
  // Crossing the breakpoint resets intent: docked-open when wide, closed when
  // narrow (so the overlay doesn't cover the chat until the user opens it).
  useEffect(() => {
    setLeftOpen(!isNarrow);
  }, [isNarrow, setLeftOpen]);

  const agent = useAgentRun({ state, setState, setError });

  const catalog = useModelCatalog();

  function resetWorkspaceView() {
    resetFiles();
    setRightOpen(false);
  }

  const { chooseWorkspace, selectSession, createSession } = useSessions(
    state,
    apply,
    resetWorkspaceView,
  );

  useEffect(() => {
    void window.nexus.loadState().then(setState);
    void window.nexus
      .health()
      .then(() => setRuntimeStatus("ready"))
      .catch(() => setRuntimeStatus("offline"));
    // Only macOS paints a native vibrancy material behind the window; gate the
    // renderer transparency on it so Windows/Linux keep an opaque background.
    document.documentElement.dataset.vibrancy =
      window.nexus.platform === "darwin" ? "on" : "off";
  }, []);

  useEffect(() => {
    if (!state) return;
    const timer = window.setTimeout(
      () => void window.nexus.saveState(state),
      350,
    );
    return () => window.clearTimeout(timer);
  }, [state]);

  // The file panel tracks the FOCUSED session's workspace. When focus moves to
  // a session in another repo while the panel is open, re-index there — after
  // flushing the state, because the main process resolves workspace IPC
  // against the persisted snapshot (the debounced save above would race).
  const workspacePath = state?.workspacePath;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run only on workspace switches; the rest is read fresh
  useEffect(() => {
    if (!workspacePath || !rightOpen || !state) return;
    let stale = false;
    void window.nexus.saveState(state).then(() => {
      if (!stale) void reloadFiles();
    });
    return () => {
      stale = true;
    };
  }, [workspacePath]);

  // Auto-open the research panel the first time a session gains a report.
  const autoOpenedResearch = useRef<Set<string>>(new Set());
  const sessionWithResearch = state?.sessions.find(
    (session) => session.id === state?.currentSessionId && session.research,
  )?.id;
  useEffect(() => {
    if (!sessionWithResearch) return;
    if (autoOpenedResearch.current.has(sessionWithResearch)) return;
    autoOpenedResearch.current.add(sessionWithResearch);
    openResearch();
  }, [sessionWithResearch, openResearch]);

  // Auto-open the plan panel the first time a session gains a plan (Plan mode).
  // Tracked per session so re-opening isn't forced after the user closes it.
  const autoOpenedPlans = useRef<Set<string>>(new Set());
  const sessionWithPlan = state?.sessions.find(
    (session) => session.id === state?.currentSessionId && session.plan,
  )?.id;
  useEffect(() => {
    if (!sessionWithPlan) return;
    if (autoOpenedPlans.current.has(sessionWithPlan)) return;
    autoOpenedPlans.current.add(sessionWithPlan);
    openPlan();
  }, [sessionWithPlan, openPlan]);

  function importSession() {
    if (!state?.workspacePath) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file
        .text()
        .then((text) => JSON.parse(text) as unknown)
        .then((value) => {
          const candidate =
            value && typeof value === "object" && "session" in value
              ? (value as { session: unknown }).session
              : value;
          return sanitizeImportedSession(candidate, state.workspacePath ?? "");
        })
        .then((session) => {
          if (!session)
            throw new Error("This is not a valid Nexus session export.");
          apply(addSession(session));
        })
        .catch((reason: unknown) =>
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not import session.",
          ),
        );
    };
    input.click();
  }

  useGlobalShortcuts(
    () => ({
      newTask: createSession,
      openSettings: () => setShowSettings(true),
      toggleLeft: () => setLeftOpen((open) => !open),
      toggleRight,
      closeOverlays: () => setShowSettings(false),
    }),
    Boolean(state),
  );

  if (!state) {
    return (
      <main className="grid h-screen place-items-center bg-background text-sm text-muted-foreground">
        Opening Nexus…
      </main>
    );
  }

  const appState = state;
  const current = appState.sessions.find(
    (session) => session.id === appState.currentSessionId,
  );
  // The side pane resolves only to a live, distinct session — a dangling or
  // duplicate id renders single-pane. Narrow windows collapse to the primary
  // pane (the id is kept, so widening restores the split).
  const sideSession = appState.sessions.find(
    (session) =>
      session.id === appState.sideSessionId && session.id !== current?.id,
  );
  const groups = groupSessions(appState);
  const hasWorkspace = Boolean(appState.workspacePath && current);
  const showSplit = Boolean(hasWorkspace && sideSession && !isNarrow);
  // Physical pane order: `sidePosition` says which side the unfocused pane
  // sits on; the focused (current) session takes the other slot.
  const paneSessions =
    showSplit && current && sideSession
      ? (appState.sidePosition ?? "right") === "left"
        ? [sideSession, current]
        : [current, sideSession]
      : current
        ? [current]
        : [];
  const workspaceName = appState.workspacePath
    ? basename(appState.workspacePath)
    : "your workspace";

  function createTaskFromResearch(prompt: string) {
    if (!state?.workspacePath) return;
    const session = newSession(state.workspacePath);
    const now = new Date().toISOString();
    session.transcript = [
      { id: createId(), kind: "user", title: "You", detail: prompt },
    ];
    session.history = [{ type: "user", text: prompt }];
    session.title = "Plan from research";
    session.approvalMode = "plan";
    session.updatedAt = now;
    apply(addSession(session));
    setRightOpen(false);
  }

  async function restoreCheckpoint() {
    const checkpoint = current?.checkpoint;
    if (!checkpoint || checkpoint.restoredAt) return;
    if (
      !window.confirm(
        `Undo this run's changes to ${checkpoint.files.length} file${checkpoint.files.length === 1 ? "" : "s"}? Files changed since the run will not be overwritten.`,
      )
    )
      return;
    try {
      await window.nexus.restoreCheckpoint(checkpoint.id);
      apply(markCheckpointRestored(current.id, new Date().toISOString()));
      await reloadFiles();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not restore checkpoint.",
      );
    }
  }

  /// Reverts a single file from the run checkpoint. The runtime refuses if the
  /// file changed since the run, so user edits are never overwritten.
  async function restoreCheckpointFile(filePath: string) {
    const checkpoint = current?.checkpoint;
    if (!checkpoint || checkpoint.restoredAt) return;
    if (
      !window.confirm(
        `Revert ${filePath} to its state before this run? It will not be overwritten if it changed since.`,
      )
    )
      return;
    try {
      await window.nexus.restoreCheckpoint(checkpoint.id, [filePath]);
      apply(
        markCheckpointFilesRestored(
          current.id,
          [filePath],
          new Date().toISOString(),
        ),
      );
      await reloadFiles();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not restore this file.",
      );
    }
  }

  const leftTrack = !isNarrow && leftOpen ? sidebarWidth : 0;
  const rightTrack = hasWorkspace && rightOpen ? rightWidth : 0;
  const columns = `${leftTrack}px minmax(0, 1fr) ${rightTrack}px`;

  // The fixed top-right toggle cluster (files + terminal always, plan/review
  // conditional) floats over whatever sits beneath it. Compute its real width
  // from the live toggle count so every neighbor (the TopBar usage meter, each
  // panel header) reserves exactly that much and no more — shared via the
  // `--corner-controls` CSS var below.
  const planShown = hasWorkspace && Boolean(current?.plan);
  const researchShown = hasWorkspace && Boolean(current?.research);
  const reviewShown = hasWorkspace;
  const rightControlsCount = hasWorkspace
    ? 2 + (planShown ? 1 : 0) + (researchShown ? 1 : 0) + (reviewShown ? 1 : 0)
    : 0;
  const rightControlsWidth =
    rightControlsCount === 0
      ? 0
      : TOGGLE_BASE + (rightControlsCount - 1) * TOGGLE_STEP + 28 + 8;

  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
      <LazyMotion features={domAnimation}>
        <TooltipProvider>
          <div
            className="app-shell grid h-screen overflow-hidden bg-background"
            style={{
              gridTemplateColumns: columns,
              transition:
                reduceMotion || resizing
                  ? undefined
                  : "grid-template-columns 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
              ["--corner-controls" as string]: `${rightControlsWidth}px`,
            }}
          >
            <AnimatePresence initial={false}>
              {!isNarrow && leftOpen && !showSettings ? (
                <LeftNav
                  key="left"
                  groups={groups}
                  activeWorkspacePath={appState.workspacePath}
                  currentSessionId={current?.id}
                  sideSessionId={sideSession?.id}
                  apply={apply}
                  onNewTask={createSession}
                  onOpenWorkspace={() => void chooseWorkspace()}
                  onImportSession={importSession}
                  onSelectSession={selectSession}
                  onOpenSettings={() => setShowSettings(true)}
                  onResizeStart={(event) => startResize("sidebar", event)}
                  onResizeKeyDown={(event) =>
                    resizeWithKeyboard("sidebar", event)
                  }
                />
              ) : null}
            </AnimatePresence>

            {isNarrow ? (
              <LeftNavDrawer
                open={leftOpen && !showSettings}
                onOpenChange={setLeftOpen}
                groups={groups}
                activeWorkspacePath={appState.workspacePath}
                currentSessionId={current?.id}
                sideSessionId={sideSession?.id}
                apply={apply}
                onNewTask={createSession}
                onOpenWorkspace={() => void chooseWorkspace()}
                onImportSession={importSession}
                onSelectSession={selectSession}
                onOpenSettings={() => setShowSettings(true)}
              />
            ) : null}

            <main
              className={`relative flex h-screen min-w-0 flex-col overflow-hidden ${
                hasWorkspace ? "bg-background" : "bg-sidebar"
              }`}
              style={{ gridColumn: 2 }}
            >
              {/* With a workspace open, each pane renders its own top bar; the
                  bare bar remains only over the Welcome screen. */}
              {!hasWorkspace ? (
                <TopBar padLeft={!leftOpen} clearRight={false} />
              ) : null}
              <div className="relative flex min-h-0 flex-1 flex-col">
                <ErrorBoundary>
                  {!hasWorkspace || !current ? (
                    <Welcome onChoose={() => void chooseWorkspace()} />
                  ) : (
                    <>
                      <div
                        data-split-row
                        className="relative flex h-full min-h-0 flex-1"
                      >
                        {paneSessions.map((paneSession, index) => (
                          <div
                            key={paneSession.id}
                            className={`h-full min-w-0 ${
                              index > 0 ? "flex-1 border-l border-border" : ""
                            }`}
                            style={
                              index === 0
                                ? {
                                    width: showSplit
                                      ? `${splitRatio * 100}%`
                                      : "100%",
                                  }
                                : undefined
                            }
                          >
                            <ChatPane
                              state={appState}
                              apply={apply}
                              session={paneSession}
                              agent={agent}
                              catalog={catalog}
                              resolvedTheme={resolvedTheme}
                              branch={branch}
                              branches={branches}
                              onSwitchBranch={(name) => {
                                editor.resetTabs();
                                void switchBranch(name);
                              }}
                              onOpenSettings={() => setShowSettings(true)}
                              focused={paneSession.id === current.id}
                              onFocusPane={
                                showSplit
                                  ? () => apply(focusSession(paneSession.id))
                                  : undefined
                              }
                              onClose={
                                showSplit
                                  ? () => apply(closeSplitPane(paneSession.id))
                                  : undefined
                              }
                              topPadLeft={index === 0 && !leftOpen}
                              topClearRight={
                                index === paneSessions.length - 1 && !rightOpen
                              }
                              files={files}
                              onEnsureFiles={loadFiles}
                            />
                          </div>
                        ))}
                        {/* Row-level divider (not inside a pane) so grabbing
                            it never moves pane focus. */}
                        {showSplit ? (
                          <button
                            type="button"
                            aria-label="Resize split"
                            style={{ left: `${splitRatio * 100}%` }}
                            className="absolute inset-y-0 z-20 w-2 -translate-x-1/2 cursor-col-resize touch-none focus-visible:bg-primary/25 focus-visible:outline-none"
                            onPointerDown={startSplitResize}
                            onKeyDown={splitResizeWithKeyboard}
                            onDoubleClick={resetSplit}
                          />
                        ) : null}
                      </div>
                      <AnimatePresence>
                        {error ? (
                          <m.div
                            key="error"
                            variants={rise}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="absolute inset-x-0 top-3 z-20 mx-auto flex w-fit items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/12 px-3 py-2 text-[12px] text-destructive shadow-lg"
                          >
                            <span className="max-w-[420px] truncate">
                              {error}
                            </span>
                            <button
                              type="button"
                              onClick={() => setError(undefined)}
                              aria-label="Dismiss error"
                              className="text-destructive/70 transition hover:text-destructive"
                            >
                              <CloseIcon size={14} />
                            </button>
                          </m.div>
                        ) : null}
                      </AnimatePresence>
                    </>
                  )}
                </ErrorBoundary>
              </div>
            </main>

            <AnimatePresence initial={false}>
              {hasWorkspace && rightOpen && rightView === "research" ? (
                <ResearchPanel
                  key="research"
                  research={current?.research}
                  onCreateTask={createTaskFromResearch}
                  onClose={() => setRightOpen(false)}
                  onResizeStart={(event) => startResize("right", event)}
                  onResizeKeyDown={(event) =>
                    resizeWithKeyboard("right", event)
                  }
                />
              ) : hasWorkspace && rightOpen && rightView === "plan" ? (
                <PlanPanel
                  key="plan"
                  plan={current?.plan}
                  onClose={() => setRightOpen(false)}
                  onResizeStart={(event) => startResize("right", event)}
                  onResizeKeyDown={(event) =>
                    resizeWithKeyboard("right", event)
                  }
                />
              ) : hasWorkspace && rightOpen && rightView === "review" ? (
                <ReviewPanel
                  key="review"
                  changes={changes}
                  onStageFiles={stageFiles}
                  onUnstageFiles={unstageFiles}
                  onCommit={commitChanges}
                  onDiscardFile={discardFile}
                  sync={sync}
                  onPush={pushCommits}
                  canRestoreCheckpoint={Boolean(
                    current?.checkpoint && !current.checkpoint.restoredAt,
                  )}
                  checkpointFiles={
                    current?.checkpoint && !current.checkpoint.restoredAt
                      ? current.checkpoint.files
                      : []
                  }
                  onRestoreCheckpoint={restoreCheckpoint}
                  onRestoreCheckpointFile={restoreCheckpointFile}
                  codeTheme={codeTheme}
                  onClose={() => setRightOpen(false)}
                  onResizeStart={(event) => startResize("right", event)}
                  onResizeKeyDown={(event) =>
                    resizeWithKeyboard("right", event)
                  }
                />
              ) : hasWorkspace &&
                rightOpen &&
                rightView === "terminal" &&
                appState.workspacePath ? (
                <TerminalPanel
                  key="terminal"
                  resolvedTheme={resolvedTheme}
                  workspacePath={appState.workspacePath}
                  onClose={() => setRightOpen(false)}
                  onResizeStart={(event) => startResize("right", event)}
                  onResizeKeyDown={(event) =>
                    resizeWithKeyboard("right", event)
                  }
                />
              ) : hasWorkspace && rightOpen ? (
                <RightPanel
                  key="right"
                  tabs={editor.tabs}
                  activeTabId={editor.activeTabId}
                  activeTab={editor.activeTab}
                  activeContent={editor.activeContent}
                  files={files}
                  changes={changes}
                  codeTheme={codeTheme}
                  workspaceName={workspaceName}
                  treeVisible={treeVisible}
                  treeWidth={treeWidth}
                  onOpenFile={editor.openFile}
                  onNewTab={editor.newTab}
                  onCloseTab={editor.closeTab}
                  onActivateTab={editor.activateTab}
                  onToggleTree={toggleTree}
                  onResizeStart={(event) => startResize("right", event)}
                  onResizeKeyDown={(event) =>
                    resizeWithKeyboard("right", event)
                  }
                  onTreeResizeStart={(event) => startResize("tree", event)}
                  onTreeResizeKeyDown={(event) =>
                    resizeWithKeyboard("tree", event)
                  }
                />
              ) : null}
            </AnimatePresence>

            {/* Panel toggles pinned to the window corners — they never move,
              whether the sidebars are open or closed. New task pairs with the
              left toggle when the sidebar is collapsed. */}
            <div className="app-no-drag fixed top-[6px] left-[84px] z-30 flex items-center gap-0.5">
              <Hint
                label={
                  leftOpen ? "Collapse sidebar (⌘B)" : "Expand sidebar (⌘B)"
                }
              >
                <button
                  type="button"
                  onClick={() => setLeftOpen((open) => !open)}
                  aria-label={leftOpen ? "Collapse sidebar" : "Expand sidebar"}
                  className="grid size-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <PanelLeftIcon size={17} />
                </button>
              </Hint>
              {!leftOpen && hasWorkspace ? (
                <Hint label="New task (⌘N)">
                  <button
                    type="button"
                    onClick={createSession}
                    aria-label="New task"
                    className="grid size-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <ComposeIcon size={17} />
                  </button>
                </Hint>
              ) : null}
            </div>
            {(() => {
              // Files toggle anchors the corner; research, plan, review and
              // terminal step leftward, each present only when it applies.
              // `planShown`/`reviewShown` are hoisted above (they also drive
              // `--corner-controls`); the slot math below is unchanged.
              const terminalShown = hasWorkspace;
              let slot = 1;
              const researchRight = TOGGLE_BASE + TOGGLE_STEP * slot;
              if (researchShown) slot += 1;
              const planRight = TOGGLE_BASE + TOGGLE_STEP * slot;
              if (planShown) slot += 1;
              const reviewRight = TOGGLE_BASE + TOGGLE_STEP * slot;
              if (reviewShown) slot += 1;
              const terminalRight = TOGGLE_BASE + TOGGLE_STEP * slot;
              const toggleBase =
                "app-no-drag fixed top-[6px] z-30 grid size-7 place-items-center rounded-lg transition";
              const active = "bg-secondary text-primary-soft";
              const idle =
                "text-muted-foreground hover:bg-accent hover:text-foreground";
              return (
                <>
                  {researchShown ? (
                    <Hint label="Toggle research report" side="left">
                      <button
                        type="button"
                        onClick={toggleResearch}
                        aria-label="Toggle research report"
                        aria-pressed={rightOpen && rightView === "research"}
                        style={{ right: researchRight }}
                        className={`${toggleBase} ${rightOpen && rightView === "research" ? active : idle}`}
                      >
                        <AiIcon size={16} />
                      </button>
                    </Hint>
                  ) : null}
                  {planShown ? (
                    <Hint label="Toggle plan" side="left">
                      <button
                        type="button"
                        onClick={togglePlan}
                        aria-label="Toggle plan"
                        aria-pressed={rightOpen && rightView === "plan"}
                        style={{ right: planRight }}
                        className={`${toggleBase} ${rightOpen && rightView === "plan" ? active : idle}`}
                      >
                        <ReviewIcon size={16} />
                      </button>
                    </Hint>
                  ) : null}
                  {hasWorkspace ? (
                    <Hint label="Review changes" side="left">
                      <button
                        type="button"
                        onClick={toggleReview}
                        aria-label="Review changes"
                        aria-pressed={rightOpen && rightView === "review"}
                        style={{ right: reviewRight }}
                        className={`${toggleBase} ${rightOpen && rightView === "review" ? active : idle}`}
                      >
                        <GitBranchIcon size={16} />
                      </button>
                    </Hint>
                  ) : null}
                  {terminalShown ? (
                    <Hint label="Toggle terminal" side="left">
                      <button
                        type="button"
                        onClick={toggleTerminal}
                        aria-label="Toggle terminal"
                        aria-pressed={rightOpen && rightView === "terminal"}
                        style={{ right: terminalRight }}
                        className={`${toggleBase} ${rightOpen && rightView === "terminal" ? active : idle}`}
                      >
                        <TerminalIcon size={16} />
                      </button>
                    </Hint>
                  ) : null}
                  {hasWorkspace ? (
                    <Hint label="Toggle panel" side="left">
                      <button
                        type="button"
                        onClick={toggleRight}
                        aria-label="Toggle panel"
                        aria-pressed={rightOpen && rightView === "files"}
                        style={{ right: TOGGLE_BASE }}
                        className={`${toggleBase} ${rightOpen && rightView === "files" ? active : idle}`}
                      >
                        <PanelRightIcon size={17} />
                      </button>
                    </Hint>
                  ) : null}
                </>
              );
            })()}

            <AnimatePresence>
              {showSettings ? (
                <SettingsScreen
                  key="settings"
                  state={appState}
                  runtimeStatus={runtimeStatus}
                  sidebarWidth={sidebarWidth}
                  apply={apply}
                  onClose={() => setShowSettings(false)}
                />
              ) : null}
            </AnimatePresence>
          </div>
        </TooltipProvider>
      </LazyMotion>
    </MotionConfig>
  );
}
