import assert from "node:assert/strict";
import test from "node:test";

import { redactDiagnostic } from "../../src/quality_diagnostics.js";

test("retained diagnostics omit private input, credentials, tokens, and config values", () => {
  const diagnostic = redactDiagnostic({
    stage: "asset-loading",
    typedText: "a private sentence",
    rawKeyLog: ["KeyA", "KeyB"],
    password: "hunter2",
    nested: { token: "abc.123", config: { defaultLayout: "private-board" } },
    error: "Bearer abc.def failed for C:\\Users\\maxim\\private\\layout.json",
  });
  const retained = JSON.stringify(diagnostic);
  for (const secret of ["private sentence", "KeyA", "hunter2", "abc.123", "private-board", "maxim"]) {
    assert.doesNotMatch(retained, new RegExp(secret.replace(".", "\\.")));
  }
  assert.match(retained, /asset-loading/);
  assert.match(retained, /REDACTED/);
});
