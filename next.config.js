/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Remove X-Powered-By header for security
  poweredByHeader: false,

  // Enable gzip/brotli compression on Vercel edge
  compress: true,

  // Use sharp (installed as devDep) for image optimisation on Vercel
  images: {
    formats: ["image/avif", "image/webp"],
  },

  // Prevent Next.js from bundling Node built-ins on the client
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        stream: false,
        buffer: false,
      };
    }
    return config;
  },

  async headers() {
    return [
      {
        // Service worker must not be cached so updates are picked up immediately
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Immutable cache for hashed static assets
        source: "/_next/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
