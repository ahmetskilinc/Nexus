import { Component, type ErrorInfo, type ReactNode } from "react";

/// Contains render-time crashes (e.g. a pathological markdown payload) to a
/// recoverable panel instead of white-screening the whole renderer.
export class ErrorBoundary extends Component<
  {
    children: ReactNode;
    fallback?: (reset: () => void, error: Error) => ReactNode;
  },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surfaced to the terminal via Electron's renderer console.
    console.error(
      "Renderer error boundary caught:",
      error,
      info.componentStack,
    );
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error)
      return (
        this.props.fallback?.(this.reset, error) ?? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div className="max-w-sm">
              <p className="text-[14px] font-medium text-foreground">
                Something went wrong
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                This view hit an error. Your work is saved; you can retry.
              </p>
              <button
                type="button"
                onClick={this.reset}
                className="mt-4 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-semibold text-primary-foreground transition hover:bg-primary-soft"
              >
                Reload this view
              </button>
            </div>
          </div>
        )
      );
    return this.props.children;
  }
}
