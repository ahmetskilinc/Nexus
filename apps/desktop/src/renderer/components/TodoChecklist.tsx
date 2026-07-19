import type { TodoItem } from "@nexus/protocol";
import { CheckIcon } from "./Icons";

/// The presentational checklist shared by the inline `TodoCard` and the plan
/// panel. Renders a header with a done/total count and the list itself;
/// completed items are ticked and struck through, the in-progress item accented.
export function TodoChecklist({ todos }: { todos: TodoItem[] }) {
  const done = todos.filter((todo) => todo.status === "completed").length;
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border-soft px-3 py-2">
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary/10 text-primary-soft">
          <CheckIcon size={13} />
        </span>
        <span className="text-[12px] font-medium text-foreground">
          Task list
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-faint">
          {done}/{todos.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1 px-3 py-2.5">
        {todos.map((todo) => (
          <li
            key={todo.content}
            className="flex items-start gap-2 text-[12px] leading-relaxed"
          >
            <Marker status={todo.status} />
            <span
              className={
                todo.status === "completed"
                  ? "text-faint line-through"
                  : todo.status === "in_progress"
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
              }
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Marker({ status }: { status: TodoItem["status"] }) {
  if (status === "completed")
    return (
      <span className="mt-[3px] grid size-3.5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
        <CheckIcon size={9} />
      </span>
    );
  if (status === "in_progress")
    return (
      <span className="mt-[3px] grid size-3.5 shrink-0 place-items-center rounded-full border-[1.5px] border-primary">
        <span className="size-1.5 rounded-full bg-primary" />
      </span>
    );
  return (
    <span className="mt-[3px] size-3.5 shrink-0 rounded-full border-[1.5px] border-border" />
  );
}
