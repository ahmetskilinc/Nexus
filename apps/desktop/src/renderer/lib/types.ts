export type RuntimeStatus = "checking" | "ready" | "offline";

export type SelectedFile = {
  path: string;
  content: string;
  patch: string;
  truncated: boolean;
  loading: boolean;
  /// Bumps whenever the preview is refreshed so renderers cannot reuse stale
  /// syntax-highlight caches when content length happens to be unchanged.
  revision: number;
};

/// An open editor tab. `path` undefined = an empty "Open file" tab.
export type EditorTab = {
  id: string;
  path?: string;
};

export type WorkspaceSummary = {
  path: string;
  name: string;
  chatCount: number;
  updatedAt: string;
};
