export type RuntimeStatus = "checking" | "ready" | "offline";

export type SelectedFile = {
  path: string;
  content: string;
  patch: string;
  truncated: boolean;
  loading: boolean;
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
