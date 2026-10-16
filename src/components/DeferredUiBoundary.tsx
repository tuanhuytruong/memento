import React from 'react';

/** A failed optional chunk must not blank the authenticated timeline. */
export class DeferredUiBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  declare props: React.PropsWithChildren;
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert" className="fixed bottom-4 left-4 z-[100] max-w-sm rounded-xl border border-stone-300 bg-white p-4 text-sm shadow-lg dark:border-stone-700 dark:bg-stone-900">
      <p>This view could not load. Your saved memories are unchanged.</p>
      <button type="button" className="mt-2 min-h-11 rounded-lg bg-stone-900 px-3 text-white dark:bg-stone-100 dark:text-stone-900" onClick={() => window.location.reload()}>Reload app</button>
    </div>;
    return this.props.children;
  }
}
