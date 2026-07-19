import { m } from "motion/react";
import { popIn, transitions } from "../lib/motion";
import { BrandMark } from "./BrandMark";
import {
  CompassIcon,
  FolderIcon,
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

export function Welcome({ onChoose }: { onChoose: () => void }) {
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

        <button
          type="button"
          onClick={onChoose}
          className="app-no-drag mt-8 flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-[14px] font-semibold text-primary-foreground transition hover:bg-primary-soft"
        >
          <FolderIcon size={17} />
          Open a repository
        </button>
      </div>
    </div>
  );
}
