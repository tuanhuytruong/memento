import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';

const Entry = new URLSearchParams(window.location.search).get('uiPreview') === 'ivora'
  ? lazy(() => import('./previews/IvoraPreview.tsx'))
  : lazy(() => import('./App.tsx'));

createRoot(document.getElementById('root')!).render(
  <StrictMode><Suspense fallback={<p role="status">Loading Memento…</p>}><Entry /></Suspense></StrictMode>,
);
