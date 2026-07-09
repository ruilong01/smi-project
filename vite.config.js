import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Vendor chunking (Goal 5): heavy stable dependencies get their own
        // cached chunks so app-code changes don't re-download them, and the
        // main chunk stays small.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-motion": ["framer-motion"],
          "vendor-geo": ["d3-geo", "topojson-client", "topojson-simplify"],
          "vendor-atlas": ["world-atlas/countries-50m.json"],
        },
      },
    },
  },
});
