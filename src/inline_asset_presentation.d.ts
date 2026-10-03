export class InlineAssetPresentationOwner {
  resolve(key: string, definition: import("./layout_semantics.js").LayoutDefinition): Promise<{
    definition: import("./layout_semantics.js").LayoutDefinition;
    validation: { valid: true; error?: undefined } | { valid: false; error: string };
  }>;
  retain(keys: string[]): void;
  dispose(): void;
}
