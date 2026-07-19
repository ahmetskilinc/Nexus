import type { AppState, Session } from "@nexus/protocol";
import { useState } from "react";
import type { AgentRunApi } from "../hooks/useAgentRun";
import {
  type ModelCatalog,
  modelSelectionFor,
} from "../hooks/useModelSelection";
import { basename } from "../lib/format";
import { type AppOp, setApprovalMode } from "../lib/ops";
import { ChatStage } from "./ChatStage";
import { Composer } from "./Composer";
import { TopBar } from "./TopBar";

/// One self-contained chat column: transcript + composer bound to a single
/// session, with its own prompt and scroll state. The split view renders two
/// of these; each drives its own agent run through the session-scoped
/// `AgentRunApi`.
export function ChatPane({
  state,
  apply,
  session,
  agent,
  catalog,
  resolvedTheme,
  branch,
  branches,
  onSwitchBranch,
  onOpenSettings,
  focused,
  onFocusPane,
  onClose,
  topPadLeft,
  topClearRight,
  files,
  onEnsureFiles,
}: {
  state: AppState;
  apply: (op: AppOp) => void;
  session: Session;
  agent: AgentRunApi;
  catalog: ModelCatalog;
  resolvedTheme: "light" | "dark";
  branch?: string;
  branches: string[];
  onSwitchBranch: (name: string) => void;
  onOpenSettings: () => void;
  /// Workspace file index for @-mention autocomplete, with a lazy loader.
  files: string[];
  onEnsureFiles: () => void;
  /// Whether this pane holds the focused (current) session.
  focused: boolean;
  /// Split only: pointer-down anywhere in the pane moves focus here.
  onFocusPane?: () => void;
  /// Split only: close this pane from its top bar.
  onClose?: () => void;
  /// Whether this pane's top bar must clear the fixed corner controls
  /// (leftmost pane, sidebar collapsed) / the right-panel toggle (rightmost
  /// pane, panel closed).
  topPadLeft: boolean;
  topClearRight: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [atBottom, setAtBottom] = useState(true);

  const running = agent.isRunning(session.id);
  const models = modelSelectionFor(state, apply, session.id, catalog);
  const workspaceName = basename(session.workspacePath);
  // Branch state belongs to the active workspace; a cross-project side pane
  // hides the branch switcher rather than showing another repo's branches.
  const sameWorkspace = session.workspacePath === state.workspacePath;

  function send() {
    if (agent.send(session.id, prompt, attachments)) {
      setPrompt("");
      setAttachments([]);
    }
  }

  const canRetry = Boolean(
    !running &&
      session.transcript.at(-1) &&
      ["error", "info"].includes(session.transcript.at(-1)?.kind ?? ""),
  );

  function retry() {
    const lastUser = [...session.history]
      .reverse()
      .find((message) => message.type === "user");
    if (lastUser?.type === "user") setPrompt(lastUser.text);
  }

  return (
    // Capture-phase so a click anywhere (transcript, composer, menus) focuses
    // the pane before it does anything else; the op no-ops when already
    // focused.
    <div
      className="relative flex h-full min-w-0 flex-1 flex-col"
      onPointerDownCapture={onFocusPane}
    >
      <TopBar
        session={session}
        focused={focused}
        onClose={onClose}
        padLeft={topPadLeft}
        clearRight={topClearRight}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ChatStage
          key={session.id}
          session={session}
          running={running}
          workspaceName={workspaceName}
          resolvedTheme={resolvedTheme}
          pendingApproval={agent.pendingApprovalFor(session.id)}
          onApprovalRespond={(approved) =>
            agent.respondToApproval(session.id, approved)
          }
          onApprovalAlwaysAllow={() => agent.alwaysAllowCommand(session.id)}
          onSuggestion={setPrompt}
          onAtBottomChange={setAtBottom}
        />
        {canRetry ? (
          <button
            type="button"
            onClick={retry}
            className="absolute right-7 bottom-36 z-20 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm hover:text-foreground"
          >
            Retry last prompt
          </button>
        ) : null}
        <Composer
          prompt={prompt}
          onPromptChange={setPrompt}
          onSend={send}
          onCancel={() => agent.cancel(session.id)}
          running={running}
          models={models}
          approvalMode={session.approvalMode ?? "ask"}
          onSetApprovalMode={(mode) =>
            apply(setApprovalMode(session.id, mode, new Date().toISOString()))
          }
          onOpenSettings={onOpenSettings}
          workspaceName={workspaceName}
          branch={sameWorkspace ? branch : undefined}
          branches={sameWorkspace ? branches : []}
          onSwitchBranch={onSwitchBranch}
          atBottom={atBottom}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          files={files}
          onEnsureFiles={onEnsureFiles}
        />
      </div>
    </div>
  );
}
