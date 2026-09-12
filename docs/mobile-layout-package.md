# Mobile layout packages

Android accepts either a standalone text-only Keyboard Helper JSON layout or one `.khlayout`
package. A package is a ZIP document with this shape:

```text
manifest.json
layout.json
assets/
  images/
    key.png
```

The root manifest is:

```json
{
  "format": "keyboard-helper-layout-package",
  "version": 1,
  "layout": "layout.json"
}
```

Image legends in `layout.json` use normalized package-relative paths such as
`assets/images/key.png` and retain a text legend or `alt` value for accessibility. Version 1 accepts
non-animated PNG, JPEG, and WebP files only. Remote URLs, data/file/content URLs, SVG, links,
absolute paths, backslashes, and `.` or `..` path segments are rejected.

## Limits

- selected archive: 2 MiB
- entries: 64
- expanded content: 8 MiB
- `manifest.json` and layout JSON: 512 KiB each
- each image: 1 MiB and at most 2048 × 2048 pixels
- normalized path depth: four segments
- compression ratio: 100:1

Every packaged file must be referenced: the package contains only its manifest, named layout, and
the images used by that layout. These rules make import atomic and prevent a package from becoming a
general file container.

## Build the Corney example

From `keyboard_helper/`, run:

```sh
npm run build:mobile-layout-package
```

This creates `dist/examples/corney-v1.khlayout` directly from `src/layout_corne.json` and its Linux,
Apple, and Android image legends. An optional first argument selects another output path:

```sh
node scripts/build-mobile-layout-package.mjs /tmp/corney.khlayout
```

Android copies an accepted package to application-private storage and does not retain its source URI.
Replacing a same-name custom layout requires confirmation; removing it removes all owned images.
Clearing application data or uninstalling removes every imported layout. Packages are not uploaded,
synchronized with desktop, or fetched from the network.

## Acceptance evidence

Verified on 2026-09-12:

- the complete 338-test JavaScript suite, two host-side Rust bridge-model tests, and 14 Android
  instrumentation tests pass, including archive-boundary, image-validation, atomic replacement,
  rollback, removal, corruption-isolation, and orphan-cleanup cases;
- lint, strict OpenSpec validation, website production build, Android debug build, and arm64
  signed-equivalent release build pass;
- preview staging accepts the locally signed release when supplied with its isolated test
  certificate fingerprint and emits the canonical APK plus SHA-256 checksum; the repository's
  production fingerprint remains unchanged;
- on a physical API 36 arm64 phone, the Corney package renders its image legends and accessible
  names correctly across Browse layers, rotation, and a cold relaunch;
- with enhanced firmware, the same package remains correct while Live follows authoritative layer,
  key, and combo telemetry, and layout operations do not change the BLE lifecycle.

Physical acceptance of repacked-duplicate handling, same-name replacement rollback, removal cleanup,
standalone JSON fallback, and bundled fallback is intentionally deferred to the future package-format
revision. Those paths retain automated coverage but are not claimed as physically verified here.
iOS package import and any format beyond `.khlayout` v1 also remain separate future work.
