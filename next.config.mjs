/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const defaultRepoName = 'ph-congress-committee-schedules';
const repoName = process.env.GITHUB_REPOSITORY?.split('/')?.[1] || defaultRepoName;
const repoBasePath = `/${repoName}`;
const basePath = isProd ? repoBasePath : '';

const nextConfig = {
  // Required for static site generation
  output: 'export',

  // Configure the base path for GitHub Pages
  basePath: basePath || undefined,

  // Ensure all assets are requested from the correct base path in production
  assetPrefix: basePath || undefined,

  // Generate folder-based routes so nested pages (e.g. /meetings) work on GitHub Pages
  trailingSlash: true,
};

export default nextConfig;
