import type { PendingApproval } from "@nexus/protocol";
import { m } from "motion/react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { diffLines, foldContext } from "../lib/diff";
import { rise } from "../lib/motion";
import { approvalToolLabel, commandProgram } from "../lib/toolPresentation";
import { ToolCard } from "./ToolCard";

/// The approval shell: the shared tool-card surface, promoted with the coral
/// border + float shadow that mark "the run is paused on you".
const SHELL =
  "rounded-xl border-primary-dim bg-card/70 shadow-[var(--shadow-float)]";

export function ApprovalCard({
  approval,
  onRespond,
  onAlwaysAllow,
}: {
  approval: PendingApproval;
  onRespond: (approved: boolean) => void;
  onAlwaysAllow: () => void;
}) {
  if (approval.kind === "command") {
    return (
      <CommandApproval
        approval={approval}
        onRespond={onRespond}
        onAlwaysAllow={onAlwaysAllow}
      />
    );
  }
  if (approval.kind === "mcp") {
    return <McpApproval approval={approval} onRespond={onRespond} />;
  }
  return <EditApproval approval={approval} onRespond={onRespond} />;
}

function McpApproval({
  approval,
  onRespond,
}: {
  approval: Extract<PendingApproval, { kind: "mcp" }>;
  onRespond: (approved: boolean) => void;
}) {
  const args = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(approval.arguments), null, 2);
    } catch {
      return approval.arguments;
    }
  }, [approval.arguments]);
  return (
    <m.div variants={rise} initial="initial" animate="animate" className="mb-6">
      <ToolCard className={SHELL}>
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <span className="text-[11px] font-semibold tracking-wide text-primary-soft uppercase">
            Run tool
          </span>
          <span className="ml-auto font-mono text-[11px] text-faint">
            {approval.tool}
          </span>
        </div>
        <Separator className="bg-border-soft" />
        <div className="scrollbar-thin max-h-40 overflow-auto px-3.5 py-3">
          <code className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-foreground">
            {args}
          </code>
        </div>
        <Separator className="bg-border-soft" />
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRespond(false)}
            className="ml-auto text-muted-foreground"
          >
            Deny
          </Button>
          <Button size="sm" onClick={() => onRespond(true)}>
            Allow
          </Button>
        </div>
      </ToolCard>
    </m.div>
  );
}

function CommandApproval({
  approval,
  onRespond,
  onAlwaysAllow,
}: {
  approval: Extract<PendingApproval, { kind: "command" }>;
  onRespond: (approved: boolean) => void;
  onAlwaysAllow: () => void;
}) {
  const program = commandProgram(approval.command);
  return (
    <m.div variants={rise} initial="initial" animate="animate" className="mb-6">
      <ToolCard className={SHELL}>
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <span className="text-[11px] font-semibold tracking-wide text-primary-soft uppercase">
            Run command
          </span>
          <span className="ml-auto text-[11px] text-faint">
            Approval required
          </span>
        </div>
        <Separator className="bg-border-soft" />
        <div className="scrollbar-thin max-h-40 overflow-auto px-3.5 py-3">
          <code className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-foreground">
            <span className="mr-2 select-none text-faint">$</span>
            {approval.command}
          </code>
        </div>
        <Separator className="bg-border-soft" />
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          {program ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onAlwaysAllow}
              className="mr-auto text-muted-foreground"
            >
              Always allow{" "}
              <span className="font-mono text-foreground">{program}</span>
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRespond(false)}
            className="text-muted-foreground"
          >
            Deny
          </Button>
          <Button size="sm" onClick={() => onRespond(true)}>
            Allow
          </Button>
        </div>
      </ToolCard>
    </m.div>
  );
}

function EditApproval({
  approval,
  onRespond,
}: {
  approval: Extract<PendingApproval, { kind: "edit" }>;
  onRespond: (approved: boolean) => void;
}) {
  const rows = useMemo(
    () => foldContext(diffLines(approval.before, approval.after ?? "")),
    [approval.before, approval.after],
  );
  const action = approvalToolLabel(approval.tool);
  const isDelete = approval.after === null;
  // A rename moves the file without changing its content, so a line diff (all
  // "unchanged") is noise — show the move instead.
  const isRename = approval.tool === "rename_file";

  return (
    <m.div variants={rise} initial="initial" animate="animate" className="mb-6">
      <ToolCard className={SHELL}>
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <span className="text-[11px] font-semibold tracking-wide text-primary-soft uppercase">
            {action}
          </span>
          <span className="truncate font-mono text-[12px] text-foreground">
            {approval.path}
          </span>
          <span className="ml-auto text-[11px] text-faint">
            Approval required
          </span>
        </div>
        <Separator className="bg-border-soft" />

        {isRename ? (
          <p className="px-3.5 py-3 font-mono text-[12px] text-muted-foreground">
            {approval.path}
          </p>
        ) : isDelete ? (
          <p className="px-3.5 py-3 text-[12px] text-muted-foreground">
            This will permanently delete{" "}
            <span className="font-mono text-foreground">{approval.path}</span>{" "}
            from the workspace.
          </p>
        ) : (
          <div className="scrollbar-thin max-h-72 overflow-auto font-mono text-[11px] leading-relaxed">
            {rows.map((row, index) =>
              row.type === "fold" ? (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: diff rows are positional and static
                  key={index}
                  className="bg-panel/40 px-3.5 py-1 text-center text-[10px] text-faint"
                >
                  ⋯ {row.count} unchanged line{row.count === 1 ? "" : "s"} ⋯
                </div>
              ) : (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: diff rows are positional and static
                  key={index}
                  className={
                    row.type === "add"
                      ? "bg-positive/12 px-3.5 text-foreground"
                      : row.type === "del"
                        ? "bg-destructive/12 px-3.5 text-foreground"
                        : "px-3.5 text-muted-foreground"
                  }
                >
                  <span className="mr-2 inline-block w-2 select-none text-faint">
                    {row.type === "add" ? "+" : row.type === "del" ? "-" : ""}
                  </span>
                  <span className="whitespace-pre-wrap">{row.text || " "}</span>
                </div>
              ),
            )}
          </div>
        )}

        <Separator className="bg-border-soft" />
        <div className="flex items-center justify-end gap-2 px-3.5 py-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRespond(false)}
            className="text-muted-foreground"
          >
            Deny
          </Button>
          <Button size="sm" onClick={() => onRespond(true)}>
            Allow
          </Button>
        </div>
      </ToolCard>
    </m.div>
  );
}
