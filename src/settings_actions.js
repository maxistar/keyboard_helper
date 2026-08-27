import { parseExternalLayout } from "./app_config.js";

export async function chooseExternalLayout({ openFile, readFile, state }) {
  const path = await openFile();
  if (!path) return { status: "cancelled" };
  const raw = await readFile(path);
  const parsed = parseExternalLayout(raw);
  if (!parsed.valid) return { status: "invalid", error: parsed.error };
  const result = state.addExternal(path, parsed.definition);
  if (result.duplicateKey) return { status: "duplicate", key: result.duplicateKey };
  return { status: "added", key: result.addedKey, path };
}

export async function confirmSettingsClose(dirty, confirmDiscard) {
  if (!dirty) return true;
  return Boolean(await confirmDiscard());
}

export async function persistSettingsDraft({ invoke, state }) {
  const snapshot = state.snapshot();
  if (!snapshot.canSave) throw new Error("Settings are not ready to save.");
  return invoke("save_config", {
    request: {
      config: state.serializedConfig(),
      sourcePath: snapshot.sourcePath,
      revision: snapshot.revision,
      replaceInvalid: snapshot.replaceInvalid,
    },
  });
}
