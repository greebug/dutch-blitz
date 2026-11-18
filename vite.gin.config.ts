import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Napoletane Gin Rummy's own build.
 *
 * A second Vite config rather than a route inside the Blitz bundle, because the
 * two apps are served at different prefixes and `base` is per-build: Blitz is
 * `/blitz/` and this is `/gin/`. Same reasoning as Trio being its own static
 * app inside this service -- one Railway service, several independent games,
 * each owning its own prefix end to end so the hub Worker only ever has to map
 * a prefix to an origin.
 *
 * The engine in `src/gin/` is shared with the server by plain import, so there
 * is nothing to duplicate between this build and the multiplayer layer later.
 */
export default defineConfig({
  base: '/gin/',
  plugins: [
    react(),
    {
      // `rollupOptions.input` only applies to a build, so in dev Vite resolves
      // bare `/gin/` to the project root's index.html -- which is BLITZ's entry,
      // sitting right there in the same directory. The result is `npm run
      // dev:gin` quietly serving the wrong game. Production never hits this
      // (Express sends gin.html for everything under /gin), so this exists
      // purely to make dev match deployed behaviour.
      name: 'gin-dev-entry',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          // Split the query off first: `/gin/?deck` is the same entry as
          // `/gin/`, and an exact-match check silently serves Blitz instead.
          const [pathname, query] = (req.url ?? '').split('?');
          if (pathname === '/gin/' || pathname === '/gin') {
            req.url = `/gin/gin.html${query ? `?${query}` : ''}`;
          }
          next();
        });
      },
    },
  ],
  build: {
    outDir: 'gin-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'gin.html',
    },
  },
  server: {
    host: true,
    // Accounts come from Guesswhere for every game on the domain. Mirrored from
    // the Blitz config so signing in works from `npm run dev:gin` too, once
    // this screen grows an account bar.
    proxy: {
      // Hand logs from solo play go to the game server, as they do in production.
      '/gin/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // The multiplayer half is a NAMESPACE on the Blitz socket.io server, so
      // it shares the same fixed /socket.io path and the same dev proxy target.
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
      '/guesswhere': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
