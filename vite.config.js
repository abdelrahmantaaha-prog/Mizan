import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        // Split the framework and the icon set out of the app chunk: they
        // change far less often than the app does, so a rebuild does not
        // invalidate them in everyone's cache.
        manualChunks: {
          react: ["react", "react-dom"],
          icons: ["lucide-react"],
        },
      },
    },
  },
  server: {
    // `vercel dev` serves the API; without this the app's /api calls 404 in
    // plain `vite dev` and sync quietly reports itself unavailable, which is
    // the intended local-only behaviour.
    proxy: process.env.MIZAN_API_PROXY
      ? { "/api": { target: process.env.MIZAN_API_PROXY, changeOrigin: true } }
      : undefined,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // "prompt", not "autoUpdate": a silent swap can reload the app mid-entry.
      // App.jsx surfaces a "new version ready" toast instead.
      registerType: "prompt",
      includeAssets: ["favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "Mizan — net worth & expenses",
        short_name: "Mizan",
        description:
          "Net-worth and expense tracker built for Egyptian holdings: gold by karat, multi-currency cash, liquid-only allocation.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0C1730",
        theme_color: "#0C1730",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Log a transaction", short_name: "Log", url: "/?tab=activity" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,webmanifest}"],
        // never let the service worker answer an API call from cache — a stale
        // session or a stale synced document is worse than a failed request
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
          {
            // cache Google Fonts so the installed app keeps its type offline
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-css", expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-files",
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
