import { defineConfig } from 'vite';
import { spawn } from 'child_process';

export default defineConfig({
  plugins: [
    {
      name: 'api-server',
      configureServer() {
        const api = spawn('node', ['server.js'], { stdio: 'inherit', shell: true });
        process.on('exit', () => api.kill());
      }
    }
  ],
  build: { chunkSizeWarningLimit: 600 },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
