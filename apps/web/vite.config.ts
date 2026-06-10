import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// 預設 client 以 VITE_API_BASE_URL 絕對位址直連後端，不需 proxy。
// 若設定 VITE_DEV_PROXY，則 dev server 將 /api 轉發至該目標並去除 /api 前綴（同源 / 避 CORS 用）。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_DEV_PROXY;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      ...(proxyTarget
        ? {
            proxy: {
              '/api': {
                target: proxyTarget,
                changeOrigin: true,
                rewrite: (p: string) => p.replace(/^\/api/, ''),
              },
            },
          }
        : {}),
    },
  };
});
