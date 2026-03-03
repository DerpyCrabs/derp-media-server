const nextConfig = {
  devIndicators: false,
  ...(process.env.NEXT_TEST_DIR ? { distDir: process.env.NEXT_TEST_DIR } : {}),
}
export default nextConfig
