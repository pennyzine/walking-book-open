/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  poweredByHeader: false,
  async headers() {
    const isProd = process.env.NODE_ENV === "production"

    // Baseline CSP for a Next.js PWA that uses module workers + WASM (Moonshine/onnxruntime-web).
    // This is intentionally "practical secure" rather than maximally strict.
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      // Allow embedding the Quick Start guide from Gamma.
      // Without an explicit frame-src/child-src, many browsers will apply default-src and block cross-origin iframes.
      "frame-src 'self' https://gamma.app",
      "child-src 'self' https://gamma.app",
      "form-action 'self'",
      // Next uses inline styles and some components may inject style tags.
      "style-src 'self' 'unsafe-inline'",
      // Next uses inline scripts for bootstrapping; keep eval only in dev to avoid breaking tooling.
      // ONNX Runtime Web (Moonshine) requires wasm-unsafe-eval for WebAssembly compilation in Chromium.
      `script-src 'self' 'unsafe-inline'${isProd ? " 'wasm-unsafe-eval'" : " 'unsafe-eval' 'wasm-unsafe-eval'"}`,
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "media-src 'self' data: blob:",
      // Allow module workers (Moonshine worker) and Next's internal blob workers.
      "worker-src 'self' blob:",
      "connect-src 'self'",
      "manifest-src 'self'",
      "upgrade-insecure-requests",
    ].join("; ")

    return [
      {
        source: "/:path*",
        headers: [
          // Transport security (only effective when served over HTTPS).
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },

          // Baseline browser hardening.
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },

          // Keep needed capabilities (microphone) scoped to self.
          {
            key: "Permissions-Policy",
            value:
              "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
        ],
      },
    ]
  },
}

export default nextConfig
