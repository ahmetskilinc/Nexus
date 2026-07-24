import { Menu } from "@base-ui/react/menu";
import type { ApprovalMode, EphemeralImage, Session } from "@nexus/protocol";
import { m } from "motion/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ModelSelection } from "../hooks/useModelSelection";
import { basename } from "../lib/format";
import { BranchMenu } from "./BranchMenu";
import { CompactButton } from "./ContextMeter";
import {
  CheckIcon,
  ChevronUpIcon,
  CloseIcon,
  FileIcon,
  FolderIcon,
  StopIcon,
  UploadIcon,
} from "./Icons";
import { MentionMenu } from "./MentionMenu";
import { ModelEffortMenu } from "./ModelEffortMenu";

/// Longest @-mention suggestion list shown at once.
const MAX_MENTION_SUGGESTIONS = 8;
const MAX_DROPPED_TEXT_BYTES = 64 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TEXT_FILE_EXTENSIONS = new Set([
  "txt",
  "log",
  "md",
  "json",
  "yaml",
  "yml",
  "xml",
  "csv",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "rs",
  "go",
  "java",
  "kt",
  "swift",
  "sh",
  "toml",
  "ini",
]);

/// Detects an in-progress @-mention immediately before the caret: an `@` at the
/// start or after whitespace, followed by non-space, non-`@` query characters.
/// Returns the query and the `@`'s index, or null when the caret isn't in one.
export function mentionAt(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[1];
  return { query, start: caret - query.length - 1 };
}

/// The three agent modes shown in the composer's mode menu. `dot` tints the
/// status indicator; `label` is the trigger/menu text.
const MODES: {
  value: ApprovalMode;
  label: string;
  dot: string;
  hint: string;
}[] = [
  {
    value: "ask",
    label: "Approve edits",
    dot: "bg-warning",
    hint: "File edits require your approval before they apply.",
  },
  {
    value: "auto",
    label: "Auto-apply edits",
    dot: "bg-positive",
    hint: "File edits apply automatically, without asking.",
  },
  {
    value: "research",
    label: "Deep research",
    dot: "bg-primary-soft",
    hint: "Investigates the codebase deeply and publishes a read-only report.",
  },
  {
    value: "plan",
    label: "Plan mode",
    dot: "bg-primary",
    hint: "The agent researches, publishes a feature plan, then carries it out.",
  },
];

const MODE_MENU_POPUP =
  "z-50 w-56 origin-[var(--transform-origin)] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-[var(--shadow-pop)] outline-none transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0";
const MODE_MENU_ITEM =
  "flex w-full cursor-pointer items-start gap-2 px-3 py-1.5 text-left text-[12px] text-muted-foreground outline-none data-[highlighted]:bg-accent data-[highlighted]:text-foreground";

export function Composer({
  prompt,
  onPromptChange,
  onSend,
  onCancel,
  running,
  models,
  approvalMode,
  onSetApprovalMode,
  onOpenSettings,
  workspaceName,
  branch,
  branches,
  onSwitchBranch,
  onCreateBranch,
  onDeleteBranch,
  onRenameBranch,
  atBottom,
  attachments,
  onAttachmentsChange,
  images,
  onImagesChange,
  files,
  onEnsureFiles,
  session,
  onCompact,
  compacting,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  running: boolean;
  models: ModelSelection;
  approvalMode: ApprovalMode;
  onSetApprovalMode: (mode: ApprovalMode) => void;
  onOpenSettings: () => void;
  workspaceName: string;
  branch?: string;
  branches: string[];
  onSwitchBranch: (name: string) => void;
  onCreateBranch: (name: string) => Promise<boolean>;
  onDeleteBranch: (name: string) => Promise<boolean>;
  onRenameBranch: (from: string, to: string) => Promise<boolean>;
  atBottom: boolean;
  /// Workspace-relative paths attached via @-mentions, shown as chips.
  attachments: string[];
  onAttachmentsChange: (next: string[]) => void;
  /// Image bytes stay in this draft and are sent only with its first request.
  images: EphemeralImage[];
  onImagesChange: (next: EphemeralImage[]) => void;
  /// Workspace file index the @-mention menu autocompletes over.
  files: string[];
  /// Lazily populate `files` when the mention menu first opens.
  onEnsureFiles: () => void;
  /// The session this composer drives, for the compact button's token count.
  session: Session;
  /// Compact the conversation now (also reachable by typing `/compact`).
  onCompact: () => void;
  compacting: boolean;
}) {
  const hasProviders = models.providers.length > 0;
  const canSend =
    (Boolean(prompt.trim()) || attachments.length > 0) &&
    Boolean(models.currentModel) &&
    !running;
  const activeMode =
    MODES.find((mode) => mode.value === approvalMode) ?? MODES[0];
  const draftTokens = Math.ceil(prompt.length / 4);
  const context = session.context;
  const projectedContext = context
    ? context.usedTokens + draftTokens
    : undefined;
  const contextPercent =
    context && projectedContext
      ? Math.round((projectedContext / context.contextTokens) * 100)
      : undefined;

  // @-mention autocomplete: the active query (or null) plus the highlighted
  // suggestion. Detection runs on every change against the caret position.
  const [mention, setMention] = useState<{
    query: string;
    start: number;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLowerCase();
    return files
      .filter((path) => !attachments.includes(path))
      .filter((path) => path.toLowerCase().includes(query))
      .slice(0, MAX_MENTION_SUGGESTIONS);
  }, [mention, files, attachments]);
  const menuOpen = mention !== null && suggestions.length > 0;

  function updateMention(value: string, caret: number) {
    const next = mentionAt(value, caret);
    setMention(next);
    setActiveIndex(0);
    if (next) onEnsureFiles();
  }

  function updateChange(value: string, caret: number) {
    onPromptChange(value);
    updateMention(value, caret);
  }

  function pickSuggestion(path: string) {
    if (!mention) return;
    // Drop the "@query" token from the prompt; keep the surrounding text.
    const before = prompt.slice(0, mention.start);
    const after = prompt.slice(mention.start + 1 + mention.query.length);
    onPromptChange(`${before}${after}`);
    if (!attachments.includes(path))
      onAttachmentsChange([...attachments, path]);
    setMention(null);
  }

  function removeAttachment(path: string) {
    onAttachmentsChange(attachments.filter((item) => item !== path));
  }

  async function ingestDroppedText(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
    if (!file.type.startsWith("text/") && !TEXT_FILE_EXTENSIONS.has(extension))
      return;
    const text = await file.text();
    const limited = text.slice(0, MAX_DROPPED_TEXT_BYTES);
    const suffix =
      text.length > limited.length ? "\n[Attachment truncated]" : "";
    const block = `Context from dropped file ${file.name}:\n\n\`\`\`\n${limited}${suffix}\n\`\`\``;
    onPromptChange(prompt ? `${prompt}\n\n${block}` : block);
  }

  async function ingestImages(files: FileList | null) {
    const candidates = Array.from(files ?? []).filter(
      (file) => IMAGE_TYPES.has(file.type) && file.size <= MAX_IMAGE_BYTES,
    );
    const available = MAX_IMAGES - images.length;
    const next = await Promise.all(
      candidates.slice(0, Math.max(0, available)).map(
        (file) =>
          new Promise<EphemeralImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                name: file.name,
                mediaType: file.type as EphemeralImage["mediaType"],
                dataUrl: String(reader.result),
                size: file.size,
              });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          }),
      ),
    );
    if (next.length > 0) onImagesChange([...images, ...next]);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    // The mention menu owns the arrow/enter/escape keys while it is open.
    if (menuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (index) => (index - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pickSuggestion(suggestions[activeIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    // The transcript's overlay scrollbar (ui/scroll-area) consumes no layout
    // width, so the composer spans the full stage and centers on the same
    // axis as the transcript column.
    <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-10">
      {/* Scroll fade: softens messages passing behind the composer, but hides
          when parked at the bottom so the last message stays crisp. */}
      <div
        className={`pointer-events-none h-16 bg-gradient-to-t from-background via-background/80 to-transparent transition-opacity duration-200 ${
          atBottom ? "opacity-0" : "opacity-100"
        }`}
      />
      <div className="pointer-events-auto bg-background px-6 pb-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSend) onSend();
          }}
          className="mx-auto w-full max-w-[760px] rounded-[18px] border border-border bg-panel p-1.5 shadow-[var(--shadow-float)] transition focus-within:border-primary-dim"
        >
          {/* Context chips sit on the outer "shelf" (bg-panel); the input box
              below is raised (bg-composer) — a two-tier composer like Codex. */}
          <div className="flex items-center gap-3.5 px-2.5 pt-1.5 pb-2 text-[12px]">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <FolderIcon size={13} className="text-muted-foreground" />
              {workspaceName}
            </span>
            {branch ? (
              <BranchMenu
                branch={branch}
                branches={branches}
                onSwitch={onSwitchBranch}
                onCreate={onCreateBranch}
                onDelete={onDeleteBranch}
                onRename={onRenameBranch}
              />
            ) : null}
            <Menu.Root>
              <Menu.Trigger
                render={
                  <Button
                    variant="outline"
                    size="xs"
                    className="app-no-drag ml-auto gap-1.5 rounded-md text-[12px] font-medium text-muted-foreground hover:text-foreground"
                  />
                }
              >
                <span className={`size-1.5 rounded-full ${activeMode.dot}`} />
                {activeMode.label}
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner
                  side="top"
                  align="end"
                  sideOffset={6}
                  className="z-50"
                >
                  <Menu.Popup className={MODE_MENU_POPUP}>
                    {MODES.map((mode) => (
                      <Menu.Item
                        key={mode.value}
                        closeOnClick
                        className={MODE_MENU_ITEM}
                        onClick={() => onSetApprovalMode(mode.value)}
                      >
                        <span
                          className={`mt-1 size-1.5 shrink-0 rounded-full ${mode.dot}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 font-medium text-foreground">
                            {mode.label}
                            {mode.value === approvalMode ? (
                              <CheckIcon
                                size={12}
                                className="text-primary-soft"
                              />
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                            {mode.hint}
                          </span>
                        </span>
                      </Menu.Item>
                    ))}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </div>

          <div className="relative rounded-xl bg-composer">
            {menuOpen ? (
              <MentionMenu
                items={suggestions}
                activeIndex={activeIndex}
                onSelect={pickSuggestion}
                onHover={setActiveIndex}
              />
            ) : null}

            {/* @-mentioned workspace files plus ephemeral provider-bound images. */}
            {attachments.length > 0 || images.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                {images.map((image) => (
                  <span
                    key={`${image.name}-${image.size}`}
                    className="flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 py-1 pr-1 pl-2 text-[11px] text-foreground"
                  >
                    <img
                      src={image.dataUrl}
                      alt=""
                      className="size-5 rounded-sm object-cover"
                    />
                    {image.name}
                    <button
                      type="button"
                      aria-label={`Remove ${image.name}`}
                      onClick={() =>
                        onImagesChange(images.filter((item) => item !== image))
                      }
                      className="grid size-4 place-items-center rounded text-faint transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <CloseIcon size={10} />
                    </button>
                  </span>
                ))}
                {attachments.map((path) => (
                  <span
                    key={path}
                    className="flex items-center gap-1.5 rounded-md border border-border-soft bg-panel py-1 pr-1 pl-2 text-[11px] text-foreground"
                  >
                    <FileIcon size={11} className="text-muted-foreground" />
                    {basename(path)}
                    <button
                      type="button"
                      aria-label={`Remove ${path}`}
                      onClick={() => removeAttachment(path)}
                      className="grid size-4 place-items-center rounded text-faint transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <CloseIcon size={10} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            {/* The two-tier composer shell owns all chrome, so the ui/textarea
                is stripped back to a bare field: no border, ring, or fill. */}
            <Textarea
              value={prompt}
              onChange={(event) =>
                updateChange(
                  event.target.value,
                  event.target.selectionStart ?? event.target.value.length,
                )
              }
              onKeyUp={(event) =>
                updateMention(
                  event.currentTarget.value,
                  event.currentTarget.selectionStart ?? 0,
                )
              }
              onClick={(event) =>
                updateMention(
                  event.currentTarget.value,
                  event.currentTarget.selectionStart ?? 0,
                )
              }
              onBlur={() => setMention(null)}
              onDrop={(event) => {
                event.preventDefault();
                const dropped = event.dataTransfer.files;
                if (
                  Array.from(dropped).some((file) => IMAGE_TYPES.has(file.type))
                )
                  void ingestImages(dropped);
                else void ingestDroppedText(dropped);
              }}
              onDragOver={(event) => event.preventDefault()}
              onKeyDown={onKeyDown}
              disabled={!hasProviders || running}
              rows={2}
              placeholder={
                hasProviders
                  ? "Describe a task, or @ to attach a file…"
                  : "Connect a provider to begin"
              }
              className="scrollbar-thin field-sizing-content max-h-[min(18rem,40vh)] min-h-[72px] resize-none rounded-none border-0 bg-transparent px-3.5 py-3 text-[14px] leading-relaxed text-foreground placeholder:text-faint focus-visible:ring-0 disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-60 md:text-[14px] dark:bg-transparent dark:disabled:bg-transparent"
            />

            <div className="flex items-center justify-between px-2.5 pb-2.5 pt-0.5">
              <div className="flex min-w-0 items-center gap-1">
                <label
                  title={
                    models.supportsImages
                      ? "Attach PNG, JPEG, or WebP (up to 4 × 5 MB)"
                      : "Select an image-capable model to attach images"
                  }
                  className="grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40"
                >
                  <UploadIcon size={14} />
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    disabled={
                      !models.supportsImages ||
                      running ||
                      images.length >= MAX_IMAGES
                    }
                    onChange={(event) => {
                      void ingestImages(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                    className="sr-only"
                  />
                </label>
                {contextPercent !== undefined ? (
                  <span
                    title="Estimated context after sending this draft"
                    className={`font-mono text-[10px] tabular-nums ${
                      contextPercent >= 90
                        ? "text-destructive"
                        : contextPercent >= 70
                          ? "text-warning"
                          : "text-faint"
                    }`}
                  >
                    ~{contextPercent}%
                  </span>
                ) : null}
                <ModelEffortMenu
                  selection={models}
                  onOpenSettings={onOpenSettings}
                />
                <CompactButton
                  session={session}
                  onCompact={onCompact}
                  compacting={compacting}
                  disabled={running}
                />
              </div>

              {images.length > 0 ? (
                <span className="mr-2 text-right text-[10px] leading-tight text-muted-foreground">
                  Sent directly to the provider once.
                  <br />
                  Not saved or retried.
                </span>
              ) : null}
              {running ? (
                <m.button
                  type="button"
                  onClick={onCancel}
                  aria-label="Stop"
                  whileTap={{ scale: 0.94 }}
                  transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                  className="grid size-8 place-items-center rounded-full bg-destructive/15 text-destructive transition-colors hover:bg-destructive/25"
                >
                  <StopIcon size={13} />
                </m.button>
              ) : (
                <m.button
                  type="submit"
                  disabled={!canSend}
                  aria-label="Send"
                  whileTap={{ scale: 0.94 }}
                  transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                  className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary-soft disabled:bg-secondary disabled:text-faint"
                >
                  <ChevronUpIcon size={16} strokeWidth={2.2} />
                </m.button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
