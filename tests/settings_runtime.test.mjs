import assert from "node:assert/strict";
import test from "node:test";

import { reloadOverlayAfterSettingsSave } from "../src/settings_runtime.js";

test("saved settings reload only the supplied overlay location", () => {
  let reloads = 0;
  reloadOverlayAfterSettingsSave({ reload: () => { reloads += 1; } });
  assert.equal(reloads, 1);
  assert.throws(() => reloadOverlayAfterSettingsSave(null), /cannot reload/);
});
