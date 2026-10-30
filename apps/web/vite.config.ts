/** Configura sviluppo e test: /api viene inoltrato al backend, senza CORS aggiuntivo. */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
