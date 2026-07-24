/// Auxiliary tool schemas: shell, UI-artifact, sub-agent, memory, and web
/// tools. Descriptions are byte-faithful to the Rust catalog — they are sent
/// verbatim to LLM APIs.

import type { ToolSchema } from "./kinds";

export const AUX_TOOLS: readonly ToolSchema[] = [
  {
    name: "run_command",
    description:
      "Run a shell command in the workspace root and return its combined stdout/stderr and exit code. Use it to verify your work: run the project's tests, build, linter, or formatter after making changes, and react to failures. Commands are non-interactive (no stdin); avoid interactive prompts and long-running or watch commands. Output and runtime are capped.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            'The shell command to run, e.g. "cargo test" or "npm run build".',
        },
      },
      required: ["command"],
    },
    kind: "command",
  },
  {
    name: "todo_write",
    description:
      "Record or update your task list for the current request, shown to the user as a live checklist. Send the COMPLETE list every time (it replaces the previous one). Use it for multi-step work: mark exactly one item in_progress while you work on it, and completed once it is done. Skip it for trivial single-step requests.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The full ordered task list.",
          items: {
            type: "object",
            properties: {
              content: {
                type: "string",
                description: "Short imperative description of the task.",
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "Current status of the task.",
              },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
    },
    kind: "todo",
  },
  {
    name: "ask_user",
    description:
      "Pause the current run to ask the user a focused question when their choice or missing information is needed to proceed. Ask one concise, decision-ready question. Supply choices when a small set of options would help. The run resumes when the user answers. Do not use this to approve edits or commands; those are handled separately.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The focused question to show the user.",
        },
        choices: {
          type: "array",
          description: "Optional short choices the user can select.",
          items: { type: "string" },
        },
        allowFreeform: {
          type: "boolean",
          description:
            "Whether the user may type an answer in addition to choices.",
        },
      },
      required: ["question"],
    },
    kind: "askUser",
  },
  {
    name: "write_plan",
    description:
      "Publish a feature plan for the current request as a document shown to the user in a side panel. Call this once, after researching the workspace and before making changes, to lay out what you will do and why. Follow it with todo_write to seed the checklist you will then carry out. You may call write_plan again to revise the plan if the approach changes.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "Short title for the plan, e.g. the feature or task name.",
        },
        markdown: {
          type: "string",
          description:
            "The full plan document in Markdown: context, the approach, files to change, and how it will be verified.",
        },
      },
      required: ["title", "markdown"],
    },
    kind: "plan",
  },
  {
    name: "write_research",
    description:
      "Publish the final codebase research report as a document shown to the user in a side panel. Call this once after investigating thoroughly, then stop without planning or implementing changes.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short title describing the research topic.",
        },
        markdown: {
          type: "string",
          description:
            "The complete research report in Markdown, including findings, evidence, relevant file paths, and open questions.",
        },
      },
      required: ["title", "markdown"],
    },
    kind: "research",
  },
  {
    name: "spawn_agent",
    description:
      'Delegate a focused, read-only research question to a nested sub-agent that investigates the workspace on its own and returns a written answer. Use it to parallelize or offload self-contained investigations (e.g. "trace how auth tokens flow from login to storage", "list every call site of function X and summarize each") so your own context stays focused. The sub-agent has only read-only tools (it cannot edit files or run commands) and a limited step budget, so give it one clear, bounded task and expect a text summary back.',
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "The self-contained research task for the sub-agent, including any context it needs.",
        },
      },
      required: ["task"],
    },
    kind: "subAgent",
  },
  {
    name: "memory_save",
    description:
      'Remember a durable fact about this workspace for future runs — a stable preference, convention, or piece of project context worth recalling later (e.g. "uses Bun, not npm", "run `cargo test` from the runtime dir"). Saved memories are shown to you at the start of every run. Don\'t save transient details, secrets, or anything already obvious from the code.',
    parameters: {
      type: "object",
      properties: {
        fact: {
          type: "string",
          description:
            "The fact to remember, as a short self-contained statement.",
        },
      },
      required: ["fact"],
    },
    kind: "memory",
  },
  {
    name: "memory_list",
    description:
      "List the facts you have saved about this workspace with memory_save. The same memories are already injected at the start of the run, so use this only to review them before adding or reconciling.",
    parameters: { type: "object", properties: {}, required: [] },
    kind: "memory",
  },
  {
    name: "web_fetch",
    description:
      "Fetch a URL over HTTP(S) and return its content as text. HTML pages are reduced to readable text. Use it to read documentation, issues, or other pages the user references. Output is capped.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute http:// or https:// URL to fetch.",
        },
      },
      required: ["url"],
    },
    kind: "web",
  },
  {
    name: "web_search",
    description:
      "Search the web and return a ranked list of results (title, URL, snippet). Use it to find pages, then web_fetch the most relevant ones for details.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
      },
      required: ["query"],
    },
    kind: "web",
  },
] as const;
