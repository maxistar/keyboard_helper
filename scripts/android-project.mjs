import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { syncAndroidLauncherIcons } from "./android-launcher-icons.mjs";
import { syncAndroidRuntime } from "./android-runtime.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function syncAndroidProject({ androidRoot, iconSourcePath, runtimeSourcePath } = {}) {
  const launcher = await syncAndroidLauncherIcons({ androidRoot, sourcePath: iconSourcePath });
  const runtime = await syncAndroidRuntime({ androidRoot, sourcePath: runtimeSourcePath });
  return { launcher, runtime };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await syncAndroidProject();
  console.log(
    `Synchronized Android launcher and runtime from ${path.relative(projectRoot, result.launcher.sourcePath)} and ${path.relative(projectRoot, result.runtime.sourcePath)}.`,
  );
}
