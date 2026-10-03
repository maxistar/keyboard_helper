export type BackgroundAnalytics = { handle(event: import("./input_events.js").NormalizedInputEvent): void; setSuspended(suspended: boolean): void; resetTransient(): void };
export function createBackgroundAnalytics(options: { settings?: unknown; context: () => { layout: string; language: string }; write: (record: unknown) => unknown }): BackgroundAnalytics;
