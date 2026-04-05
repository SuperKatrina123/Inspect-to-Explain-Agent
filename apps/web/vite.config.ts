import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_PROXY_TARGET 指定后端 server 地址，默认 localhost:3001
// 远端开发时在 apps/web/.env.local 中设置：
//   VITE_PROXY_TARGET=https://your-remote-server.com
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:3001';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // 所有 /api 请求转发到后端 server
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
