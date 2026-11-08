import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '');
  const clientPort = Number(env.APP_CLIENT_PORT || 5173);
  const serverPort = Number(env.APP_SERVER_PORT || 3001);
  const protocol = env.APP_PUBLIC_SERVER_PROTOCOL || 'http';
  const publicHost = env.APP_PUBLIC_SERVER_HOST || 'localhost';

  return {
    envDir: projectRoot,
    plugins: [react()],
    define: mode === 'development'
      ? { 'import.meta.env.VITE_SIGNAL_URL': JSON.stringify(env.VITE_SIGNAL_URL || `${protocol}://${publicHost}:${serverPort}`) }
      : env.VITE_SIGNAL_URL ? { 'import.meta.env.VITE_SIGNAL_URL': JSON.stringify(env.VITE_SIGNAL_URL) } : undefined,
    server: {
      host: env.APP_CLIENT_HOST || '0.0.0.0',
      port: clientPort,
      strictPort: true,
    },
  };
});
