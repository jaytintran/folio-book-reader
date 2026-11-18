import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function stagePdfJsOfflineAssets(rootDir: string) {
  const folders = ['cmaps', 'standard_fonts', 'wasm'] as const;
  const srcBase = path.resolve(rootDir, 'node_modules/pdfjs-dist');
  const destBase = path.resolve(rootDir, 'public/pdfjs');

  for (const folder of folders) {
    const srcDir = path.join(srcBase, folder);
    const destDir = path.join(destBase, folder);
    if (!fs.existsSync(srcDir)) continue;

    // Skip copying if already staged with matching entry count
    const srcFiles = fs.readdirSync(srcDir);
    const alreadyStaged =
      fs.existsSync(destDir) && fs.readdirSync(destDir).length >= srcFiles.length;
    if (!alreadyStaged) {
      fs.mkdirSync(destDir, {recursive: true});
      fs.cpSync(srcDir, destDir, {recursive: true, force: true});
    }
  }
}

export default defineConfig(() => {
  return {
    plugins: [
      // Stage PDF.js CMaps, standard fonts, and WASM decoders into public/pdfjs/
      // so both dev server and production builds precache 100% of PDF decoding assets locally.
      {
        name: 'stage-pdfjs-offline-assets',
        configResolved(config) {
          stagePdfJsOfflineAssets(config.root);
        },
        buildStart() {
          stagePdfJsOfflineAssets(__dirname);
        },
      },
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: 'Folio — Offline E-Book Reader & Library',
          short_name: 'Folio',
          description:
            'Offline-first desktop e-book reader and library manager with Sepia and Dark themes for PDF, EPUB, and MOBI collections.',
          theme_color: '#F4EFE6',
          background_color: '#F4EFE6',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          launch_handler: {
            client_mode: 'focus-existing',
          },
          file_handlers: [
            {
              action: '/',
              accept: {
                'application/epub+zip': ['.epub'],
                'application/pdf': ['.pdf'],
                'application/x-mobipocket-ebook': ['.mobi', '.prc'],
                'application/octet-stream': ['.mobi'],
              },
            },
          ],
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        } as Record<string, unknown>,
        workbox: {
          // Precache complete app shell, local fonts, icons, PDF worker, CMaps, standard fonts & WASM on first load
          globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,woff,woff2,bcmap,pfb,ttf,wasm}'],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/pdfjs\//, /^\/assets\//],
          runtimeCaching: [
            {
              // Same-origin CacheFirst safety net for PDF decoders and static assets (also helps dev-mode SW)
              urlPattern: ({sameOrigin, url}) =>
                sameOrigin &&
                (url.pathname.startsWith('/pdfjs/') || url.pathname.startsWith('/assets/')),
              handler: 'CacheFirst',
              options: {
                cacheName: 'folio-static-assets',
                expiration: {
                  maxEntries: 320,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
