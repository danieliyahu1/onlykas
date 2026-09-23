/**
 * The stored poster is versioned server-side, but the browser caches the URL
 * immutably for a year. Bumping the query string is what makes a change to the
 * treatment actually visible instead of serving the previous image forever.
 */
const PREVIEW_URL_VERSION = "8";

export function previewUrl(postId: string): string {
  return `/api/posts/${encodeURIComponent(postId)}/preview?v=${PREVIEW_URL_VERSION}`;
}
