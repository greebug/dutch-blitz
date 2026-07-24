import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The game is served from bingbongblitz.com/blitz, behind the hub Worker
  // that routes the domain's paths to each game. This makes the built bundle
  // request /blitz/assets/* instead of /assets/*, matching where Express
  // mounts the static directory in production.
  base: '/blitz/',
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      // Forward all socket.io traffic (HTTP + WebSocket upgrade) to the game server
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
