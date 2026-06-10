import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, Vite serves the frontend and proxies the WebSocket to idlin-server.
// In production, idlin-server serves web/dist itself and /ws is same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    // Allow access via Tailscale MagicDNS names (dev only).
    allowedHosts: [".ts.net"],
    proxy: {
      "/ws": {
        target: "ws://localhost:7777",
        ws: true,
      },
      "/api": {
        target: "http://localhost:7777",
      },
    },
  },
});
