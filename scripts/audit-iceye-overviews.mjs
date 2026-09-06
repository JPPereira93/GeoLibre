import { fromUrl } from "geotiff";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = "https://iceye-open-data-catalog.s3.amazonaws.com/";
const response = await fetch(`${base}stac-items/summary/footprint-summary-points.geojson`);
if (!response.ok) throw new Error(`Footprints: ${response.status}`);
const { features } = await response.json();
const results = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (cursor < features.length) {
      const { properties } = features[cursor++];
      const result = { id: properties.id, assets: {} };
      try {
        const response = await fetch(properties.href, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`Item: ${response.status}`);
        const item = await response.json();
        for (const key of ["grd-cog", "qlk-cog"]) {
          const asset = item.assets[key];
          if (!asset) continue;
          const tiff = await fromUrl(
            asset.href,
            { allowFullFile: false },
            AbortSignal.timeout(30000),
          );
          try {
            const sizes = [];
            for (let i = 0; i < (await tiff.getImageCount()); i++) {
              const image = await tiff.getImage(i);
              sizes.push([image.getWidth(), image.getHeight()]);
            }
            const original = await tiff.getImage();
            result.assets[key] = {
              sizes,
              bands: original.getSamplesPerPixel(),
              bits: original.getBitsPerSample(),
              format: original.getSampleFormat(),
              gcps: (await original.getTiePoints()).length,
              keys: original.getGeoKeys(),
            };
          } finally {
            await tiff.close();
          }
        }
      } catch (error) {
        result.error = String(error);
      }
      results.push(result);
      if (results.length % 50 === 0) console.log(`Inspected ${results.length}/${features.length}`);
    }
  }),
);
const path = join(tmpdir(), "iceye-overview-audit.json");
await writeFile(path, JSON.stringify(results, null, 2));
const affected = results.filter(
  (r) => r.assets["grd-cog"] && !r.assets["grd-cog"].sizes.some(([w, h]) => Math.max(w, h) <= 2048),
);
console.log(
  JSON.stringify(
    {
      scenes: results.length,
      errors: results.filter((r) => r.error),
      affected: affected.length,
      smallestGrdSizes: [
        ...new Set(
          results.flatMap((r) =>
            r.assets["grd-cog"] ? [r.assets["grd-cog"].sizes.at(-1).join("x")] : [],
          ),
        ),
      ],
      noSmallQuicklook: results
        .filter((r) => !r.assets["qlk-cog"]?.sizes.some(([w, h]) => Math.max(w, h) <= 2048))
        .map((r) => r.id),
      path,
    },
    null,
    2,
  ),
);
