import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createEmptyProject,
  parseProject,
  serializeProject,
  type GeoLibreLayer,
} from "@geolibre/core";
import {
  parseXyzTileJson,
  resolveProjectXyzLayers,
  resolveXyzTileUrlTemplate,
} from "../apps/geolibre-desktop/src/lib/xyz-url";
import {
  buildXyzLayer,
  applyServiceEntry,
} from "../apps/geolibre-desktop/src/components/layout/add-data/apply-service";
import { MapController } from "../packages/map/src/map-controller";

const bounds = [16.1308, 48.7926, 16.1349, 48.7945];
let baseUrl: string;
let requests = 0;
const manifest = () => ({
  tilejson: "3.0.0",
  name: "Vrbovecky Rybnik test fixture",
  scheme: "xyz",
  bounds,
  minzoom: 12,
  maxzoom: 20,
  tiles: [`${baseUrl}/{z}/{x}/{y}.png`, `${baseUrl}/replica/{z}/{x}/{y}.png`],
  attribution: "Test imagery",
});
const server = createServer((request, response) => {
  requests++;
  if (request.url === "/missing.json") {
    response.writeHead(404).end("Missing");
  } else if (request.url === "/legacy") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ url: `${baseUrl}/{z}/{x}/{y}.png` }));
  } else if (request.url === "/short") {
    response.writeHead(302, { Location: `${baseUrl}/tilejson.json` }).end();
  } else if (request.url === "/invalid.json") {
    response.writeHead(200, { "Content-Type": "application/json" }).end("{invalid");
  } else {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(manifest()));
  }
});
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
afterEach(() => mock.restoreAll());

describe("raster TileJSON import", () => {
  it("preserves metadata and all tile endpoints without enabling Short URL", async () => {
    const tileUrl = await resolveXyzTileUrlTemplate(`${baseUrl}/tilejson.json`);
    const layer = buildXyzLayer({ name: "Imagery", tileUrl, tileSize: "256", shortUrl: false });
    assert.deepEqual(layer.source.tiles, manifest().tiles);
    assert.deepEqual(layer.source.bounds, bounds);
    assert.equal(layer.source.minzoom, 12);
    assert.equal(layer.source.maxzoom, 20);
    assert.equal(layer.source.scheme, "xyz");
    assert.equal(layer.source.attribution, "Test imagery");
    assert.equal(layer.metadata.tilejsonUrl, `${baseUrl}/tilejson.json`);
    assert.equal(layer.source.url, `${baseUrl}/tilejson.json`);
  });

  it("uses imported bounds for zoom-to-layer", async () => {
    const tileUrl = await resolveXyzTileUrlTemplate(`${baseUrl}/tilejson.json`);
    const layer = buildXyzLayer({ name: "Imagery", tileUrl, tileSize: "256", shortUrl: false });
    const fits: unknown[] = [];
    const controller = new MapController();
    Object.assign(controller, {
      map: {
        getCanvas: () => ({ clientWidth: 1024, clientHeight: 768 }),
        getSource: () => undefined,
        cameraForBounds: () => ({ center: [16.13285, 48.79355], zoom: 17 }),
        fitBounds: (box: unknown) => fits.push(box),
      },
    });
    controller.fitLayer(layer);
    assert.deepEqual(fits, [
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
    ]);
  });

  it("keeps bounds and zoom limits through project save, parse, and reopen", async () => {
    const tileUrl = await resolveXyzTileUrlTemplate(`${baseUrl}/tilejson.json`);
    const layer = buildXyzLayer({ name: "Imagery", tileUrl, tileSize: "256", shortUrl: false });
    const project = createEmptyProject();
    project.layers = [layer];
    const saved = parseProject(serializeProject(project));
    assert.deepEqual(saved.layers[0].source.bounds, bounds);
    const reopened = await resolveProjectXyzLayers(saved);
    assert.deepEqual(reopened.layers[0].source.bounds, bounds);
    assert.deepEqual(reopened.layers[0].source.tiles, manifest().tiles);
    assert.equal(reopened.layers[0].source.minzoom, 12);
    assert.equal(reopened.layers[0].source.maxzoom, 20);
  });

  it("imports a saved XYZ service with TileJSON metadata", async () => {
    const added: GeoLibreLayer[] = [];
    await applyServiceEntry(
      {
        id: "xyz",
        name: "Imagery",
        category: "",
        kind: "xyz",
        fields: { url: `${baseUrl}/tilejson.json`, shortUrl: false },
      },
      {
        addLayer: (layer) => added.push(layer),
        mapControllerRef: { current: null },
      },
    );
    assert.deepEqual(added[0].source.bounds, bounds);
    assert.equal(added[0].source.maxzoom, 20);
  });

  it("handles a redirect to TileJSON without losing metadata", async () => {
    const tileUrl = await resolveXyzTileUrlTemplate(`${baseUrl}/short`);
    assert.equal(tileUrl.originalUrl, `${baseUrl}/short`);
    assert.equal(tileUrl.url, `${baseUrl}/tilejson.json`);
    assert.equal(tileUrl.redirected, true);
    assert.deepEqual(tileUrl.tilejson?.bounds, bounds);
  });

  it("keeps existing templates fast and accepts legacy JSON short URLs", async () => {
    const previousRequests = requests;
    const direct = await resolveXyzTileUrlTemplate(`${baseUrl}/%7Bz%7D/{X}/{y}.png`);
    assert.equal(direct.renderUrl, `${baseUrl}/{z}/{x}/{y}.png`);
    assert.equal(requests, previousRequests);
    assert.equal(direct.tilejson, undefined);
    const legacy = await resolveXyzTileUrlTemplate(`${baseUrl}/legacy`);
    assert.equal(legacy.renderUrl, `${baseUrl}/{z}/{x}/{y}.png`);
  });

  it("reports HTTP and malformed-document errors", async () => {
    await assert.rejects(resolveXyzTileUrlTemplate(`${baseUrl}/missing.json`), /HTTP 404/);
    await assert.rejects(
      resolveXyzTileUrlTemplate(`${baseUrl}/invalid.json`),
      /raster TileJSON URL/,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(resolveXyzTileUrlTemplate(`${baseUrl}/tilejson.json`, controller.signal), {
      name: "AbortError",
    });
  });

  it("retains TileJSON metadata through the desktop CORS fallback", async () => {
    const globals = globalThis as typeof globalThis & { window?: unknown };
    const previousWindow = globals.window;
    const nativeCalls: string[] = [];
    globals.window = {
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          nativeCalls.push(command);
          return command === "resolve_url_redirect"
            ? `${baseUrl}/{z}/{x}/{y}.png`
            : Array.from(new TextEncoder().encode(JSON.stringify(manifest())));
        },
      },
    };
    mock.method(globalThis, "fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    try {
      const tileUrl = await resolveXyzTileUrlTemplate(`${baseUrl}/tilejson.json`);
      assert.deepEqual(tileUrl.tilejson?.bounds, bounds);
      assert.equal(tileUrl.tilejson?.maxzoom, 20);
      assert.deepEqual(nativeCalls, ["fetch_url_bytes"]);
    } finally {
      if (previousWindow === undefined) delete globals.window;
      else globals.window = previousWindow;
    }
  });

  it("still resolves desktop short URLs that redirect to an image template", async () => {
    const globals = globalThis as typeof globalThis & { window?: unknown };
    const previousWindow = globals.window;
    const nativeCalls: string[] = [];
    globals.window = {
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          nativeCalls.push(command);
          return command === "fetch_url_bytes" ? [137, 80, 78, 71] : `${baseUrl}/{z}/{x}/{y}.png`;
        },
      },
    };
    mock.method(globalThis, "fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    try {
      const tileUrl = await resolveXyzTileUrlTemplate(`${baseUrl}/short-image`);
      assert.equal(tileUrl.renderUrl, `${baseUrl}/{z}/{x}/{y}.png`);
      assert.equal(tileUrl.originalUrl, `${baseUrl}/short-image`);
      assert.equal(tileUrl.redirected, true);
      assert.deepEqual(nativeCalls, ["fetch_url_bytes", "resolve_url_redirect"]);
    } finally {
      if (previousWindow === undefined) delete globals.window;
      else globals.window = previousWindow;
    }
  });
});

describe("TileJSON validation", () => {
  it("supports TMS and normalizes encoded template placeholders", () => {
    const parsed = parseXyzTileJson({
      ...manifest(),
      scheme: "tms",
      tiles: ["https://tiles.example/%7Bz%7D/{X}/{y}.png"],
    });
    assert.equal(parsed.scheme, "tms");
    assert.deepEqual(parsed.tiles, ["https://tiles.example/{z}/{x}/{y}.png"]);
  });

  it("rejects missing endpoints, invalid URLs, and vector TileJSON", () => {
    assert.throws(() => parseXyzTileJson({ ...manifest(), tiles: [] }), /at least one/);
    assert.throws(
      () => parseXyzTileJson({ ...manifest(), tiles: ["file:///{z}/{x}/{y}"] }),
      /HTTP/,
    );
    assert.throws(
      () => parseXyzTileJson({ ...manifest(), tiles: ["https://tiles.example/tile.png"] }),
      /contain/,
    );
    assert.throws(
      () => parseXyzTileJson({ ...manifest(), vector_layers: [{ id: "roads" }] }),
      /vector tiles/,
    );
    assert.throws(() => parseXyzTileJson({ ...manifest(), tilejson: 3 }), /version/);
  });

  it("ignores invalid optional bounds and zoom limits", () => {
    const parsed = parseXyzTileJson({
      ...manifest(),
      bounds: [16, 49, 17, 48],
      minzoom: 25,
      maxzoom: 12,
    });
    assert.equal(parsed.bounds, undefined);
    assert.equal(parsed.minzoom, undefined);
    assert.equal(parsed.maxzoom, undefined);
    assert.equal(parseXyzTileJson({ ...manifest(), bounds: [NaN, 48, 17, 49] }).bounds, undefined);
  });
});
