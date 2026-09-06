import { loadStacItem, type StacItem } from "./stac-api";

function iceyeUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      ["iceye-open-data-catalog.s3.amazonaws.com", "iceye-open-data-catalog.s3-us-west-2.amazonaws.com"].includes(url.host)
      ? url : null;
  } catch { return null; }
}

export function isIceyeFootprintSource(value: unknown): boolean {
  return iceyeUrl(value)?.pathname === "/stac-items/summary/footprint-summary-points.geojson";
}

export function iceyeFootprintReference(properties: Record<string, unknown> | null | undefined): { id: string; href: string } | null {
  const url = iceyeUrl(properties?.href);
  const id = properties?.id;
  if (!url || typeof id !== "string" || !/^ICEYE_[A-Za-z0-9_]+$/.test(id) ||
      !/^\/stac-items\/\d{4}\/\d{2}\//.test(url.pathname) ||
      url.pathname.split("/").at(-1) !== `${id}.json`) return null;
  return { id, href: url.href };
}

export async function loadIceyeFootprintItem(reference: { id: string; href: string }, signal?: AbortSignal): Promise<StacItem> {
  if (!iceyeFootprintReference(reference)) throw new Error("Invalid ICEYE scene link.");
  const item = await loadStacItem(reference.href, fetch, signal);
  if (item.id !== reference.id) throw new Error("The linked ICEYE scene does not match this footprint.");
  return item;
}

/** The mode is named by ICEYE's data asset paths, not the broader SAR instrument mode. */
export function iceyeItemMode(item: StacItem): string | null {
  for (const asset of Object.values(item.assets ?? {})) {
    const path = iceyeUrl(asset.href)?.pathname;
    const mode = path?.match(/^\/data\/([a-z0-9-]+)\//)?.[1];
    if (mode) return mode;
  }
  return null;
}
