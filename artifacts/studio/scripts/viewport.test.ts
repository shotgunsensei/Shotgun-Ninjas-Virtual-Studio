import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Studio retains a device-width viewport without limiting browser zoom", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const viewports = (html.match(/<meta\b[^>]*>/gi) ?? []).filter((meta) =>
    /\bname\s*=\s*["']viewport["']/i.test(meta),
  );
  assert.equal(viewports.length, 1);
  const content = viewports[0].match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
  assert.ok(content);
  const properties = Object.fromEntries(
    content
      .toLowerCase()
      .split(",")
      .map((item) => item.trim().split(/\s*=\s*/)),
  );
  assert.equal(properties.width, "device-width");
  assert.equal(Number(properties["initial-scale"]), 1);
  assert.equal(properties["maximum-scale"], undefined);
  assert.ok(!["no", "0"].includes(properties["user-scalable"]));
});
