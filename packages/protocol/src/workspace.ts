/// One fact the agent saved about a workspace via memory_save.
export type Memory = {
  id: string;
  fact: string;
  /// Milliseconds since the Unix epoch when the fact was saved.
  createdAt: number;
};

/// How the checked-out branch relates to its upstream.
export type BranchSync = {
  /// Null on a detached HEAD.
  branch: string | null;
  /// Remote-tracking ref ("origin/main"), or null when nothing is tracked.
  upstream: string | null;
  /// Commits on HEAD that the upstream lacks — what a push would send.
  ahead: number;
  /// Commits on the upstream that HEAD lacks.
  behind: number;
  /// Whether the repository has any remote at all to push to.
  hasRemote: boolean;
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
