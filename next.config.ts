import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: [
    'argon2',
    'pino',
    'pino-pretty',
    'mariadb',
    '@prisma/adapter-mariadb',
    '@opentelemetry/sdk-node',
    'web-tree-sitter',
    '@vscode/tree-sitter-wasm',
  ],
  headers: async () => [
    {
      source: '/api/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
      ],
    },
  ],
};

export default nextConfig;
