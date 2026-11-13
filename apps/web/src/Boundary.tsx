import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useT } from './i18n';

/**
 * Keeps a failure in one part of the page inside that part (SD-45). The usual cause is a part of
 * the app that loads on demand (the PDF pages, the waiting-screen picture) whose file is gone
 * because a newer version was deployed while the tab was open: a reload fixes it. Without this,
 * React unmounts the whole tree and the page goes blank.
 */
export class Boundary extends Component<
  { children: ReactNode; fallback: ReactNode; name?: string },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Logged once for the person who investigates; nothing about candidates is in it.
    console.warn(`[parallax] ${this.props.name ?? 'part'} failed to show`, error.message, info);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A short note with a reload control, used inside a Boundary. */
export function ReloadNote({ text, className = '' }: { text: string; className?: string }) {
  const t = useT();
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center gap-2 p-4 text-sm text-ink-2 ${className}`}
    >
      <span>{t(text)}</span>
      <button
        type="button"
        className="rounded-full border border-edge bg-card px-3 py-1.5 font-semibold text-ink hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        onClick={() => window.location.reload()}
      >
        {t('Reload')}
      </button>
    </div>
  );
}
