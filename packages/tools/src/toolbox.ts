/// The read-only tool dispatcher. Failures addressed to the model are thrown
/// as ToolError with the Rust runtime's exact sentences (sans the "Error: "
/// prefix, which the agent loop prepends when rendering the tool result).

import { asRecord, ToolError } from "@nexus/protocol";
import { gitDiffTool, gitStatusTool } from "./git-readonly";
import { listDirectoryTool, readFileTool } from "./read";
import { globTool, grepTool } from "./search";
import { countCodePoints, OUTPUT_LIMIT, takeCodePoints } from "./util";

export class Toolbox {
  constructor(readonly workspace: string) {}

  async execute(
    name: string,
    args: unknown,
    _signal?: AbortSignal,
  ): Promise<string> {
    const record = asRecord(args) ?? {};
    let output: string;
    switch (name) {
      case "read_file":
        output = readFileTool(this.workspace, record);
        break;
      case "list_directory":
        output = listDirectoryTool(this.workspace, record);
        break;
      case "grep":
        output = grepTool(this.workspace, record);
        break;
      case "glob":
        output = globTool(this.workspace, record);
        break;
      case "git_status":
        output = await gitStatusTool(this.workspace);
        break;
      case "git_diff":
        output = await gitDiffTool(this.workspace, record);
        break;
      default:
        throw new ToolError(`unknown tool "${name}".`);
    }
    if (countCodePoints(output) <= OUTPUT_LIMIT) return output;
    const truncated = takeCodePoints(output, OUTPUT_LIMIT);
    return `${truncated}\n\n[Output truncated at ${OUTPUT_LIMIT} characters]`;
  }
}
