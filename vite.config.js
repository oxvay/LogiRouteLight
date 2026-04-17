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
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
