import { Input } from "@base-ui/react/input";
import { Select } from "@base-ui/react/select";
import { Switch } from "@base-ui/react/switch";
import { Toggle as ToggleItem } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type {
  AppState,
  McpServerConfig,
  Memory,
  ProviderProfile,
  ThemePreference,
} from "@nexus/protocol";
import { m } from "motion/react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { basename, createId } from "../lib/format";
import { popIn } from "../lib/motion";
import {
  type AppOp,
  addMcpServer,
  addProvider,
  removeMcpServer,
  removeProvider,
  clearRunJournal,
  restoreArchivedSession,
  setCommandEnvironment,
  setCustomInstructions,
  setMaxRunCostUsd,
  setMaxRunSeconds,
  setMaxToolRounds,
  setReduceMotion,
  setTerminalShell,
  setTheme,
  setWebAccess,
  toggleMcpServer,
} from "../lib/ops";
import type { RuntimeStatus } from "../lib/types";
import {
  AiIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  type IconComponent,
  InfoIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  SearchIcon,
  SlidersIcon,
  SunIcon,
  WrenchIcon,
} from "./Icons";
import { SidebarNavRow } from "./sidebar";

type Category =
  | "general"
  | "appearance"
  | "models"
  | "tools"
  | "accessibility"
  | "about";

const CATEGORIES: {
  id: Category;
  label: string;
  Icon: IconComponent;
  keywords: string[];
}[] = [
  {
    id: "general",
    label: "General",
    Icon: SlidersIcon,
    keywords: ["motion", "animation", "runtime"],
  },
  {
    id: "appearance",
    label: "Appearance",
    Icon: PaletteIcon,
    keywords: ["theme", "dark", "light", "system", "color"],
  },
  {
    id: "models",
    label: "Models",
    Icon: AiIcon,
    keywords: [
      "provider",
      "openai",
      "anthropic",
      "api key",
      "chatgpt",
      "claude",
      "kimi",
      "moonshot",
    ],
  },
  {
    id: "tools",
    label: "Tools",
    Icon: WrenchIcon,
    keywords: ["web", "search", "fetch", "mcp", "network", "extensions"],
  },
  {
    id: "accessibility",
    label: "Accessibility",
    Icon: MonitorIcon,
    keywords: ["keyboard", "shortcut", "focus", "screen reader", "contrast"],
  },
  {
    id: "about",
    label: "About",
    Icon: InfoIcon,
    keywords: ["version", "license", "credits"],
  },
];

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  Icon: IconComponent;
}[] = [
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
];

const STATUS_LABEL: Record<RuntimeStatus, string> = {
  ready: "Ready",
  offline: "Offline",
  checking: "Connecting",
};
const STATUS_DOT: Record<RuntimeStatus, string> = {
  ready: "bg-positive",
  offline: "bg-destructive",
  checking: "bg-amber-300",
};

export function SettingsScreen({
  state,
  runtimeStatus,
  sidebarWidth,
  apply,
  onClose,
}: {
  state: AppState;
  runtimeStatus: RuntimeStatus;
  sidebarWidth: number;
  apply: (op: AppOp) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState<Category>("general");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = CATEGORIES.filter(
    (category) =>
      !q ||
      category.label.toLowerCase().includes(q) ||
      category.keywords.some((keyword) => keyword.includes(q)),
  );

  useEffect(() => {
    if (visible.length && !visible.some((category) => category.id === active))
      setActive(visible[0].id);
  }, [visible, active]);

  const activeLabel =
    CATEGORIES.find((category) => category.id === active)?.label ?? "Settings";

  return (
    <m.div
      variants={popIn}
      initial="initial"
      animate="animate"
      exit="exit"
      className="settings-shell fixed inset-0 z-40 flex bg-background"
    >
      {/* backdrop-blur: under vibrancy the app (and its LeftNav) is still
          mounted beneath this overlay — the blur smears that content into the
          glass so the translucent column reads as material, not ghost text.
          Over an opaque background (vibrancy off) it is a no-op. */}
      <aside
        style={{ width: sidebarWidth }}
        className="flex shrink-0 flex-col border-r border-border bg-sidebar backdrop-blur-2xl"
      >
        {/* Drag strip clearing the macOS traffic lights. */}
        <div className="app-drag h-[42px] w-full shrink-0" />
        <div className="px-2.5 pb-1">
          <SidebarNavRow
            icon={<ChevronLeftIcon size={17} />}
            title="Back to app"
            onClick={onClose}
          >
            Back
          </SidebarNavRow>
        </div>
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-border-soft bg-muted px-2.5 py-1.5 focus-within:border-primary-dim">
            <SearchIcon size={14} className="text-faint" />
            <Input
              value={query}
              onValueChange={(value) => setQuery(value)}
              placeholder="Search settings"
              aria-label="Search settings"
              className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-faint"
            />
          </div>
        </div>
        <nav className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 py-1">
          {visible.map(({ id, label, Icon }) => (
            <SidebarNavRow
              key={id}
              icon={<Icon size={17} />}
              active={id === active}
              onClick={() => setActive(id)}
            >
              {label}
            </SidebarNavRow>
          ))}
          {visible.length === 0 ? (
            <p className="px-2.5 py-2 text-[12px] text-faint">
              No settings found.
            </p>
          ) : null}
        </nav>
      </aside>

      <main className="scrollbar-thin flex-1 overflow-y-auto bg-background">
        <div className="app-drag h-[30px] w-full" />
        <div className="mx-auto max-w-[720px] px-10 pb-16">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">
            {activeLabel}
          </h1>
          <div className="mt-6">
            {active === "general" ? (
              <GeneralPanel
                state={state}
                runtimeStatus={runtimeStatus}
                apply={apply}
              />
            ) : null}
            {active === "appearance" ? (
              <AppearancePanel state={state} apply={apply} />
            ) : null}
            {active === "models" ? (
              <ModelsPanel state={state} apply={apply} />
            ) : null}
            {active === "tools" ? (
              <ToolsPanel state={state} apply={apply} />
            ) : null}
            {active === "accessibility" ? <AccessibilityPanel /> : null}
            {active === "about" ? <AboutPanel /> : null}
          </div>
        </div>
      </main>
    </m.div>
  );
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      {title ? (
        <p className="mb-2 text-[13px] font-semibold text-foreground">
          {title}
        </p>
      ) : null}
      <div className="rounded-xl border border-border-soft bg-card/50 px-4">
        {children}
      </div>
    </section>
  );
}

function Row({
  title,
  description,
  children,
  last,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-6 py-3.5 ${last ? "" : "border-b border-border-soft"}`}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className="flex h-[22px] w-[38px] shrink-0 items-center rounded-full bg-faint/50 p-[3px] transition-colors data-[checked]:bg-primary"
    >
      <Switch.Thumb className="size-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] data-[checked]:translate-x-4" />
    </Switch.Root>
  );
}

function SelectField<T extends string>({
  value,
  onValueChange,
  options,
  label,
}: {
  value: T;
  onValueChange: (next: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      items={options}
    >
      <Select.Trigger
        aria-label={label}
        className="flex items-center justify-between gap-2 rounded-lg border border-border-soft bg-panel px-3 py-2 text-[13px] text-foreground outline-none transition data-[popup-open]:border-primary-dim focus-visible:border-primary-dim"
      >
        <Select.Value />
        <Select.Icon className="text-faint">
          <ChevronDownIcon size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          sideOffset={6}
          className="z-50"
          alignItemWithTrigger={false}
        >
          <Select.Popup className="min-w-[var(--anchor-width)] origin-[var(--transform-origin)] rounded-lg border border-border bg-secondary py-1 shadow-[var(--shadow-pop)] transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                className="flex cursor-default items-center justify-between gap-3 px-3 py-1.5 text-[13px] text-muted-foreground transition select-none data-[highlighted]:bg-accent data-[highlighted]:text-foreground data-[selected]:text-foreground"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="text-primary">
                  <CheckIcon size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function GeneralPanel({
  state,
  runtimeStatus,
  apply,
}: {
  state: AppState;
  runtimeStatus: RuntimeStatus;
  apply: (op: AppOp) => void;
}) {
  return (
    <>
      <Section title="General">
        <Row
          title="Reduce motion"
          description="Disable non-essential animations and transitions."
        >
          <Toggle
            label="Reduce motion"
            checked={Boolean(state.reduceMotion)}
            onChange={(next) => apply(setReduceMotion(next))}
          />
        </Row>
        <Row
          title="Tool-round budget"
          description="Maximum provider/tool cycles allowed in one run (1–200)."
        >
          <input
            type="number"
            min={1}
            max={200}
            value={state.maxToolRounds ?? 50}
            onChange={(event) =>
              apply(setMaxToolRounds(Number(event.target.value)))
            }
            className="w-20 rounded-lg border border-border-soft bg-panel px-2 py-1.5 text-right text-[12px] text-foreground outline-none focus:border-primary-dim"
          />
        </Row>
        <Row
          title="Run time limit"
          description="Maximum wall-clock time for a single agent run (30–3600 seconds)."
        >
          <input
            type="number"
            min={30}
            max={3600}
            value={state.maxRunSeconds ?? 900}
            onChange={(event) =>
              apply(setMaxRunSeconds(Number(event.target.value)))
            }
            className="w-20 rounded-lg border border-border-soft bg-panel px-2 py-1.5 text-right text-[12px] text-foreground outline-none focus:border-primary-dim"
          />
        </Row>
        <Row
          title="Estimated cost limit"
          description="Stop after a provider turn would push this run over the USD estimate. Blank disables it."
        >
          <input
            type="number"
            min={0}
            step={0.1}
            value={state.maxRunCostUsd ?? ""}
            placeholder="Off"
            onChange={(event) =>
              apply(
                setMaxRunCostUsd(
                  event.target.value ? Number(event.target.value) : undefined,
                ),
              )
            }
            className="w-20 rounded-lg border border-border-soft bg-panel px-2 py-1.5 text-right text-[12px] text-foreground outline-none focus:border-primary-dim"
          />
        </Row>
        <Row
          title="Runtime"
          description="Status of the local agent runtime."
          last
        >
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span
              className={`size-1.5 rounded-full ${STATUS_DOT[runtimeStatus]}`}
            />
            {STATUS_LABEL[runtimeStatus]}
          </span>
        </Row>
      </Section>
      <RunJournalSection state={state} apply={apply} />
      <Section title="Archived sessions">
        {state.sessions.filter((session) => session.archivedAt).length === 0 ? (
          <Row
            title="No archived sessions"
            description="Archived chats can be restored here."
            last
          />
        ) : (
          state.sessions
            .filter((session) => session.archivedAt)
            .map((session, index, archived) => (
              <Row
                key={session.id}
                title={session.title}
                description={basename(session.workspacePath)}
                last={index === archived.length - 1}
              >
                <button
                  type="button"
                  onClick={() => apply(restoreArchivedSession(session.id))}
                  className="rounded-lg px-2 py-1 text-[12px] font-medium text-primary-soft transition hover:bg-accent"
                >
                  Restore
                </button>
              </Row>
            ))
        )}
      </Section>
    </>
  );
}

function RunJournalSection({
  state,
  apply,
}: {
  state: AppState;
  apply: (op: AppOp) => void;
}) {
  const current = state.sessions.find(
    (session) => session.id === state.currentSessionId,
  );
  const entries = current?.runJournal ?? [];
  const label: Record<NonNullable<typeof entries>[number]["status"], string> = {
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
  };
  return (
    <Section title="Recent run activity">
      {entries.length === 0 ? (
        <Row
          title="No runs recorded"
          description="Recent agent lifecycle activity appears here for the focused session."
          last
        />
      ) : (
        <>
          {[...entries].reverse().map((entry, index) => (
            <Row
              key={`${entry.id}-${entry.startedAt}`}
              title={label[entry.status]}
              description={`${new Date(entry.startedAt).toLocaleString()}${
                entry.endedAt
                  ? ` · ended ${new Date(entry.endedAt).toLocaleTimeString()}`
                  : ""
              }`}
              last={index === entries.length - 1}
            />
          ))}
          <div className="flex justify-end py-3">
            <button
              type="button"
              onClick={() => current && apply(clearRunJournal(current.id))}
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              Clear run activity
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

function AppearancePanel({
  state,
  apply,
}: {
  state: AppState;
  apply: (op: AppOp) => void;
}) {
  return (
    <Section title="Theme">
      <Row
        title="Appearance"
        description="Match your system or choose a fixed mode."
        last
      >
        <ToggleGroup
          value={[state.theme ?? "system"]}
          onValueChange={(groupValue) => {
            const next = groupValue[0] as ThemePreference | undefined;
            if (next) apply(setTheme(next));
          }}
          className="flex gap-1 rounded-lg border border-border-soft bg-panel p-1"
        >
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <ToggleItem
              key={value}
              value={value}
              aria-label={label}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground data-[pressed]:bg-secondary data-[pressed]:text-foreground [&[data-pressed]_svg]:text-primary-soft"
            >
              <Icon size={14} />
              {label}
            </ToggleItem>
          ))}
        </ToggleGroup>
      </Row>
    </Section>
  );
}

function ModelsPanel({
  state,
  apply,
}: {
  state: AppState;
  apply: (op: AppOp) => void;
}) {
  const [kind, setKind] = useState<ProviderProfile["kind"]>("OpenAI");
  const [authentication, setAuthentication] =
    useState<ProviderProfile["authentication"]>("oauth");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const field =
    "rounded-lg border border-border-soft bg-panel px-3 py-2 text-[13px] text-foreground outline-none transition focus:border-primary-dim";

  async function add(event: FormEvent) {
    event.preventDefault();
    const oauthName =
      kind === "Kimi" ? "Kimi (subscription)" : "OpenAI (ChatGPT)";
    const provider: ProviderProfile = {
      id: createId(),
      name: name.trim() || (authentication === "oauth" ? oauthName : kind),
      kind,
      authentication: kind === "Anthropic" ? "api_key" : authentication,
    };
    setBusy(true);
    setMessage(undefined);
    try {
      if (provider.authentication === "api_key") {
        if (!apiKey.trim()) throw new Error("An API key is required.");
        await window.nexus.setCredential(provider.id, apiKey.trim());
        // Confirm the key actually works before adding the provider.
        await window.nexus.verifyProvider(
          provider.id,
          provider.kind,
          provider.authentication,
        );
      } else {
        // Wait for the OAuth flow to complete before adding the provider.
        await window.nexus.signIn(provider.id, provider.kind);
      }
      apply(addProvider(provider));
      setName("");
      setApiKey("");
      setMessage(`${provider.name} connected.`);
    } catch (reason) {
      await window.nexus.deleteCredential(provider.id).catch(() => undefined);
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Could not connect this provider.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(provider: ProviderProfile) {
    await window.nexus.deleteCredential(provider.id).catch(() => undefined);
    apply(removeProvider(provider.id));
  }

  return (
    <>
      <Section title="Connected">
        {state.providers.length === 0 ? (
          <Row
            title="No providers connected"
            description="Add a provider below to start chatting."
            last
          />
        ) : (
          state.providers.map((provider, index) => (
            <Row
              key={provider.id}
              title={provider.name}
              description={`${provider.kind} · ${provider.authentication} · credentials stored in native secure storage`}
              last={index === state.providers.length - 1}
            >
              <button
                type="button"
                onClick={() => void remove(provider)}
                className="rounded-lg px-2 py-1 text-[12px] font-medium text-muted-foreground transition hover:bg-accent hover:text-destructive"
              >
                Remove
              </button>
            </Row>
          ))
        )}
      </Section>

      <Section title="Connection policy">
        <Row
          title="Direct provider connections"
          description="Nexus sends requests directly to the selected provider. Custom, proxy, Azure-style, and local OpenAI-compatible endpoints are intentionally deferred until their endpoint, authentication, and data-policy contracts are implemented."
          last
        />
      </Section>

      <Section title="Add a provider">
        <form className="grid gap-3 py-4" onSubmit={(event) => void add(event)}>
          <div className="grid gap-1.5 text-[12px] text-muted-foreground">
            Provider
            <SelectField
              label="Provider"
              value={kind}
              onValueChange={(next) => {
                setKind(next);
                setAuthentication(next === "Anthropic" ? "api_key" : "oauth");
              }}
              options={[
                { value: "OpenAI", label: "OpenAI" },
                { value: "Anthropic", label: "Anthropic" },
                { value: "Kimi", label: "Kimi (Moonshot AI)" },
              ]}
            />
          </div>
          {kind !== "Anthropic" ? (
            <div className="grid gap-1.5 text-[12px] text-muted-foreground">
              Authentication
              <SelectField
                label="Authentication"
                value={authentication}
                onValueChange={setAuthentication}
                options={[
                  {
                    value: "oauth",
                    label: kind === "Kimi" ? "Kimi account" : "ChatGPT account",
                  },
                  { value: "api_key", label: "API key" },
                ]}
              />
            </div>
          ) : null}
          {kind === "Anthropic" || authentication === "api_key" ? (
            <label className="grid gap-1.5 text-[12px] text-muted-foreground">
              API key
              <input
                className={field}
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Stored in secure native storage"
              />
            </label>
          ) : (
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Your default browser will open to authorize Nexus. Tokens never
              enter the renderer.
            </p>
          )}
          <label className="grid gap-1.5 text-[12px] text-muted-foreground">
            Profile name
            <input
              className={field}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={kind}
            />
          </label>
          {message ? (
            <p className="text-[12px] text-primary-soft">{message}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="mt-1 justify-self-start rounded-lg bg-primary px-3.5 py-2 text-[12px] font-semibold text-primary-foreground transition hover:bg-primary-soft disabled:opacity-50"
          >
            {busy ? "Connecting…" : "Add provider"}
          </button>
        </form>
      </Section>
    </>
  );
}

function ToolsPanel({
  state,
  apply,
}: {
  state: AppState;
  apply: (op: AppOp) => void;
}) {
  const servers = state.mcpServers ?? [];
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [message, setMessage] = useState<string>();
  const [inspecting, setInspecting] = useState<string>();
  const [toolsByServer, setToolsByServer] = useState<
    Record<string, Array<{ name: string; description: string }>>
  >({});

  const field =
    "rounded-lg border border-border-soft bg-panel px-3 py-2 text-[13px] text-foreground outline-none transition focus:border-primary-dim";

  async function addServer(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (!trimmedName || !trimmedCommand) {
      setMessage("A name and a command are both required.");
      return;
    }
    if (servers.some((server) => server.name === trimmedName)) {
      setMessage("A server with that name already exists.");
      return;
    }
    const server: McpServerConfig = {
      name: trimmedName,
      command: trimmedCommand,
      args: argsText.trim() ? argsText.trim().split(/\s+/) : [],
      enabled: true,
    };
    setInspecting(server.name);
    setMessage(undefined);
    try {
      // Do not persist a server command until it has completed a real MCP
      // handshake and disclosed its tool surface to the user.
      const tools = await window.nexus.inspectMcpServer(server);
      setToolsByServer((current) => ({ ...current, [server.name]: tools }));
      apply(addMcpServer(server));
      setName("");
      setCommand("");
      setArgsText("");
      setMessage(
        `${server.name} added with ${tools.length} discovered tool${tools.length === 1 ? "" : "s"}. Calls still require approval outside Auto mode.`,
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Could not connect to this MCP server.",
      );
    } finally {
      setInspecting(undefined);
    }
  }

  function removeServer(target: McpServerConfig) {
    apply(removeMcpServer(target.name));
  }

  async function inspectServer(server: McpServerConfig) {
    setInspecting(server.name);
    setMessage(undefined);
    try {
      const tools = await window.nexus.inspectMcpServer(server);
      setToolsByServer((current) => ({ ...current, [server.name]: tools }));
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Could not inspect MCP server.",
      );
    } finally {
      setInspecting(undefined);
    }
  }

  return (
    <>
      <Section title="Web access">
        <Row
          title="Allow web tools"
          description="Let the agent search the web and fetch pages (web_search, web_fetch). Off by default; requests reach the network."
          last
        >
          <Toggle
            label="Allow web tools"
            checked={Boolean(state.webAccess)}
            onChange={(next) => apply(setWebAccess(next))}
          />
        </Row>
      </Section>

      <Section title="Command environment">
        <Row
          title="Compatible developer environment"
          description="Inherit your local toolchain environment for agent-run commands. Turn this off to use the restricted environment allowlist. Commands still follow the current approval mode."
        >
          <Toggle
            label="Compatible command environment"
            checked={
              (state.commandEnvironment ?? "compatible") === "compatible"
            }
            onChange={(compatible) =>
              apply(
                setCommandEnvironment(compatible ? "compatible" : "restricted"),
              )
            }
          />
        </Row>
        <Row
          title="Terminal shell"
          description="Absolute path to the shell for the integrated terminal. Blank uses your platform default; changes apply to newly opened terminals."
          last
        >
          <input
            type="text"
            value={state.terminalShell ?? ""}
            placeholder={
              window.nexus.platform === "win32" ? "powershell.exe" : "/bin/zsh"
            }
            spellCheck={false}
            onChange={(event) => apply(setTerminalShell(event.target.value))}
            className="w-52 rounded-lg border border-border-soft bg-panel px-2 py-1.5 font-mono text-[12px] text-foreground outline-none placeholder:text-faint focus:border-primary-dim"
          />
        </Row>
      </Section>

      <WorkspaceInstructionsSection state={state} apply={apply} />

      <MemorySection state={state} />

      <Section title="MCP servers">
        {servers.length === 0 ? (
          <Row
            title="No servers connected"
            description="Add a Model Context Protocol server below to expose its tools to the agent."
            last
          />
        ) : (
          servers.map((server, index) => (
            <div key={server.name}>
              <Row
                title={server.name}
                description={`${server.command} ${(server.args ?? []).join(" ")}`.trim()}
                last={
                  index === servers.length - 1 && !toolsByServer[server.name]
                }
              >
                <div className="flex items-center gap-2">
                  <Toggle
                    label={`Enable ${server.name}`}
                    checked={server.enabled !== false}
                    onChange={() => apply(toggleMcpServer(server.name))}
                  />
                  <button
                    type="button"
                    onClick={() => void inspectServer(server)}
                    disabled={inspecting === server.name}
                    className="rounded-lg px-2 py-1 text-[12px] font-medium text-primary-soft transition hover:bg-accent disabled:opacity-50"
                  >
                    {inspecting === server.name ? "Testing…" : "Inspect"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeServer(server)}
                    className="rounded-lg px-2 py-1 text-[12px] font-medium text-muted-foreground transition hover:bg-accent hover:text-destructive"
                  >
                    Remove
                  </button>
                </div>
              </Row>
              {toolsByServer[server.name] ? (
                <div className="border-b border-border-soft px-4 py-3">
                  <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Discovered tools
                  </p>
                  {toolsByServer[server.name]?.length ? (
                    <ul className="mt-2 space-y-1.5">
                      {toolsByServer[server.name]?.map((tool) => (
                        <li key={tool.name} className="text-[12px]">
                          <span className="font-mono text-foreground">
                            {tool.name}
                          </span>
                          {tool.description ? (
                            <span className="ml-2 text-muted-foreground">
                              {tool.description}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[12px] text-faint">
                      No tools exposed by this server.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          ))
        )}
      </Section>

      <Section title="Add an MCP server">
        <form className="grid gap-3 py-4" onSubmit={addServer}>
          <label className="grid gap-1.5 text-[12px] text-muted-foreground">
            Name
            <input
              className={field}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="filesystem"
            />
          </label>
          <label className="grid gap-1.5 text-[12px] text-muted-foreground">
            Command
            <input
              className={field}
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="npx"
            />
          </label>
          <label className="grid gap-1.5 text-[12px] text-muted-foreground">
            Arguments
            <input
              className={field}
              value={argsText}
              onChange={(event) => setArgsText(event.target.value)}
              placeholder="-y @modelcontextprotocol/server-filesystem /path"
            />
          </label>
          {message ? (
            <p className="text-[12px] text-primary-soft">{message}</p>
          ) : null}
          <button
            type="submit"
            disabled={Boolean(inspecting)}
            className="mt-1 justify-self-start rounded-lg bg-primary px-3.5 py-2 text-[12px] font-semibold text-primary-foreground transition hover:bg-primary-soft disabled:opacity-50"
          >
            {inspecting ? "Testing server…" : "Test and add server"}
          </button>
        </form>
      </Section>
    </>
  );
}

/// Per-workspace custom instructions editor. Bound to the currently selected
/// workspace; the text is appended to the system prompt after any instruction
/// file at the workspace root. Saved on blur so typing doesn't churn AppState.
function WorkspaceInstructionsSection({
  state,
  apply,
}: {
  state: AppState;
  apply: (op: AppOp) => void;
}) {
  const workspacePath = state.workspacePath;
  const saved = workspacePath
    ? (state.customInstructions?.[workspacePath] ?? "")
    : "";
  const [draft, setDraft] = useState(saved);

  // Re-seed the draft when the saved value or the active workspace changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on identity change
  useEffect(() => {
    setDraft(saved);
  }, [workspacePath, saved]);

  return (
    <Section title="Workspace instructions">
      {workspacePath ? (
        <div className="py-3.5">
          <p className="text-[13px] font-medium text-foreground">
            {basename(workspacePath)}
          </p>
          <p className="mt-0.5 mb-2.5 text-[12px] leading-snug text-muted-foreground">
            Extra guidance for the agent in this workspace, appended to the
            system prompt after any AGENTS.md, .nexus.md, or CLAUDE.md file at
            the root.
          </p>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (draft !== saved)
                apply(setCustomInstructions(workspacePath, draft));
            }}
            rows={5}
            placeholder="e.g. Prefer tabs over spaces. Run `bun run check` before finishing."
            className="w-full resize-y rounded-lg border border-border-soft bg-panel px-3 py-2 text-[13px] leading-snug text-foreground outline-none transition focus:border-primary-dim"
          />
        </div>
      ) : (
        <Row
          title="No workspace selected"
          description="Open a workspace to set instructions the agent follows there."
          last
        />
      )}
    </Section>
  );
}

/// Per-workspace memory viewer: lists the facts the agent saved with
/// memory_save for the current workspace and lets the user delete them
/// individually or clear the lot. Read from the runtime store on open.
function MemorySection({ state }: { state: AppState }) {
  const workspacePath = state.workspacePath;
  const [memories, setMemories] = useState<Memory[]>([]);
  const [instructionSource, setInstructionSource] = useState<string>();
  const [instructionText, setInstructionText] = useState<string>();
  const [instructionTruncated, setInstructionTruncated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspacePath) {
      setMemories([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void window.nexus
      .contextPreview()
      .then((preview) => {
        if (cancelled) return;
        setMemories(preview.memories);
        setInstructionSource(preview.instructionSource);
        setInstructionText(preview.instructionText);
        setInstructionTruncated(preview.instructionTruncated);
      })
      .catch(() => {
        if (!cancelled) setMemories([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  async function remove(id: string) {
    await window.nexus.deleteMemory(id);
    setMemories((current) => current.filter((memory) => memory.id !== id));
  }

  async function clearAll() {
    await window.nexus.clearMemories();
    setMemories([]);
  }

  if (!workspacePath) {
    return (
      <Section title="Memory">
        <Row
          title="No workspace selected"
          description="Open a workspace to see what the agent remembers about it."
          last
        />
      </Section>
    );
  }

  return (
    <>
      <Section title="Effective context">
        <div className="py-3.5">
          <p className="text-[13px] font-medium text-foreground">
            Repository instructions
          </p>
          {instructionSource ? (
            <>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Loaded from {instructionSource}
                {instructionTruncated ? " · truncated to 8 KB" : ""}
              </p>
              <pre className="scrollbar-thin mt-2 max-h-36 overflow-auto rounded-lg border border-border-soft bg-panel p-2.5 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
                {instructionText}
              </pre>
            </>
          ) : (
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              No AGENTS.md, .nexus.md, or CLAUDE.md is active at the workspace
              root.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <ContextBadge>{memories.length} memories</ContextBadge>
            <ContextBadge>
              {state.webAccess ? "Web enabled" : "Web disabled"}
            </ContextBadge>
            <ContextBadge>
              {(state.mcpServers ?? []).length} MCP servers
            </ContextBadge>
            <ContextBadge>
              {(state.commandEnvironment ?? "compatible") === "compatible"
                ? "Compatible commands"
                : "Restricted commands"}
            </ContextBadge>
          </div>
        </div>
      </Section>
      <Section title="Memory">
        {loading ? (
          <Row title="Loading…" last />
        ) : memories.length === 0 ? (
          <Row
            title="Nothing remembered yet"
            description="The agent saves durable facts about this workspace with its memory_save tool; they appear here and are recalled at the start of each run."
            last
          />
        ) : (
          memories.map((memory, index) => (
            <Row
              key={memory.id}
              title={memory.fact}
              last={index === memories.length - 1}
            >
              <button
                type="button"
                onClick={() => void remove(memory.id)}
                className="rounded-lg px-2 py-1 text-[12px] font-medium text-muted-foreground transition hover:bg-accent hover:text-destructive"
              >
                Delete
              </button>
            </Row>
          ))
        )}
        {memories.length > 0 ? (
          <div className="flex justify-end py-3">
            <button
              type="button"
              onClick={() => void clearAll()}
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-destructive transition hover:bg-destructive/10"
            >
              Clear all memories
            </button>
          </div>
        ) : null}
      </Section>
    </>
  );
}

function ContextBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border-soft bg-panel px-2 py-1 text-[10px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function AccessibilityPanel() {
  return (
    <>
      <Section title="Keyboard navigation">
        <Row
          title="New task"
          description="Create a task in the active workspace."
        >
          <Shortcut>⌘/Ctrl N</Shortcut>
        </Row>
        <Row
          title="Quick Open"
          description="Find a workspace file by name or path."
        >
          <Shortcut>⌘/Ctrl P</Shortcut>
        </Row>
        <Row
          title="Search workspace"
          description="Search literal text across safe indexed files."
        >
          <Shortcut>⌘/Ctrl F</Shortcut>
        </Row>
        <Row title="Settings" description="Open application settings.">
          <Shortcut>⌘/Ctrl ,</Shortcut>
        </Row>
        <Row
          title="Toggle sidebars"
          description="Show or hide the workspace and file panels."
          last
        >
          <Shortcut>⌘/Ctrl B · ⌘/Ctrl \\</Shortcut>
        </Row>
      </Section>
      <Section title="Motion and focus">
        <Row
          title="Reduce motion"
          description="Use the Appearance and General settings to reduce animations. All primary workspace actions are keyboard reachable and dialogs close with Escape."
          last
        />
      </Section>
    </>
  );
}

function Shortcut({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border-soft bg-panel px-1.5 py-1 font-mono text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}

function AboutPanel() {
  const [version, setVersion] = useState<string>();
  useEffect(() => {
    void window.nexus
      .appVersion()
      .then(setVersion)
      .catch(() => setVersion(undefined));
  }, []);
  return (
    <Section title="About Nexus">
      <Row title="Version" description="Installed application version.">
        <span className="font-mono text-[12px] text-muted-foreground">
          {version ?? "—"}
        </span>
      </Row>
      <Row
        title="Open source licenses"
        description="React, Electron, Tailwind CSS, Pierre diffs & trees, Hugeicons, and Geist."
        last
      />
    </Section>
  );
}
