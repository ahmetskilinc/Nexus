import { m } from "motion/react";
import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";
import { SettingsIcon } from "./Icons";
import { Hint } from "./Tooltip";

/// Shared chrome so the main sidebar (LeftNav) and the settings sidebar are the
/// same shell — identical brand header, nav rows, and footer. Only the middle
/// content (projects tree vs. settings categories) differs.

/// Sidebar header. `lead` fills the left (either the app brand or, in settings,
/// a back button — hiding the app name); `right` is an optional trailing action.
export function SidebarHeader({
  lead,
  right,
}: {
  lead: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="app-drag flex items-center gap-2.5 px-4 pt-[42px] pb-3">
      <div className="flex min-h-7 min-w-0 flex-1 items-center gap-2.5">
        {lead}
      </div>
      {right ? <span className="app-no-drag">{right}</span> : null}
    </div>
  );
}

/// The default `lead` for the main app: the coral cloud brand mark + "Nexus".
export function SidebarBrandMark() {
  return (
    <>
      <BrandMark
        size={28}
        className="shrink-0 drop-shadow-[0_2px_8px_rgba(255,110,70,0.32)]"
      />
      <span className="truncate text-[15px] font-bold tracking-[-0.03em] text-foreground">
        Nexus
      </span>
    </>
  );
}

export function SidebarNavRow({
  icon,
  title,
  active = false,
  onClick,
  children,
}: {
  icon: ReactNode;
  title?: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <m.button
      type="button"
      onClick={onClick}
      title={title}
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
      className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-[9px] text-left text-[13px] font-medium text-foreground transition-colors ${
        active ? "bg-accent" : "hover:bg-accent"
      }`}
    >
      <span
        className={`transition group-hover:text-primary-soft ${
          active ? "text-primary-soft" : "text-muted-foreground"
        }`}
      >
        {icon}
      </span>
      <span className="flex-1">{children}</span>
    </m.button>
  );
}

export function SidebarFooter({
  onSettings,
  settingsActive = false,
}: {
  onSettings: () => void;
  settingsActive?: boolean;
}) {
  return (
    <div className="flex items-center border-t border-divider px-3 py-2.5">
      <Hint label="Settings (⌘,)" side="top">
        <button
          type="button"
          onClick={onSettings}
          aria-label="Settings"
          aria-pressed={settingsActive}
          className={`grid size-7 place-items-center rounded-lg transition ${
            settingsActive
              ? "bg-secondary text-primary-soft"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <SettingsIcon size={16} />
        </button>
      </Hint>
    </div>
  );
}
