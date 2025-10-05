/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  // Required for static site generation
  output: 'export',

  // Configure the base path for GitHub Pages
  basePath: isProd ? '/ph-committee-schedules' : '',
};

export default nextConfig;
