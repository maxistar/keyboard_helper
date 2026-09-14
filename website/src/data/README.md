# Website release metadata

`releases.js` is the source of truth for public Android release claims. Repository HEAD, package versions, commit dates, and the Android minimum SDK do not prove that a feature is present in the linked APK.

For an Android preview release:

1. Publish and verify the signed arm64 APK and its SHA-256 sidecar.
2. Set `published`, `version`, and `releaseUrl` to the accepted artifact.
3. Enable `capabilities.adaptiveWorkspace` only when that exact APK contains the viewport-first Browse/Live workspace and adaptive Settings navigation.
4. Run `npm test`, `npm run check:js`, and `npm run build` before publishing the website.

Keeping the capability flag off is intentional for `v0.6.4`: later workspace code in the repository must not be described as current-release behavior.
