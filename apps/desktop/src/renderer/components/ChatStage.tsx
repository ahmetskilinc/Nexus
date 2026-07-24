import type { PendingApproval, Session, TranscriptItem } from "@nexus/protocol";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { popIn, rise, transitions } from "../lib/motion";
import { describeToolCall } from "../lib/toolPresentation";
import { ApprovalCard } from "./ApprovalCard";
import { BrandMark } from "./BrandMark";
import { CommandCard } from "./CommandCard";
import { BugIcon, CompassIcon, ReviewIcon, WrenchIcon } from "./Icons";
import { Markdown } from "./Markdown";
import { SubagentCard } from "./SubagentCard";
import { TodoCard } from "./TodoCard";
import { ToolCall } from "./ToolCall";
import { WorkspaceMap } from "./WorkspaceMap";

const SUGGESTIONS = [
  {
    key: "explore",
    label: "Explore and understand code",
    color: "var(--color-cat-explore)",
    prompt:
      "Give me a concise map of this codebase and its main responsibilities.",
    Icon: CompassIcon,
  },
  {
    key: "build",
    label: "Build a new feature, app, or tool",
    color: "var(--color-cat-build)",
    prompt:
      "Explore this workspace and propose an implementation plan for a new feature.",
    Icon: WrenchIcon,
  },
  {
    key: "review",
    label: "Review code and suggest changes",
    color: "var(--color-cat-review)",
    prompt:
      "Review the recent changes in this workspace and flag risks, bugs, or gaps.",
    Icon: ReviewIcon,
  },
  {
    key: "fix",
    label: "Fix issues and failures",
    color: "var(--color-cat-fix)",
    prompt: "Find the most likely source of a bug in this workspace.",
    Icon: BugIcon,
  },
] as const;

function ChatStageImpl({
  session,
  running,
  workspaceName,
  resolvedTheme,
  pendingApproval,
  onApprovalRespond,
  onApprovalAlwaysAllow,
  onSuggestion,
  onAtBottomChange,
}: {
  session?: Session;
  running: boolean;
  workspaceName: string;
  resolvedTheme: "light" | "dark";
  pendingApproval?: PendingApproval;
  onApprovalRespond: (approved: boolean) => void;
  onApprovalAlwaysAllow: () => void;
  onSuggestion: (prompt: string) => void;
  onAtBottomChange: (atBottom: boolean) => void;
}) {
  const items = session?.transcript ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [detached, setDetached] = useState(false);
  const [atTop, setTop] = useState(true);
  const reduce = useReducedMotion();
  const empty = items.length === 0;
  const lastDetail = items.at(-1)?.detail ?? "";

  function nearBottom() {
    const node = scrollRef.current;
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }

  const setAtBottom = useCallback(
    (atBottom: boolean) => {
      stickRef.current = atBottom;
      setDetached(!atBottom);
      onAtBottomChange(atBottom);
    },
    [onAtBottomChange],
  );

  function onScroll() {
    setAtBottom(nearBottom());
    setTop((scrollRef.current?.scrollTop ?? 0) < 16);
  }

  const scrollToBottom = useCallback(
    (smooth: boolean) => {
      const node = scrollRef.current;
      if (!node) return;
      node.scrollTo({
        top: node.scrollHeight,
        behavior: smooth && !reduce ? "smooth" : "auto",
      });
      setAtBottom(true);
      setTop(node.scrollTop < 16);
    },
    [reduce, setAtBottom],
  );

  // Auto-follow only when the user is already parked near the bottom; never yank
  // them down while they're reading scrollback. Instant during streaming (many
  // updates) so we don't fight a moving target. items.length/running/lastDetail
  // are intentional re-run triggers (not read in the body); `scrollToBottom` is
  // included so the closure over `reduce` can never go stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: content deps are deliberate re-run triggers
  useEffect(() => {
    if (stickRef.current) scrollToBottom(false);
  }, [
    items.length,
    running,
    lastDetail,
    Boolean(pendingApproval),
    scrollToBottom,
  ]);

  return (
    <div className="relative min-h-0 flex-1">
      {/* Overlay scrollbar (Base UI): floats above the content instead of
          consuming layout width, so the transcript column and the composer
          can center on the same axis with no scrollbar compensation. */}
      <ScrollArea
        className="h-full"
        viewportRef={scrollRef}
        onViewportScroll={onScroll}
      >
        {empty ? (
          <>
            <EmptyState
              workspaceName={workspaceName}
              onSuggestion={onSuggestion}
            />
            {session ? <WorkspaceMap /> : null}
          </>
        ) : (
          <div className="mx-auto w-full max-w-[760px] px-6 pt-4 pb-52">
            {items.map((item, index) => (
              <Message
                item={item}
                key={item.id}
                resolvedTheme={resolvedTheme}
                streaming={
                  running &&
                  index === items.length - 1 &&
                  item.kind === "assistant"
                }
              />
            ))}
            {pendingApproval ? (
              <ApprovalCard
                approval={pendingApproval}
                onRespond={onApprovalRespond}
                onAlwaysAllow={onApprovalAlwaysAllow}
              />
            ) : null}
            {running &&
            !pendingApproval &&
            items.at(-1)?.kind !== "assistant" ? (
              <WorkingIndicator />
            ) : null}
          </div>
        )}
      </ScrollArea>

      {/* Scroll fade: softens messages passing behind the top bar, hidden when
          scrolled to the top so the first message stays crisp. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-background via-background/80 to-transparent transition-opacity duration-200 ${
          atTop ? "opacity-0" : "opacity-100"
        }`}
      />

      <AnimatePresence>
        {detached ? (
          <m.button
            type="button"
            key="jump"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={transitions.fast}
            onClick={() => scrollToBottom(true)}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "absolute bottom-40 left-1/2 -translate-x-1/2 bg-secondary text-[12px] text-muted-foreground shadow-lg hover:text-foreground",
            )}
          >
            Jump to latest
          </m.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// Memoized: on a composer keystroke, App re-renders but ChatStage's props are
// referentially stable, so this boundary skips re-rendering the whole transcript.
export const ChatStage = memo(ChatStageImpl);

function EmptyState({
  workspaceName,
  onSuggestion,
}: {
  workspaceName: string;
  onSuggestion: (prompt: string) => void;
}) {
  return (
    <div className="mx-auto flex min-h-full max-w-[760px] flex-col items-center justify-center px-6 pt-16 pb-[220px] text-center">
      <m.span
        variants={popIn}
        initial="initial"
        animate="animate"
        className="drop-shadow-[0_10px_26px_rgba(255,110,70,0.4)]"
      >
        <BrandMark size={48} />
      </m.span>
      <h1 className="mt-8 text-[29px] leading-[1.15] font-semibold tracking-[-0.03em] text-foreground text-balance">
        What should we build in{" "}
        <span className="underline decoration-1 decoration-[color:var(--color-faint)] underline-offset-[6px]">
          {workspaceName}
        </span>
        ?
      </h1>
      <div className="@container mt-10 w-full">
        <div className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
          {SUGGESTIONS.map(({ key, label, color, prompt, Icon }, index) => (
            <m.button
              type="button"
              key={key}
              onClick={() => onSuggestion(prompt)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...transitions.base, delay: index * 0.055 }}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              className="flex min-h-[128px] flex-col justify-between gap-5 rounded-lg border border-border bg-card/70 p-4 text-left transition-colors hover:border-primary-dim hover:bg-secondary"
            >
              <Icon size={20} color={color} />
              <span className="text-[13px] leading-snug font-medium text-foreground">
                {label}
              </span>
            </m.button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Message({
  item,
  resolvedTheme,
  streaming,
}: {
  item: TranscriptItem;
  resolvedTheme: "light" | "dark";
  streaming: boolean;
}) {
  if (item.kind === "user")
    return (
      <m.div
        variants={rise}
        initial="initial"
        animate="animate"
        className="mb-6 flex justify-end"
      >
        <div className="max-w-[78%] rounded-2xl rounded-br-md border border-border bg-card px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-foreground">
          {item.detail}
        </div>
      </m.div>
    );

  if (item.kind === "tool") {
    const card = describeToolCall(item).card;
    if (card === "command") return <CommandCard item={item} />;
    if (card === "todo") return <TodoCard item={item} />;
    if (card === "subagent") return <SubagentCard item={item} />;
    return <ToolCall item={item} />;
  }

  if (item.kind === "error")
    return (
      <m.div
        variants={rise}
        initial="initial"
        animate="animate"
        className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3"
      >
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-destructive uppercase">
          {item.title}
        </div>
        <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">
          {item.detail}
        </div>
      </m.div>
    );

  if (item.kind === "info")
    return (
      <m.div
        variants={rise}
        initial="initial"
        animate="animate"
        className="mb-5 text-[12px] text-muted-foreground"
      >
        {item.detail}
      </m.div>
    );

  return (
    <m.div variants={rise} initial="initial" animate="animate" className="mb-6">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-faint">
        <BrandMark size={16} />
        Nexus
      </div>
      <Markdown
        content={item.detail}
        resolvedTheme={resolvedTheme}
        highlight={!streaming}
      />
      {item.result ? (
        <pre className="scrollbar-thin mt-3 max-h-56 overflow-auto rounded-md bg-panel p-3 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
          {item.result}
        </pre>
      ) : null}
    </m.div>
  );
}

function WorkingIndicator() {
  return (
    <div className="mb-6 flex items-center gap-2.5">
      <m.span
        className="size-2.5 rounded-full bg-primary"
        animate={{ opacity: [1, 0.35, 1] }}
        transition={{
          duration: 1.4,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      />
      <m.span
        className="text-[13px] font-medium text-muted-foreground"
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{
          duration: 1.6,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      >
        Nexus is working
      </m.span>
    </div>
  );
}
