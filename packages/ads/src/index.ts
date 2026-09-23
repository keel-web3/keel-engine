export { manifest } from "./module.ts";
export type { AdCreative, AdKind, AdSlot, AdSource } from "./types.ts";
export { hostOf, safeHref } from "./href.ts";
export { firstOf, houseSource, listSource } from "./sources.ts";
export type { Ray, RayCamera } from "./pick.ts";
export { pickSlot, rayOf } from "./pick.ts";
export { decodeAdRegistry, feedUrl, parseAdFeed, resolveAdFeed, watchAdFeed } from "./feed.ts";
export type { AdFeed, AdFeedSource, AdPlacement, FeedAd } from "./feed.ts";
