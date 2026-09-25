import { SITE, publicPageByPath, type PublicPage } from "@kaskama/shared";

export interface PublicRouteMatch {
  /** 200 for a real page, 404 for a route the client does not know. */
  status: 200 | 404;
  title: string;
  description: string;
  canonicalPath: string;
  /**
   * Static app-shell markup placed inside #root. Left undefined to keep the
   * fallback baked into the build for routes whose client page needs the app.
   */
  body?: string;
}

const CREATORS_BODY =
  '<div class="find-page"><header><h1>Creators.</h1></header>' +
  '<p class="feedback inline">Browse creators publishing paid photos and videos on Kaskama.</p></div>';

const FIND_BODY =
  '<div class="find-page"><header><h1>Find a creator.</h1></header>' +
  '<p class="feedback inline">Search Kaskama creators by name or wallet address.</p></div>';

const PUBLISH_BODY =
  '<div class="find-page"><header><h1>Publish your work.</h1></header>' +
  '<p class="feedback inline">Connect your Kasware wallet to publish paid photos and videos on Kaskama.</p></div>';

const CREATOR_BODY =
  '<div class="find-page"><header><h1>Creator.</h1></header>' +
  '<p class="feedback inline">Unlock this creator\u2019s paid photos and videos with Kaspa.</p></div>';

const POST_BODY =
  '<div class="find-page"><header><h1>Post.</h1></header>' +
  '<p class="feedback inline">Unlock this post with Kaspa to support the creator.</p></div>';

const NOT_FOUND_BODY =
  '<div class="message"><h1 class="message-title">Page not found.</h1></div>';

interface RouteMeta {
  title: string;
  description: string;
  body?: string;
}

const APP_ROUTE_META: Record<string, RouteMeta> = {
  "/": { title: SITE.title, description: SITE.description },
  "/creators": {
    title: "Creators — Kaskama",
    description:
      "Browse creators publishing paid photos and videos on Kaskama and unlock their work with Kaspa.",
    body: CREATORS_BODY,
  },
  "/find": {
    title: "Find a creator — Kaskama",
    description: "Search Kaskama creators by name or wallet address.",
    body: FIND_BODY,
  },
  "/publish": {
    title: "Publish — Kaskama",
    description:
      "Publish paid photos and videos, set your own price, and get paid directly by fans on Kaspa.",
    body: PUBLISH_BODY,
  },
};

const CREATOR_PATH = /^\/creator\/[^/]+$/;
const POST_PATH = /^\/post\/[^/]+$/;

const NOT_FOUND: Omit<PublicRouteMatch, "status" | "canonicalPath"> = {
  title: "Page not found — Kaskama",
  description: "This page does not exist on Kaskama.",
  body: NOT_FOUND_BODY,
};

/** Resolves a request path to the document the server should return. */
export function matchPublicRoute(pathname: string): PublicRouteMatch {
  const path = normalizePath(pathname);
  const appRoute = APP_ROUTE_META[path];
  if (appRoute) {
    return { status: 200, ...appRoute, canonicalPath: path };
  }
  const page = publicPageByPath(path);
  if (page) {
    return {
      status: 200,
      title: page.title,
      description: page.description,
      canonicalPath: page.path,
      body: documentBody(page),
    };
  }
  if (CREATOR_PATH.test(path)) {
    return {
      status: 200,
      title: "Creator — Kaskama",
      description:
        "A creator on Kaskama. Unlock their paid photos and videos with Kaspa.",
      canonicalPath: path,
      body: CREATOR_BODY,
    };
  }
  if (POST_PATH.test(path)) {
    return {
      status: 200,
      title: "Post — Kaskama",
      description:
        "A paid post on Kaskama. Unlock it with Kaspa to support the creator.",
      canonicalPath: path,
      body: POST_BODY,
    };
  }
  return { status: 404, ...NOT_FOUND, canonicalPath: path };
}

/**
 * Rewrites the built index.html so the first response describes the requested
 * page, not the homepage.
 */
export function renderDocument(
  template: string,
  match: PublicRouteMatch,
  origin: string,
): string {
  let html = template.replace(
    /<title>[\s\S]*?<\/title>/,
    () => `<title>${escapeHtml(match.title)}</title>`,
  );
  html = setContent(
    html,
    /(<meta\s+name="description"\s+content=")[^"]*(")/,
    match.description,
  );
  const canonical =
    match.status === 404 ? null : new URL(match.canonicalPath, origin).toString();
  if (canonical === null) {
    html = html.replace(/\s*<link\s+rel="canonical"[^>]*>/, "");
    html = html.replace(
      /<\/head>/,
      () => `    <meta name="robots" content="noindex" />\n  </head>`,
    );
  } else {
    html = setContent(html, /(<link\s+rel="canonical"\s+href=")[^"]*(")/, canonical);
  }
  html = setContent(
    html,
    /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
    match.title,
  );
  html = setContent(
    html,
    /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
    match.description,
  );
  html = setContent(
    html,
    /(<meta\s+property="og:url"\s+content=")[^"]*(")/,
    canonical ?? origin,
  );
  html = setContent(
    html,
    /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/,
    match.title,
  );
  html = setContent(
    html,
    /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,
    match.description,
  );
  if (match.body !== undefined) {
    html = html.replace(
      /(<div id="root">)[\s\S]*(<\/div>\s*<\/body>)/,
      (_match, open: string, close: string) => `${open}${match.body}${close}`,
    );
  }
  return html;
}

function documentBody(page: PublicPage): string {
  const paragraph = (text: string) => `<p>${escapeHtml(text)}</p>`;
  const sections = page.sections
    .map(
      (section) =>
        `<section><h2>${escapeHtml(section.heading)}</h2>${section.paragraphs
          .map(paragraph)
          .join("")}</section>`,
    )
    .join("");
  return (
    `<div class="legal-page"><h1>${escapeHtml(page.heading)}</h1>` +
    `<p class="legal-updated">Last updated: ${escapeHtml(page.updated)}</p>` +
    page.intro.map(paragraph).join("") +
    sections +
    "</div>"
  );
}

function normalizePath(pathname: string): string {
  if (pathname.length <= 1) return "/";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

function setContent(html: string, pattern: RegExp, value: string): string {
  return html.replace(
    pattern,
    (_match, prefix: string, suffix: string) =>
      `${prefix}${escapeHtml(value)}${suffix}`,
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
