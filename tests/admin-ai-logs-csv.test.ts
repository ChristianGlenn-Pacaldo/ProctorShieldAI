import assert from "node:assert/strict";
import test from "node:test";
import { createAiLogsCsv, encodeCsvCell } from "../src/app/dashboard/admin/logs/csv.ts";

test("CSV cells double embedded quotes and retain commas, line breaks, Unicode, and normal text", () => {
  assert.equal(encodeCsvCell('Said "hello"'), '"Said ""hello"""');
  assert.equal(encodeCsvCell("first,second"), '"first,second"');
  assert.equal(encodeCsvCell("first\nsecond"), '"first\nsecond"');
  assert.equal(encodeCsvCell("José 😀"), '"José 😀"');
  assert.equal(encodeCsvCell("Ordinary value"), '"Ordinary value"');
});

test("CSV cells neutralize all spreadsheet formula prefixes", () => {
  for (const value of ["=1+2", "+1+2", "-1+2", "@SUM(A1:A2)"]) {
    assert.equal(encodeCsvCell(value), `"\t${value}"`);
  }
});

test("AI Logs export encodes every column in the existing order and includes a UTF-8 BOM", () => {
  const csv = createAiLogsCsv([{
    timestamp: "=1+2",
    event: "+event",
    severity: "-severity",
    confidence: "@confidence",
    student: 'Student "A", José',
    quiz: "Line one\nLine two",
  }]);

  assert.equal(csv, [
    '\uFEFF"Timestamp","Event Type","Severity","Confidence","Student","Quiz"',
    '"\t=1+2","\t+event","\t-severity","\t@confidence","Student ""A"", José","Line one\nLine two"',
  ].join("\r\n"));
});
