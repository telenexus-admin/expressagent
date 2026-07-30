import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The billing/admin workspace is an always-current operational console.
  // Do not register a service worker here: stale lazy-route chunks can leave
  // authenticated users stuck on a cache-recovery screen after a deployment.
  plugins: [react()],
  server: {
    port: 5173,
  },
});
