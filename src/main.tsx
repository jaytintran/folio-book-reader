import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register offline service worker cleanly with silent error fallback in sandboxed frames
try {
  registerSW({
    immediate: true,
    onRegisterError() {
      // Ignore SW registration errors in restricted iframe sandboxes
    },
  });
} catch {
  // Non-fatal in environments without service worker support
}

createRoot(document.getElementById('root')!).render(<App />);
