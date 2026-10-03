const path = require("path");

module.exports = {
  reactStrictMode: true,
  // Resolve the "lockfile not found" warning during `next build` by telling
  // Next.js to look for package-lock.json in the frontend/ directory itself
  // rather than traversing up to the monorepo root.
  outputFileTracingRoot: path.join(__dirname),
};
