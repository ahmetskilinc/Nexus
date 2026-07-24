import { m } from "motion/react";
import { useState } from "react";
import { popIn, transitions } from "../lib/motion";
import { BrandMark } from "./BrandMark";
import {
  CompassIcon,
  FolderIcon,
  GitBranchIcon,
  MonitorIcon,
  ReviewIcon,
  WrenchIcon,
} from "./Icons";

/// What the agent does, shown on the empty/first-run screen so a new user knows
/// what they're opening a repository into.
const FEATURES = [
  {
    Icon: CompassIcon,
    title: "Explores your workspace",
    desc: "Reads your repo with grep, file, and git tools before it acts.",
  },
  {
    Icon: WrenchIcon,
    title: "Edits with your approval",
    desc: "Proposes edits and commands you review before they run.",
  },
  {
    Icon: ReviewIcon,
    title: "Plans, then builds",
    desc: "Researches the task, writes a plan, and carries it out.",
  },
  {
    Icon: MonitorIcon,
    title: "Local-first and private",
    desc: "Runs on your machine; your keys stay in the Keychain.",
  },
] as const;

export function Welcome({
  onChoose,
  onClone,
}: {
  onChoose: () => Promise<boolean>;
  onClone: (url: string) => Promise<boolean>;
}) {
  const [url, setUrl] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string>();

  async function open() {
    setCloneError(undefined);
    if (!(await onChoose()))
      setCloneError("Choose a Git repository to open in Nexus.");
  }

  async function clone() {
    if (!url.trim() || cloning) return;
    setCloning(true);
    setCloneError(undefined);
    try {
      if (!(await onClone(url)))
        setCloneError(
          "Could not clone the repository. Check the URL and your Git credentials.",
        );
    } finally {
      setCloning(false);
    }
  }

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden px-8">
      {/* Top strip stays draggable since this screen has no per-pane top bar. */}
      <div className="app-drag absolute inset-x-0 top-0 h-10" />
      <div className="relative flex w-full max-w-[440px] flex-col items-center text-center">
        <m.span
          variants={popIn}
          initial="initial"
          animate="animate"
          className="drop-shadow-[0_6px_18px_rgba(255,110,70,0.2)]"
        >
          <BrandMark size={56} />
        </m.span>
        <h1 className="mt-6 text-[40px] leading-none font-bold tracking-[-0.04em] text-foreground">
          Nexus
        </h1>
        <p className="mt-3 max-w-[380px] text-[14px] leading-relaxed text-muted-foreground">
          A local-first coding agent that reads your workspace, shows its work,
          and helps you think clearly before you ship.
        </p>

        <ul className="mt-8 flex w-full flex-col gap-2 text-left">
          {FEATURES.map(({ Icon, title, desc }, index) => (
            <m.li
              key={title}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...transitions.base, delay: 0.05 + index * 0.05 }}
              className="flex items-start gap-3 rounded-xl border border-border-soft bg-card/40 px-3.5 py-3"
            >
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-secondary/70 text-primary-soft">
                <Icon size={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-foreground">
                  {title}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                  {desc}
                </span>
              </span>
            </m.li>
          ))}
        </ul>

        <div className="app-no-drag mt-8 flex gap-2">
          <button
            type="button"
            onClick={() => void open()}
            className="flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-[14px] font-semibold text-primary-foreground transition hover:bg-primary-soft"
          >
            <FolderIcon size={17} />
            Open a repository
          </button>
        </div>
        <form
          className="app-no-drag mt-3 w-full rounded-xl border border-border-soft bg-card/40 p-2 text-left"
          onSubmit={(event) => {
            event.preventDefault();
            void clone();
          }}
        >
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            Clone a repository
          </label>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/org/repo.git"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-border-soft bg-background px-2.5 py-2 font-mono text-[11px] text-foreground outline-none placeholder:text-faint focus:border-primary-dim"
            />
            <button
              type="submit"
              disabled={cloning || !url.trim()}
              className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-2 text-[11px] font-semibold text-foreground transition hover:bg-accent disabled:opacity-50"
            >
              <GitBranchIcon size={13} />
              {cloning ? "Cloning…" : "Clone"}
            </button>
          </div>
          {cloneError ? (
            <p className="mt-2 text-[11px] text-destructive">{cloneError}</p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
