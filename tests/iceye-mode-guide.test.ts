import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { buildIceyeModeGuide, ICEYE_MODE_DOCUMENTATION } from "../packages/plugins/src/plugins/iceye-mode-guide";

test("ICEYE mode guide is collapsed, explains the mode families, and links to the source", () => {
  const previous = globalThis.document;
  globalThis.document = parseHTML("<html><body></body></html>").document;
  try {
    const guide = buildIceyeModeGuide();
    assert.equal(guide.tagName, "DETAILS");
    assert.equal(guide.hasAttribute("open"), false);
    assert.equal(guide.querySelector("summary")?.textContent, "About ICEYE imaging modes");
    assert.deepEqual([...guide.querySelectorAll("dt")].map((node) => node.textContent), [
      "Dwell", "Dwell Fine", "Dwell Precise", "Spot family", "Stripmap", "Scan / Scan Wide",
    ]);
    assert.match(guide.textContent ?? "", /not pixel spacing/);
    for (const description of guide.querySelectorAll("dd")) {
      assert.match(description.textContent ?? "", /Ground resolution:/);
    }
    assert.doesNotMatch(guide.textContent ?? "", /nominal/i);
    assert.match(guide.textContent ?? "", /display overview/);
    const link = guide.querySelector("a");
    assert.equal(link?.href, ICEYE_MODE_DOCUMENTATION);
    assert.equal(link?.rel, "noopener noreferrer");
  } finally {
    globalThis.document = previous;
  }
});
