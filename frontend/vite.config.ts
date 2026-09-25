/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const homeCopy = JSON.parse(
  readFileSync(new URL("./src/home-copy.json", import.meta.url), "utf8"),
) as { headline: string; lede: string };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function homepageFallback(): Plugin {
  const fallback =
    '<div class="home-page"><section class="home-section home-intro">' +
    `<h1>${escapeHtml(homeCopy.headline)}</h1>` +
    `<p class="home-lede">${escapeHtml(homeCopy.lede)}</p>` +
    "</section></div>";
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
