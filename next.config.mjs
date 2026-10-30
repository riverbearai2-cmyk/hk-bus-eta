/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export", // static build for GitHub Pages ( APIs talk CORS-direct )
  basePath: "/hk-bus-eta", // project pages URL: rb-1997.github.io/hk-bus-eta
  trailingSlash: true, // generate /map/index.html so /map/ works on GitHub Pages
  images: {
    unoptimized: true,
  },
  // PWA headers can be added via vercel.json or middleware if needed
};

export default nextConfig;