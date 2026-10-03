export type SelfTestOverlayPresentation = { update(payload: unknown): void; refresh(): void };
export function createSelfTestOverlayPresentation(options: { root: HTMLElement }): SelfTestOverlayPresentation;
