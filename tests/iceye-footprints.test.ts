import assert from "node:assert/strict";
import test from "node:test";
import { iceyeFootprintReference, iceyeItemMode, isIceyeFootprintSource, loadIceyeFootprintItem } from "../packages/plugins/src/plugins/iceye-footprints";
import { loadStacItem, type StacItem } from "../packages/plugins/src/plugins/stac-api";

const id = "ICEYE_D59J8T_20231225T040435Z_3175275_X31_SLEDF";
const href = `https://iceye-open-data-catalog.s3.amazonaws.com/stac-items/2023/12/${id}.json`;

test("collection footprints link directly to a validated ICEYE scene", () => {
  assert.deepEqual(iceyeFootprintReference({ id, href }), { id, href });
  for (const properties of [null, {}, { id, href: "javascript:alert(1)" },
    { id, href: href.replace(".s3.amazonaws.com", ".example.org") }, { id: "different", href }]) {
    assert.equal(iceyeFootprintReference(properties), null);
  }
  assert.equal(isIceyeFootprintSource("https://iceye-open-data-catalog.s3.amazonaws.com/stac-items/summary/footprint-summary-points.geojson"), true);
  assert.equal(isIceyeFootprintSource("https://other.test/footprint-summary-points.geojson"), false);
});

test("loading a footprint uses one item request and resolves relative assets", async () => {
  const calls: string[] = [];
  const item = await loadStacItem(href, (async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ type: "Feature", id, geometry: null, properties: {},
      assets: { grd: { href: `../../../data/dwell-fine/${id}/GRD.tif` } } }));
  }) as typeof fetch);
  assert.deepEqual(calls, [href]);
  assert.equal(iceyeItemMode(item), "dwell-fine");
  assert.equal(iceyeItemMode({ ...item, assets: {} } as StacItem), null);
});

test("non-item documents are rejected instead of becoming broken result cards", async () => {
  await assert.rejects(loadStacItem(href, (async () => new Response(JSON.stringify({
    type: "Collection", id, assets: {}, properties: {},
  }))) as typeof fetch), /not a STAC item/);
});

test("a linked scene must match the clicked footprint's ID", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    type: "Feature", id: "different-scene", properties: {}, geometry: null, assets: {},
  })));
  await assert.rejects(loadIceyeFootprintItem({ id, href }), /does not match/);
});
