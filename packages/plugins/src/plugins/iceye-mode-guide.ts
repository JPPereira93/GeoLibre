import { el } from "../panel-dom";

export const ICEYE_MODE_DOCUMENTATION =
  "https://sar.iceye.com/latest/productspecification/imagingmodes/";

// Nominal ground-resolution examples from ICEYE's product specification, checked 2026-09-07.
const MODES = [
  ["Dwell", "Long observation of a small area, reducing speckle through multiple looks. Ground resolution: 1 m."],
  ["Dwell Fine", "The same long-observation approach with finer detail. Ground resolution: 0.5 m."],
  ["Dwell Precise", "The finest Dwell variant. Ground resolution: 0.25 m. Dwell scenes typically cover 5 x 5 km."],
  ["Spot family", "Focused imaging of a small area. Ground resolution: Spot 1 m; Spot Fine 0.5 m. Extended Area covers a larger scene. Check individual metadata for other variants."],
  ["Stripmap", "Continuous coverage along the satellite track. Ground resolution: 3 m; typical coverage: 30 x 50 km."],
  ["Scan / Scan Wide", "Broader coverage with coarser detail. Ground resolution: 15 m / 27 m; typical coverage: 100 x 100 km / 200 x 300 km."],
] as const;

/** Native disclosure stays keyboard accessible and keeps the catalog panel compact. */
export function buildIceyeModeGuide(): HTMLDetailsElement {
  const guide = el("details");
  guide.style.cssText = "border:1px solid hsl(var(--border));border-radius:4px;padding:8px;font-size:12px;line-height:1.5;";
  const summary = el("summary", "About ICEYE imaging modes");
  summary.style.cssText = "cursor:pointer;font-weight:600;";
  guide.append(summary, el("p", "Modes describe how the radar acquires a scene, not the file format. More detail generally means less coverage."));
  const list = el("dl");
  list.style.margin = "8px 0";
  for (const [name, description] of MODES) {
    const term = el("dt", name);
    term.style.fontWeight = "600";
    const definition = el("dd", description);
    definition.style.cssText = "margin:0 0 8px;";
    list.append(term, definition);
  }
  guide.append(list, el("p", "Ground resolution describes detail in the original imagery, not pixel spacing or the resolution of GeoLibre's display overview. These are ICEYE's listed values; individual scenes may differ. Check the asset metadata."));
  const link = el("a", "ICEYE imaging-mode documentation");
  link.href = ICEYE_MODE_DOCUMENTATION;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.cssText = "color:inherit;text-decoration:underline;";
  guide.append(link);
  return guide;
}
