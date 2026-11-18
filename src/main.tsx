import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/500.css';
import '@fontsource/source-serif-4/600-italic.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/source-serif-4/700.css';
import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

export const PWA_OFFLINE_READY_EVENT = 'folio:pwa-offline-ready';
export const PWA_UPDATED_EVENT = 'folio:pwa-updated';

// Register offline service worker with automatic background updates and lifecycle notifications
try {
  const swContainer =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? navigator.serviceWorker
      : null;
  const hadExistingController = Boolean(swContainer?.controller);
  let updateNotified = false;

  if (swContainer) {
    swContainer.addEventListener('controllerchange', () => {
      if (hadExistingController && !updateNotified) {
        updateNotified = true;
        window.dispatchEvent(new CustomEvent(PWA_UPDATED_EVENT));
      }
    });
  }

  registerSW({
    immediate: true,
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent(PWA_OFFLINE_READY_EVENT));
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Check for updates periodically while online and whenever connectivity resumes
      const triggerUpdateCheck = () => {
        if (navigator.onLine) {
          void registration.update().catch(() => {
            // Silently ignore offline update checks
          });
        }
      };
      window.addEventListener('online', triggerUpdateCheck);
      window.setInterval(triggerUpdateCheck, 60 * 60 * 1000);
    },
    onRegisterError() {
      // Non-fatal in restricted iframe sandboxes
    },
  });
} catch {
  // Non-fatal in environments without service worker support
}

createRoot(document.getElementById('root')!).render(<App />);
