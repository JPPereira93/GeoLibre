import { fromUrl, writeArrayBuffer } from "geotiff";
import { loadGdal } from "./gdal-loader";

export const GCP_OVERVIEW_SIZE = 2048;
const MAX_DECODED_OVERVIEW_BYTES = 32 * 1024 * 1024;
let conversionQueue: Promise<unknown> = Promise.resolve();

type OverviewDimensions = { width: number; height: number; bytesPerPixel: number };

/** Prefer a display-sized IFD; otherwise downsample the smallest safely decodable IFD. */
export function selectGcpOverview(images: OverviewDimensions[]) {
  const safe = images
    .map((image, index) => ({ ...image, index }))
    .filter(
      ({ width, height, bytesPerPixel }) =>
        [width, height, bytesPerPixel].every((n) => Number.isSafeInteger(n) && n > 0) &&
        width * height * bytesPerPixel <= MAX_DECODED_OVERVIEW_BYTES,
    );
  const withinSize = safe.filter(
    (image) => Math.max(image.width, image.height) <= GCP_OVERVIEW_SIZE,
  );
  const selected =
    withinSize.sort((a, b) => b.width * b.height - a.width * a.height)[0] ??
    safe.sort((a, b) => a.width * a.height - b.width * b.height)[0];
  if (!selected) {
    throw new Error(
      "This product exceeds the browser overview memory budget. Select Quicklook COG for this scene.",
    );
  }
  const scale = Math.min(1, GCP_OVERVIEW_SIZE / Math.max(selected.width, selected.height));
  return {
    index: selected.index,
    width: Math.max(1, Math.round(selected.width * scale)),
    height: Math.max(1, Math.round(selected.height * scale)),
  };
}

/** Scale source-image GCP pixels to a reduced image without changing their map coordinates. */
export function overviewGcpArgs(
  points: Array<{ i: number; j: number; x: number; y: number; z: number }>,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): string[] {
  if (
    ![sourceWidth, sourceHeight, width, height].every(
      (value) => Number.isInteger(value) && value > 0,
    )
  ) {
    throw new Error("Invalid raster dimensions.");
  }
  if (points.length < 3 || points.some((p) => ![p.i, p.j, p.x, p.y, p.z].every(Number.isFinite))) {
    throw new Error("The raster does not contain valid ground control points.");
  }
  return points.flatMap((p) => [
    "-gcp",
    String((p.i * width) / sourceWidth),
    String((p.j * height) / sourceHeight),
    String(p.x),
    String(p.y),
    String(p.z),
  ]);
}

/** Decode only a bounded overview, then let GDAL warp its GCPs to a regular map grid. */
export async function prepareGcpRasterOverview(url: string, signal?: AbortSignal): Promise<File> {
  // GDAL retains virtual files after closing datasets. Serialize and reuse names so repeated
  // previews overwrite bounded scratch files instead of accumulating them in WASM memory.
  const result = conversionQueue.then(() => convertOverview(url, signal));
  conversionQueue = result.catch(() => undefined);
  return result;
}

async function convertOverview(url: string, signal?: AbortSignal): Promise<File> {
  signal?.throwIfAborted();
  const tiff = await fromUrl(url, { allowFullFile: false }, signal);
  try {
    const original = await tiff.getImage();
    const keys = original.getGeoKeys();
    if (keys?.GeographicTypeGeoKey !== 4326 || keys.ProjectedCSTypeGeoKey) {
      throw new Error(
        "This display conversion currently supports WGS84 ground control points only.",
      );
    }
    const points = await original.getTiePoints();
    const count = await tiff.getImageCount();
    const images = [];
    for (let i = 0; i < count; i++) {
      const candidate = await tiff.getImage(i);
      const bands = candidate.getSamplesPerPixel();
      if (
        bands > 4 ||
        Array.from({ length: bands }, (_, band) => candidate.getSampleFormat(band)).some(
          (format) => ![1, 2, 3].includes(format),
        )
      ) {
        throw new Error(
          "Complex SAR products require dedicated processing. Use Quicklook COG to preview this scene.",
        );
      }
      // Interleaved reads promote every band to the widest sample type.
      const sampleBytes = Math.max(
        ...Array.from({ length: bands }, (_, band) =>
          Math.ceil(candidate.getBitsPerSample(band) / 8),
        ),
      );
      images.push({
        width: candidate.getWidth(),
        height: candidate.getHeight(),
        bytesPerPixel: sampleBytes * bands,
      });
    }
    const { index, width, height } = selectGcpOverview(images);
    const overview = await tiff.getImage(index);
    const bands = overview.getSamplesPerPixel();
    const gcps = overviewGcpArgs(points, original.getWidth(), original.getHeight(), width, height);
    signal?.throwIfAborted();
    // readRasters decodes before resizing, so selection caps the source allocation, not just output.
    // Nearest sampling preserves nodata instead of blending it into valid SAR values.
    const pixels = await overview.readRasters({
      interleave: true,
      width,
      height,
      resampleMethod: "nearest",
      signal,
    });
    // GDAL's browser build lacks JPEG decoding; geotiff.js decodes ICEYE's JPEG tiles first.
    const bytes = writeArrayBuffer(pixels, {
      width,
      height,
      SamplesPerPixel: bands,
      PhotometricInterpretation: bands >= 3 ? 2 : 1,
      ...(overview.getGDALNoData() !== null
        ? { GDAL_NODATA: String(overview.getGDALNoData()) }
        : {}),
    });
    signal?.throwIfAborted();
    const gdal = await loadGdal();
    const id = "geolibre-gcp-overview";
    const datasets: Awaited<ReturnType<typeof gdal.open>>["datasets"] = [];
    const open = async (file: File) => {
      const result = await gdal.open(file);
      datasets.push(...result.datasets);
      if (!result.datasets[0]) throw new Error("Could not open the display overview.");
      return result.datasets[0];
    };
    try {
      const source = await open(new File([bytes], `${id}.tif`));
      const referenced = await gdal.gdal_translate(
        source,
        ["-of", "GTiff", "-a_srs", "EPSG:4326", ...gcps],
        `${id}-gcps.tif`,
      );
      const referencedBytes = await gdal.getFileBytes(referenced);
      const withGcps = await open(new File([referencedBytes as BlobPart], `${id}-referenced.tif`));
      signal?.throwIfAborted();
      const warped = await gdal.gdalwarp(
        withGcps,
        [
          "-overwrite",
          "-tps",
          "-t_srs",
          "EPSG:3857",
          "-of",
          "COG",
          "-co",
          "COMPRESS=DEFLATE",
          "-ts",
          String(GCP_OVERVIEW_SIZE),
          String(GCP_OVERVIEW_SIZE),
          "-ot",
          "Float32",
          "-dstnodata",
          "-9999",
          "-r",
          "bilinear",
        ],
        `${id}-display.tif`,
      );
      const output = await gdal.getFileBytes(warped);
      signal?.throwIfAborted();
      return new File([output as BlobPart], "display-overview.tif", { type: "image/tiff" });
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error(`Could not georeference the display overview: ${JSON.stringify(error)}`);
    } finally {
      for (const dataset of datasets) await gdal.close(dataset).catch(() => undefined);
    }
  } finally {
    await tiff.close();
  }
}
