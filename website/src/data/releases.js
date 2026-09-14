export const releasesUrl = "https://github.com/maxistar/keyboard_helper/releases";

export const androidPreview = Object.freeze({
  published: true,
  version: "v0.6.4",
  releaseUrl: `${releasesUrl}/tag/v0.6.4`,
  capabilities: Object.freeze({
    adaptiveWorkspace: false,
  }),
});

export function getAndroidPreviewView(release = androidPreview) {
  const published = release.published === true && Boolean(release.releaseUrl);
  const adaptiveWorkspace = published && release.capabilities?.adaptiveWorkspace === true;

  return Object.freeze({
    published,
    version: published ? release.version : null,
    releaseUrl: published ? release.releaseUrl : releasesUrl,
    adaptiveWorkspace,
    status: published
      ? `Signed ${release.version} preview for API 31+ arm64 devices.`
      : "No verified Android preview is currently published.",
  });
}
