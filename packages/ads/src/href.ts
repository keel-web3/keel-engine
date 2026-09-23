// Links out of a game: only ever http or https, parsed, never a script or a
// data URL -- and never followed without the player seeing where it goes.

/** The URL if it's a well-formed http(s) link, else null. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url || url.length > 2048) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!u.hostname || u.username || u.password) return null;
  return u.href;
}

/** Just the host of a link (what a confirm shows first): "example.com". */
export function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}
