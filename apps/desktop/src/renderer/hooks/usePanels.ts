import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useState,
} from "react";

type ResizeSide = "sidebar" | "right" | "tree";

/// Owns the left/right panel open state, widths, resize interactions, and the
/// right panel's inner editor↔tree split (visibility + width). `onOpenFiles` is
/// invoked when the right panel is revealed so the caller can lazily index.
/// The chat split ratio is caller-owned (persisted in AppState so the divider
/// position survives restarts); this hook only drives its interactions.
export function usePanels(
  onOpenFiles: () => void,
  split: { ratio: number; onRatioChange: (ratio: number) => void },
) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  // The right column hosts either the file/diff viewer or the plan artifact.
  const [rightView, setRightView] = useState<
    "files" | "plan" | "research" | "review" | "terminal"
  >("files");
  const [sidebarWidth, setSidebarWidth] = useState(268);
  const [rightWidth, setRightWidth] = useState(420);
  const [treeVisible, setTreeVisible] = useState(true);
  const [treeWidth, setTreeWidth] = useState(260);
  const [resizing, setResizing] = useState(false);
  const splitRatio = split.ratio;
  const setSplitRatio = split.onRatioChange;

  // Keep at least this much room for the middle (chat) column.
  const MIN_CHAT = 360;

  // Re-fit the right panel when the left sidebar opens/resizes, so re-showing
  // the sidebar can't push the chat below its minimum.
  useEffect(() => {
    setRightWidth((width) => {
      const max = Math.max(
        320,
        window.innerWidth - (leftOpen ? sidebarWidth : 0) - MIN_CHAT,
      );
      return Math.min(width, max);
    });
  }, [leftOpen, sidebarWidth]);

  function clamp(side: ResizeSide, width: number) {
    if (side === "sidebar") return Math.max(220, Math.min(420, width));
    if (side === "right") {
      // The right panel may grow to fill whatever the window has spare after
      // the chat's minimum and the left sidebar (only when it's open) — so it
      // opens further, and further still when the left sidebar is collapsed.
      const max = Math.max(
        320,
        window.innerWidth - (leftOpen ? sidebarWidth : 0) - MIN_CHAT,
      );
      return Math.max(320, Math.min(max, width));
    }
    return Math.max(200, Math.min(480, width));
  }

  function apply(side: ResizeSide, width: number) {
    const next = clamp(side, width);
    if (side === "sidebar") setSidebarWidth(next);
    else if (side === "right") setRightWidth(next);
    else setTreeWidth(next);
  }

  function startResize(
    side: ResizeSide,
    event: ReactPointerEvent<HTMLElement>,
  ) {
    event.preventDefault();
    setResizing(true);
    const startX = event.clientX;
    const startWidth =
      side === "sidebar"
        ? sidebarWidth
        : side === "right"
          ? rightWidth
          : treeWidth;
    const update = (move: PointerEvent) => {
      const delta = move.clientX - startX;
      // The sidebar grows rightward; the right panel and the tree grow leftward.
      apply(side, side === "sidebar" ? startWidth + delta : startWidth - delta);
    };
    const stop = () => {
      setResizing(false);
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", stop);
  }

  function resizeWithKeyboard(
    side: ResizeSide,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 16 : -16;
    const current =
      side === "sidebar"
        ? sidebarWidth
        : side === "right"
          ? rightWidth
          : treeWidth;
    apply(side, side === "sidebar" ? current + step : current - step);
  }

  const clampRatio = (ratio: number) => Math.max(0.3, Math.min(0.7, ratio));

  /// Drag the split-view divider. Ratio-based (not px) so window resizes keep
  /// both panes proportional; the enclosing pane row carries [data-split-row].
  function startSplitResize(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    setResizing(true);
    const width =
      event.currentTarget.closest("[data-split-row]")?.clientWidth ||
      window.innerWidth;
    const startX = event.clientX;
    const startRatio = splitRatio;
    const update = (move: PointerEvent) =>
      setSplitRatio(clampRatio(startRatio + (move.clientX - startX) / width));
    const stop = () => {
      setResizing(false);
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", stop);
  }

  function splitResizeWithKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 0.03 : -0.03;
    setSplitRatio(clampRatio(splitRatio + step));
  }

  /// Double-clicking the divider evens the panes out.
  const resetSplit = () => setSplitRatio(0.5);

  /// Toggle the file/diff viewer. If the plan artifact currently occupies the
  /// right column, switch to files instead of closing.
  function toggleRight() {
    if (rightOpen && rightView === "files") {
      setRightOpen(false);
      return;
    }
    setRightView("files");
    setRightOpen(true);
    onOpenFiles();
  }

  // Plan and research documents read best wider than the default file/diff
  // column. Opening one grows the panel toward this width — never shrinks a
  // wider one, and the user can still resize down to the usual minimum.
  const ARTIFACT_WIDTH = 560;
  const widenForArtifact = () =>
    setRightWidth((width) => clamp("right", Math.max(width, ARTIFACT_WIDTH)));

  /// Toggle the plan artifact in the right column.
  function togglePlan() {
    if (rightOpen && rightView === "plan") {
      setRightOpen(false);
      return;
    }
    setRightView("plan");
    setRightOpen(true);
    widenForArtifact();
  }

  /// Reveal the plan artifact (used to auto-open when a plan first arrives).
  function openPlan() {
    setRightView("plan");
    setRightOpen(true);
    widenForArtifact();
  }

  /// Toggle the read-only research artifact in the right column.
  function toggleResearch() {
    if (rightOpen && rightView === "research") {
      setRightOpen(false);
      return;
    }
    setRightView("research");
    setRightOpen(true);
    widenForArtifact();
  }

  /// Reveal the research artifact when a report first arrives.
  function openResearch() {
    setRightView("research");
    setRightOpen(true);
    widenForArtifact();
  }

  /// Toggle the session-changes review in the right column.
  function toggleReview() {
    if (rightOpen && rightView === "review") {
      setRightOpen(false);
      return;
    }
    setRightView("review");
    setRightOpen(true);
    onOpenFiles();
  }

  /// Toggle the embedded terminal in the right column.
  function toggleTerminal() {
    if (rightOpen && rightView === "terminal") {
      setRightOpen(false);
      return;
    }
    setRightView("terminal");
    setRightOpen(true);
  }

  return {
    leftOpen,
    setLeftOpen,
    rightOpen,
    setRightOpen,
    rightView,
    sidebarWidth,
    rightWidth,
    treeVisible,
    toggleTree: () => setTreeVisible((value) => !value),
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
  };
}
