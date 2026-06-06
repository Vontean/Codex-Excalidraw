import type { ExcalidrawScene } from "./types";

export const SCENE_SOURCE = "https://codex.local/excalidraw-codex";

export function createBlankScene(): ExcalidrawScene {
  return {
    type: "excalidraw",
    version: 2,
    source: SCENE_SOURCE,
    elements: [],
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: null,
      currentItemFontFamily: 1
    },
    files: {}
  };
}

export function toScene(
  elements: readonly unknown[],
  appState: Record<string, unknown> | undefined,
  files: Record<string, unknown> | undefined
): ExcalidrawScene {
  const cleanAppState = { ...(appState ?? {}) };
  delete cleanAppState.collaborators;

  return {
    type: "excalidraw",
    version: 2,
    source: SCENE_SOURCE,
    elements: [...elements],
    appState: cleanAppState,
    files: files ?? {}
  };
}

export function getSceneNameFromUrl(): string | null {
  const scene = new URLSearchParams(window.location.search).get("scene");
  return scene && scene.trim() ? scene.trim() : null;
}

export function downloadText(filename: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
