import {
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawScene, ExportResult } from "./types";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function normalizeElements(scene: ExcalidrawScene) {
  const activeElements = scene.elements.filter((element) => {
    return typeof element === "object" && element !== null && !(element as { isDeleted?: boolean }).isDeleted;
  });
  const codex = scene.appState?.codex as { elementsKind?: string } | undefined;
  if (codex?.elementsKind === "skeleton") {
    return convertToExcalidrawElements(activeElements as Parameters<typeof convertToExcalidrawElements>[0]);
  }
  return activeElements as Parameters<typeof exportToBlob>[0]["elements"];
}

async function runExport() {
  const params = new URLSearchParams(window.location.search);
  const sceneName = params.get("scene");
  const format = params.get("format") === "svg" ? "svg" : "png";
  const status = document.getElementById("export-root");

  if (!sceneName) {
    throw new Error("Missing scene query parameter.");
  }

  status!.textContent = `Exporting ${sceneName} as ${format}...`;
  const response = await fetch(`/api/scenes/${encodeURIComponent(sceneName)}`);
  if (!response.ok) {
    throw new Error(`Unable to load scene: ${response.status}`);
  }

  const scene = (await response.json()) as ExcalidrawScene;
  const elements = normalizeElements(scene);
  const appState = {
    ...(scene.appState ?? {}),
    exportBackground: true,
    viewBackgroundColor: scene.appState?.viewBackgroundColor ?? "#ffffff"
  };
  delete (appState as Record<string, unknown>).collaborators;

  let result: ExportResult;
  if (format === "svg") {
    const svg = await exportToSvg({
      elements,
      appState,
      files: scene.files ?? {}
    });
    result = {
      format,
      mimeType: "image/svg+xml",
      content: new XMLSerializer().serializeToString(svg)
    };
  } else {
    const blob = await exportToBlob({
      elements,
      appState,
      files: scene.files ?? {},
      mimeType: "image/png"
    });
    result = {
      format,
      mimeType: "image/png",
      content: await blobToDataUrl(blob)
    };
  }

  window.__EXCALIDRAW_EXPORT_RESULT__ = result;
  status!.textContent = "Export complete.";
}

runExport().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  window.__EXCALIDRAW_EXPORT_ERROR__ = message;
  const status = document.getElementById("export-root");
  if (status) {
    status.textContent = message;
  }
});
