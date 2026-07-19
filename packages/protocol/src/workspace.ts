/// One fact the agent saved about a workspace via memory_save.
export type Memory = {
  id: string;
  fact: string;
  /// Milliseconds since the Unix epoch when the fact was saved.
  createdAt: number;
};

export type WorkspaceChange = {
  path: string;
  status:
    | "added"
    | "conflicted"
    | "deleted"
    | "ignored"
    | "modified"
    | "renamed"
    | "untracked";
  staged: boolean;
  unstaged: boolean;
};
