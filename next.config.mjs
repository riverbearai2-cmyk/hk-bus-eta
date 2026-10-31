/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath: "", // Vercel: serve at domain root, no /hk-bus-eta prefix
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
