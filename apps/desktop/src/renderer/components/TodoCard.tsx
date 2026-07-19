import type { TranscriptItem } from "@nexus/protocol";
import { m } from "motion/react";
import { useMemo } from "react";
import { rise } from "../lib/motion";
import { parseTodos } from "../lib/toolPresentation";
import { TodoChecklist } from "./TodoChecklist";
import { ToolCard } from "./ToolCard";

/// Renders a todo_write call as a live checklist. Completed items are ticked and
/// struck through; the in-progress item is accented so the current focus is
/// obvious at a glance.
export function TodoCard({ item }: { item: TranscriptItem }) {
  const todos = useMemo(() => parseTodos(item.args), [item.args]);
  if (todos.length === 0) return null;

  return (
    <m.div
      variants={rise}
      initial="initial"
      animate="animate"
      className="mb-2.5"
    >
      <ToolCard>
        <TodoChecklist todos={todos} />
      </ToolCard>
    </m.div>
  );
}
