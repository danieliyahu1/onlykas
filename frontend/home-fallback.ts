export interface HomeCopy {
  headline: string;
  lede: string;
  moneyHeading: string;
  moneyIntro: string;
  moneyPoints: { claim: string; detail: string }[];
  fanHeading: string;
  fanLede: string;
}

/**
 * Static homepage shell baked into index.html. Crawlers that do not run
 * JavaScript still see the 1% fee, KAS payments, and 30-day subscriptions.
 */
export function homeFallbackHtml(copy: HomeCopy): string {
  const points = copy.moneyPoints
    .map(
      (point) =>
        '<li><p class="money-claim">' +
        `${escapeHtml(point.claim)}</p>` +
        `<p class="money-detail">${escapeHtml(point.detail)}</p></li>`,
    )
    .join("");
  return (
    '<div class="home-page">' +
    '<section class="home-section home-intro">' +
    `<h1>${escapeHtml(copy.headline)}</h1>` +
    `<p class="home-lede">${escapeHtml(copy.lede)}</p>` +
    "</section>" +
    '<section class="home-section home-why">' +
    `<h2 class="home-section-title">${escapeHtml(copy.moneyHeading)}</h2>` +
    `<p class="home-lede">${escapeHtml(copy.moneyIntro)}</p>` +
    `<ul class="home-money">${points}</ul>` +
    '<a class="home-powered" href="https://kaspa.org/">Powered by Kaspa</a>' +
    "</section>" +
    '<section class="home-section">' +
    `<h2 class="home-section-title">${escapeHtml(copy.fanHeading)}</h2>` +
    `<p class="home-lede">${escapeHtml(copy.fanLede)}</p>` +
    "</section>" +
    "</div>"
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
