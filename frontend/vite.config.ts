/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { homeFallbackHtml, type HomeCopy } from "./home-fallback.js";

const homeCopy = JSON.parse(
  readFileSync(new URL("./src/home-copy.json", import.meta.url), "utf8"),
) as HomeCopy;

function homepageFallback(): Plugin {
  const fallback = homeFallbackHtml(homeCopy);
  return {
    name: "onlykas-homepage-fallback",
    transformIndexHtml: (html) =>
      html.replace('<div id="root"></div>', `<div id="root">${fallback}</div>`),
  };
}

export default defineConfig({
  plugins: [react(), homepageFallback()],
  server: { proxy: { "/api": "http://localhost:3000" } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test-setup.ts",
  },
});
