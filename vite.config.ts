/// <reference types="vitest" />
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
        },
        '/files': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
        },
      },
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // 预打包重型依赖，避免 Vite dev 模式首屏 transform 60+ 个 ESM 时的瀑布延迟。
    // 测试模式跳过（vitest 自己处理依赖，optimizeDeps 会破坏动态 import 解析）。
    optimizeDeps: process.env.VITEST ? { include: [] } : {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'framer-motion',
        'lucide-react',
        'zustand',
      ],
    },
    build: {
      // 拆 vendor chunk 让浏览器并行下载并独立缓存
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-dom/client'],
            'motion': ['framer-motion'],
            'icons': ['lucide-react'],
          },
        },
      },
    },
    test: {
      environment: 'happy-dom',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.{test,spec}.{ts,tsx}'],
      // 把 React.lazy 动态 import 的目录强制 inline，让 vitest 在 happy-dom 环境能正常 resolve
      // 动态 import（不 inline 会因 Vite SSR transform 失败导致 __vite_ssr_import_*.ap undefined）。
      server: {
        deps: {
          inline: [
            /^agent\//,
            /^components\/infinite-canvas\//,
            /^components\/infinite-canvas$/,
          ],
        },
      },
    },
  };
});
