import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, profilesCsv } from "../lib/csv-export.mjs";

test("stakeholder CSV escapes commas, quotes, line breaks, and formulas", () => {
  assert.equal(csvCell('A, "Company"'), '"A, ""Company"""');
  assert.equal(csvCell("=HYPERLINK(\"bad\")"), '"\'=HYPERLINK(""bad"")"');
  assert.equal(csvCell("\n+SUM(1,2)"), '"\'\n+SUM(1,2)"');
  const csv = profilesCsv([{ wallet: "0x123", full_name: "Ada", email: "ada@example.com", marketing_opt_in: false }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"Ada","ada@example.com"'));
  assert.ok(csv.includes('"No"'));
});
