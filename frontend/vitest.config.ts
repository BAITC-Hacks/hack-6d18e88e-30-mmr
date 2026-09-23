import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Auth uses Vitest mocks; platform suites use Node's own test runner.
export default defineConfig({
  plugins: [react()],
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
