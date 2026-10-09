/**
 * Document links in cells: the form stores uploads as Google Drive links,
 * one per line (`https://drive.google.com/open?id=...`). Drive's normal pages
 * refuse to be framed, but its `/preview` (files) and `embeddedfolderview`
 * (folders) pages can be shown inside the app; both run as whoever is signed
 * in to Google in the browser, so the viewer needs access to the file.
 */

export interface DocLink {
  /** The link as stored: what "open in a new tab" uses. */
  url: string;
  /** Embeddable page for the side panel; null when the link can't be framed (not Drive). */
  previewUrl: string | null;
  /** Small first-page image for the hover card; null when there isn't one. */
  thumbnailUrl: string | null;
}

const DRIVE_HOST = /^https:\/\/(drive|docs)\.google\.com\//;

function toDocLink(url: string): DocLink {
  if (DRIVE_HOST.test(url)) {
    const folder = url.match(/\/folders\/([\w-]{10,})/)?.[1];
    if (folder) {
      return { url, previewUrl: `https://drive.google.com/embeddedfolderview?id=${folder}#list`, thumbnailUrl: null };
    }
    const id = url.match(/[?&]id=([\w-]{10,})/)?.[1] ?? url.match(/\/d\/([\w-]{10,})/)?.[1];
    if (id) {
      return {
        url,
        previewUrl: `https://drive.google.com/file/d/${id}/preview`,
        thumbnailUrl: `https://drive.google.com/thumbnail?id=${id}&sz=w480`,
      };
    }
  }
  return { url, previewUrl: null, thumbnailUrl: null };
}

/** Every http(s) link in a cell value (several files are stored one per line). */
export function docLinksIn(value: unknown): DocLink[] {
  if (typeof value !== "string") return [];
  return value
    .split(/\s+/)
    .filter((part) => /^https?:\/\//.test(part))
    .map(toDocLink);
}
