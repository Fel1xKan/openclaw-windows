import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  define: {
    // Build-time flag to enable/disable auto-update
    // Usage: ENABLE_AUTO_UPDATE=false npm run make
    ENABLE_AUTO_UPDATE: JSON.stringify(process.env.ENABLE_AUTO_UPDATE !== 'false'),
  },
  build: {
    rollupOptions: {
      external: ['electron', 'electron-squirrel-startup'],
    },
  },
});
