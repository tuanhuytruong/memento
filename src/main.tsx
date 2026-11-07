import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';

const Entry = new URLSearchParams(window.location.search).get('uiPreview') === 'ivora'
  ? lazy(() => import('./previews/IvoraPreview.tsx'))
  : lazy(() => import('./App.tsx'));

createRoot(document.getElementById('root')!).render(
  <StrictMode><Suspense fallback={<EntryLoadingShell />}><Entry /></Suspense></StrictMode>,
);

function EntryLoadingShell() {
  return <main className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center text-stone-500"><div role="status" className="text-center"><h1 className="font-display text-2xl text-stone-800 dark:text-stone-200 mb-3">Memento</h1>Checking your session…</div></main>;
}
