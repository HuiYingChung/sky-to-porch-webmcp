/** @type {import('next').NextConfig} */
const nextConfig = {
  // An isolated build directory (e.g. NEXT_DIST_DIR=.next-e2e) lets a
  // verification build and its E2E production server run while a developer's
  // `next dev` keeps writing to the default .next — the two corrupt each
  // other when shared. Build and start must use the same value.
  ...(process.env.NEXT_DIST_DIR?.trim() ? { distDir: process.env.NEXT_DIST_DIR.trim() } : {}),
  webpack(config) {
    // The canonical contracts are authored for NodeNext and intentionally use
    // explicit `.js` specifiers. Resolve those specifiers to their TypeScript
    // sources when the same contracts are bundled into a Next.js route.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
