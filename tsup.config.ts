import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"], // Entry point of the library
  format: ["cjs", "esm"], // Generate for old Node and modern Browsers
  dts: true, // Generate TypeScript declaration files
  splitting: false, // Disable code splitting
  sourcemap: true, // Generate source maps for debugging
  clean: true, // Clear dist folder before build
  minify: true, // Minify the code for production
});
