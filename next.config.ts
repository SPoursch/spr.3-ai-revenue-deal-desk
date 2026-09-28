import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not advertise the framework in an `X-Powered-By` header.
  poweredByHeader: false,

  /*
    Security headers that are the same for every response. The
    Content-Security-Policy is not here: it carries a per-request nonce and is
    set in proxy.ts. `X-Frame-Options` duplicates its `frame-ancestors 'none'`
    for browsers that predate CSP, and covers responses the proxy skips.
  */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
