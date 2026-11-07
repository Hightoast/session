import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "../static/leaves",
    emptyOutDir: true,
    lib: {
      entry: "src/leaves.jsx",
      formats: ["iife"],
      name: "VanishLeaves",
      fileName: () => "leaves.js",
    },
  },
});