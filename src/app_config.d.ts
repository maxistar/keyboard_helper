export type LayoutSource = true | string;
export type AppConfig = {
  defaultLayout?: string | null;
  layouts?: Record<string, LayoutSource> | null;
  [key: string]: unknown;
};
export type ParsedExternalLayout = { valid: true; definition: import("./layout_semantics.js").LayoutDefinition } | { valid: false; error: string };

export const BUILTIN_LAYOUT_FILES: Readonly<Record<string, string>>;
export function parseExternalLayout(raw: string): ParsedExternalLayout;
export function normalizeConfig(config: unknown, availableKeys?: Iterable<string>): AppConfig;
export function pickAvailableLayout(config: AppConfig | null | undefined, availableKeys: string[], fallback?: string | null): string | null;
