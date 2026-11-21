import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Boundary, ReloadNote } from './Boundary';
import './index.css';
import { getLang, loadAz } from './i18n';
import { preloadFor } from './pages/lazy';

// A file dropped anywhere but a drop zone must not make the browser open it and leave the app
// (UP-05). Drop zones cancel the events themselves first; everywhere else the drop is refused.
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types?.includes('Files');
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e) || e.defaultPrevented) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
});
window.addEventListener('drop', (e) => {
  if (hasFiles(e)) e.preventDefault();
});

preloadFor(window.location.hash);

// In Azerbaijani the first paint waits for its sentences (they are a separate file, PF-07).
const ready = getLang() === 'az' ? loadAz() : Promise.resolve();
void ready.then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Boundary
        name="app"
        fallback={
          <main className="mx-auto max-w-xl p-6">
            <ReloadNote text="Something went wrong on this page. Reload to continue." />
          </main>
        }
      >
        <App />
      </Boundary>
    </StrictMode>,
  ),
);
