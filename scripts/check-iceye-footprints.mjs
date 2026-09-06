import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

const url = "https://iceye-open-data-catalog.s3.amazonaws.com/stac-items/summary/footprint-summary-points.geojson";
const collection = await (await fetch(url)).json();
const footprint = collection.features[0];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
try {
  await page.addInitScript(() => localStorage.setItem("geolibre.desktopSettings", JSON.stringify({ uiProfile: { onboarded: true } })));
  // One real footprint keeps the click deterministic; item and acquisition-mode requests are live.
  await page.route(url, (route) => route.fulfill({ json: { type: "FeatureCollection", features: [footprint] } }));
  await page.goto("http://127.0.0.1:5180/");
  await page.locator(".maplibregl-canvas").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await page.getByRole("menuitem", { name: "Web Services", exact: true }).click();
  await page.getByRole("menuitem", { name: "ICEYE Open Data", exact: true }).click();
  await page.getByRole("treeitem", { name: "ICEYE Open SAR Data Collection", exact: false }).click();
  await expect(page.getByRole("treeitem", { name: "ICEYE Open SAR Data Collection", exact: false })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Limit search to the current map extent").uncheck();
  await page.getByRole("button", { name: "Search items", exact: true }).click();
  const asset = page.locator("select").filter({ has: page.locator('option[value="catalog-footprints"]') });
  await asset.selectOption("catalog-footprints");
  await asset.locator("..").getByRole("button", { name: "Add", exact: true }).click();
  const layer = page.locator('[data-testid="layer-row"]').filter({ hasText: "GeoJSON of scene footprints" });
  await layer.waitFor();
  await layer.getByRole("button", { name: "Zoom to layer", exact: true }).click();
  await page.waitForTimeout(2500);
  const canvas = page.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  assert.ok(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("treeitem", { name: "ICEYE SAR - dwell-fine", exact: false })).toHaveAttribute("aria-selected", "true", { timeout: 30000 });
  await expect(page.getByText(`Selected ${footprint.properties.id} (dwell-fine). Choose a product to load or download.`, { exact: true })).toBeVisible();
  await expect(layer).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), "geolibre-iceye-footprint-selection.png") });
  console.log("Footprint click loaded the linked scene, selected dwell-fine, and retained the full footprint layer.");
} catch (error) {
  console.error((await page.locator("body").innerText()).slice(0,1600));
  await page.screenshot({ path: join(tmpdir(), "geolibre-iceye-footprint-selection.png") });
  throw new Error(String(error).slice(0,1800));
} finally {
  await browser.close();
}
