import { defineConfig, loadEnv, type ProxyOptions, type UserConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import Inspect from 'vite-plugin-inspect';
import { visualizer } from 'rollup-plugin-visualizer';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons';
import compression from 'vite-plugin-compression';
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(async ({ mode, command, isPreview }): Promise<UserConfig> => {
  const env = loadEnv(mode, projectRoot, '');
  const isDevServer = command === 'serve' && !isPreview;
  const isBuild = command === 'build';
  // 0.5.1 的压缩缓存位于模块顶层；Rolldown 顺序运行 closeBundle 时，
  // 第二种算法会被第一种算法的缓存跳过。用固定 URL query 隔离 Brotli 实例。
  const compressionUrl = new URL(import.meta.resolve('vite-plugin-compression'));
  compressionUrl.searchParams.set('cipher-lab', 'brotli');
  const brotliCompression: typeof compression = isBuild
    ? (await import(compressionUrl.href) as typeof import('vite-plugin-compression')).default
    : compression;
  const proxyLogging = env.PROXY_LOG !== 'false';
  const apiTarget = `http://127.0.0.1:${env.API_PORT || '8787'}`;
  const key = resolve(projectRoot, '.certs/localhost-key.pem');
  const cert = resolve(projectRoot, '.certs/localhost.pem');
  const hasCertificates = existsSync(key) && existsSync(cert);
  if (command === 'serve' && !hasCertificates) {
    throw new Error('运行 npm run certs 生成本地 HTTPS 证书；dev / preview 脚本会自动生成。');
  }
  // 开发和构建预览复用 HTTPS 与同源 API 代理，保留完整 /api 路径和认证头。
  const https = hasCertificates ? { key: readFileSync(key), cert: readFileSync(cert) } : undefined;
  const proxy: Record<string, ProxyOptions> = {
    '/api': {
      target: apiTarget,
      changeOrigin: false,
      configure(proxy) {
        const startedAt = new WeakMap<IncomingMessage, number>();
        const requestLabel = (req: IncomingMessage) => `${req.method ?? 'GET'} ${req.url?.split('?')[0] ?? '/'}`;

        // 观察代理过程；不读取流，不修改参与加密上下文绑定的路径和 Authorization。
        proxy.on('proxyReq', (proxyReq, req) => {
          startedAt.set(req, performance.now());
          if (proxyLogging) {
            console.info(`[proxy:req] ${proxyReq.method} ${proxyReq.path.split('?')[0]} -> ${apiTarget}`);
          }
        });

        proxy.on('proxyRes', (proxyRes, req) => {
          const start = startedAt.get(req);
          const duration = start === undefined ? 'n/a' : `${(performance.now() - start).toFixed(1)}ms`;
          startedAt.delete(req);
          if (proxyLogging) {
            // proxyRes 在收到上游响应头时触发，耗时不包含整个响应体的下载。
            console.info(`[proxy:res] ${requestLabel(req)} status=${proxyRes.statusCode ?? '-'} headers=${duration}`);
          }
        });

        proxy.on('error', (error, req) => {
          startedAt.delete(req);
          console.error(`[proxy:error] ${requestLabel(req)} -> ${apiTarget} ${(error as NodeJS.ErrnoException).code ?? error.name}`);
        });
      },
    },
  };
  return {
    // Inspect 12 由 Vite DevTools 承载，开发入口为 /__devtools/。
    devtools: isDevServer ? { apply: 'serve' } : false,
    plugins: [
      vue(),
      isDevServer && Inspect(),
      isDevServer && codeInspectorPlugin({ bundler: 'vite', lang: 'zh' }),
      createSvgIconsPlugin({
        iconDirs: [resolve(projectRoot, 'src/assets/icons')],
        symbolId: 'icon-[dir]-[name]',
        inject: 'body-first',
        customDomId: '__cipher_lab_svg_icons__',
      }),
      // 构建时生成旁路压缩文件，保留原文件供未启用压缩协商的服务器使用。
      isBuild && compression({
        algorithm: 'gzip', ext: '.gz', threshold: 10 * 1024,
        filter: /\.(js|mjs|css|html|json|svg)$/i, deleteOriginFile: false,
      }),
      isBuild && brotliCompression({
        algorithm: 'brotliCompress', ext: '.br', threshold: 10 * 1024,
        filter: /\.(js|mjs|css|html|json|svg)$/i, deleteOriginFile: false,
      }),
      // 报告输出到 artifacts，不随 dist 发布；放最后以统计最终产物。
      isBuild && visualizer({
        filename: resolve(projectRoot, 'artifacts/bundle-report.html'),
        title: 'Cipher Lab · Bundle Report',
        template: 'treemap', open: false, gzipSize: true, brotliSize: true,
      }),
    ],
    server: {
      host: '127.0.0.1',
      port: 5178,
      strictPort: false, // 被占用时依次尝试 5179、5180……
      https,
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 4178,
      strictPort: false, // 被占用时依次尝试 4179、4180……
      https,
      proxy,
    },
  };
});
