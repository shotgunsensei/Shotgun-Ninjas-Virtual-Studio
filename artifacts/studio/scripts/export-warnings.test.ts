import assert from "node:assert/strict";
import test from "node:test";
import { formatExportWarnings } from "../src/lib/export/warnings";

test("export status preserves every warning including material omissions", () => {
  const message = formatExportWarnings([
    "Native effects were approximated.",
    "Timeline audio could not be decoded: vocal-take.wav.",
  ]);
  assert.equal(
    message,
    "Native effects were approximated. • Timeline audio could not be decoded: vocal-take.wav.",
  );
});

test("export status ignores empty warnings", () => {
  assert.equal(formatExportWarnings(undefined), null);
  assert.equal(formatExportWarnings(["", "  "]), null);
});
