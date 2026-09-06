import assert from "node:assert/strict";
import test from "node:test";
import {
  overviewGcpArgs,
  selectGcpOverview,
} from "../apps/geolibre-desktop/src/lib/gcp-raster-overview";

test("Dwell Precise 40000px GRD uses its 2500px overview and downsamples to 2048", () => {
  assert.deepEqual(
    selectGcpOverview(
      [40000, 10000, 5000, 2500].map((size) => ({
        width: size,
        height: size,
        bytesPerPixel: 2,
      })),
    ),
    { index: 3, width: 2048, height: 2048 },
  );
});

test("prefer the largest embedded overview within the display size", () => {
  assert.deepEqual(
    selectGcpOverview(
      [4096, 2048, 1024, 512].map((size) => ({
        width: size,
        height: size,
        bytesPerPixel: 1,
      })),
    ),
    { index: 1, width: 2048, height: 2048 },
  );
});

test("wide Scan overview is accepted by byte size rather than rejecting its long side", () => {
  assert.deepEqual(
    selectGcpOverview([
      { width: 97638, height: 17508, bytesPerPixel: 2 },
      { width: 24410, height: 4377, bytesPerPixel: 2 },
      { width: 12205, height: 2189, bytesPerPixel: 2 },
      { width: 6103, height: 1095, bytesPerPixel: 2 },
    ]),
    { index: 3, width: 2048, height: 367 },
  );
});

test("fallback preserves aspect ratio and can reduce small files without embedded overviews", () => {
  assert.deepEqual(selectGcpOverview([{ width: 3000, height: 1500, bytesPerPixel: 2 }]), {
    index: 0,
    width: 2048,
    height: 1024,
  });
});

test("source memory guard accounts for all bands rather than resized output", () => {
  assert.throws(
    () => selectGcpOverview([{ width: 40000, height: 40000, bytesPerPixel: 2 }]),
    /memory budget/,
  );
  assert.throws(
    () => selectGcpOverview([{ width: 2500, height: 2500, bytesPerPixel: 8 }]),
    /memory budget/,
  );
  assert.throws(() => selectGcpOverview([]), /memory budget/);
  assert.throws(
    () => selectGcpOverview([{ width: NaN, height: 10, bytesPerPixel: 2 }]),
    /memory budget/,
  );
});

const points = [
  { i: 0, j: 0, x: -60, y: -71, z: 10 },
  { i: 4096, j: 0, x: -61, y: -71, z: 20 },
  { i: 0, j: 2048, x: -60, y: -72, z: 30 },
];

test("GCP overview scales image pixels independently without moving map coordinates", () => {
  assert.deepEqual(overviewGcpArgs(points, 4096, 2048, 1024, 1024), [
    "-gcp",
    "0",
    "0",
    "-60",
    "-71",
    "10",
    "-gcp",
    "1024",
    "0",
    "-61",
    "-71",
    "20",
    "-gcp",
    "0",
    "1024",
    "-60",
    "-72",
    "30",
  ]);
  assert.equal(points[1].i, 4096);
});

test("invalid GCPs and raster dimensions fail before GDAL is called", () => {
  assert.throws(() => overviewGcpArgs([], 100, 100, 50, 50), /control points/);
  assert.throws(
    () => overviewGcpArgs([...points, { ...points[0], x: NaN }], 100, 100, 50, 50),
    /control points/,
  );
  for (const invalid of [0, -1, NaN, Infinity, 0.5]) {
    assert.throws(() => overviewGcpArgs(points, invalid, 100, 50, 50), /dimensions/);
  }
});
