import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const baseURL = process.env.GEOLIBRE_TEST_URL ?? "http://127.0.0.1:5180";
const itemUrl =
  process.env.ICEYE_TEST_ITEM_URL ??
  "https://iceye-open-data-catalog.s3.amazonaws.com/stac-items/2025/11/ICEYE_4EKGVZ_20251110T124428Z_7004635_X42_SLEDF.json";
const item = await (await fetch(itemUrl)).json();
const screenshotPath = join(tmpdir(), "geolibre-iceye-display.png");
const previewPath = join(tmpdir(), "geolibre-iceye-preview.png");
const browser = await chromium.launch({
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "geolibre.desktopSettings",
      JSON.stringify({ uiProfile: { onboarded: true }, language: "en" }),
    );
  });
  // Keep catalog traversal deterministic; imagery requests still use the real ICEYE files.
  await page.route("**/catalog.json", async (route) => {
    if (!route.request().url().includes("iceye-open-data-catalog")) return route.continue();
    await route.fulfill({
      json: {
        type: "Catalog",
        id: "iceye",
        title: "ICEYE",
        links: [{ rel: "item", href: itemUrl }],
      },
    });
  });
  await page.goto(baseURL);
  await page.locator(".maplibregl-canvas").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await page.getByRole("menuitem", { name: "Web Services", exact: true }).click();
  await page.getByRole("menuitem", { name: "ICEYE Open Data", exact: true }).click();
  await page.getByLabel("Limit search to the current map extent").uncheck();
  await page.getByRole("button", { name: "Search items", exact: true }).click();
  const guide = page
    .locator("details")
    .filter({ has: page.getByText("About ICEYE imaging modes", { exact: true }) });
  assert.equal(await guide.evaluate((element) => element.open), false);
  await guide.locator("summary").click();
  assert.match(await guide.innerText(), /Dwell Fine/);
  await page.screenshot({ path: join(tmpdir(), "geolibre-iceye-mode-guide.png") });
  await guide.locator("summary").click();
  await page
    .locator("select")
    .filter({ has: page.locator('option[value="qlk-cog"]') })
    .selectOption("qlk-cog");
  assert.equal(await page.getByRole("button", { name: "Preview", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Add overview", exact: true }).click();
  const previewName = `${item.id} — Quicklook COG (display overview)`;
  await page
    .locator('[data-testid="layer-row"]')
    .filter({ hasText: previewName })
    .waitFor({ timeout: 120000 });
  console.log(
    "Quicklook layer added through Add overview; mode guide works; Preview button absent",
  );
  await page.waitForTimeout(15000);
  await page.screenshot({ path: previewPath });
  // A visible quicklook underneath could mask a GRD rendering failure.
  await page
    .locator('[data-testid="layer-row"]')
    .filter({ hasText: previewName })
    .getByRole("button", { name: "Hide layer", exact: true })
    .click();
  await page
    .locator("select")
    .filter({ has: page.locator('option[value="grd-cog"]') })
    .selectOption("grd-cog");
  await page.getByRole("button", { name: "Add overview", exact: true }).click();
  const grdName = `${item.id} — GRD product (display overview)`;
  await page
    .locator('[data-testid="layer-row"]')
    .filter({ hasText: grdName })
    .waitFor({ timeout: 120000 });
  console.log("GRD overview layer added");
  await page.waitForTimeout(15000);
  await page.screenshot({ path: screenshotPath });
  assert.deepEqual(errors, []);
  console.log(`No uncaught app errors; screenshots: ${previewPath}, ${screenshotPath}`);
} catch (error) {
  for (const page of browser.contexts().flatMap((context) => context.pages())) {
    console.error((await page.locator("body").innerText()).slice(-5500));
    await page.screenshot({ path: screenshotPath });
  }
  throw error;
} finally {
  await browser.close();
}
