export type ExcalidrawScene = {
  type: "excalidraw";
  version: number;
  source: string;
  elements: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

export type SceneSummary = {
  name: string;
  size: number;
  modifiedAt: string;
  snapshotCount?: number;
  previewUrl?: string;
  previewModifiedAt?: string;
};

export type ExportResult = {
  format: "png" | "svg";
  mimeType: string;
  content: string;
};

declare global {
  interface Window {
    __EXCALIDRAW_EXPORT_RESULT__?: ExportResult;
    __EXCALIDRAW_EXPORT_ERROR__?: string;
  }
}
