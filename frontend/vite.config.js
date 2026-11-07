import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "../static/snow",
    emptyOutDir: true,
    lib: {
      entry: "src/snow.jsx",
      formats: ["iife"],
      name: "VanishSnow",
      fileName: () => "snow.js",
    },
  },
});