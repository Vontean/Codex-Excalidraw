import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  convertToExcalidrawElements
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import {
  FolderOpen,
  RefreshCw,
  Save
} from "lucide-react";
import {
  createBlankScene,
  getSceneNameFromUrl,
  toScene
} from "./scene";
import type { ExcalidrawScene, SceneSummary } from "./types";

type ExcalidrawApi = {
  updateScene: (scene: {
    elements?: readonly unknown[];
    appState?: Record<string, unknown>;
    files?: Record<string, unknown>;
  }) => void;
  resetScene: () => void;
};

type InitialSceneData = ExcalidrawScene & {
  scrollToContent?: boolean;
};

const FALLBACK_SCENE_NAME = "untitled.excalidraw";

function normalizeFileName(value: string) {
  const trimmed = value.trim() || FALLBACK_SCENE_NAME;
  return trimmed.endsWith(".excalidraw") ? trimmed : `${trimmed}.excalidraw`;
}

function normalizeLoadedScene(scene: ExcalidrawScene): ExcalidrawScene {
  const codex = scene.appState?.codex as { elementsKind?: string } | undefined;
  if (codex?.elementsKind === "skeleton") {
    return {
      ...scene,
      elements: convertToExcalidrawElements(
        scene.elements as Parameters<typeof convertToExcalidrawElements>[0]
      ) as unknown[],
      appState: {
        ...(scene.appState ?? {}),
        codex: {
          ...codex,
          elementsKind: "excalidraw"
        }
      }
    };
  }
  return scene;
}

function toInitialData(scene: ExcalidrawScene, scrollToContent = false): InitialSceneData {
  return {
    ...scene,
    scrollToContent
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

async function refreshPreview(sceneName: string) {
  const response = await fetch(`/api/scenes/${encodeURIComponent(sceneName)}/export`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ format: "png" })
  });
  if (!response.ok) {
    throw new Error(`Unable to refresh preview for ${sceneName}`);
  }
}

export default function App() {
  const apiRef = useRef<ExcalidrawApi | null>(null);
  const latestSceneRef = useRef<ExcalidrawScene>(createBlankScene());
  const [sceneName, setSceneName] = useState(FALLBACK_SCENE_NAME);
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [initialData, setInitialData] = useState<InitialSceneData>(createBlankScene());
  const [canvasKey, setCanvasKey] = useState(0);
  const [status, setStatus] = useState("Ready");
  const [isBusy, setIsBusy] = useState(false);

  const activeSceneLabel = useMemo(() => normalizeFileName(sceneName), [sceneName]);

  const refreshScenes = useCallback(async () => {
    const response = await fetch("/api/scenes");
    if (!response.ok) {
      throw new Error(`Unable to list scenes: ${response.status}`);
    }
    const data = (await response.json()) as SceneSummary[];
    setScenes(data);
  }, []);

  const loadScene = useCallback(
    async (name: string) => {
      setIsBusy(true);
      try {
        const response = await fetch(`/api/scenes/${encodeURIComponent(name)}`);
        if (!response.ok) {
          throw new Error(`Unable to load ${name}`);
        }
        const scene = normalizeLoadedScene((await response.json()) as ExcalidrawScene);
        latestSceneRef.current = scene;
        setSceneName(name);
        setInitialData(toInitialData(scene, scene.elements.length > 0));
        setCanvasKey((value) => value + 1);
        setStatus(`Loaded ${name}`);
        window.history.replaceState(null, "", `/?scene=${encodeURIComponent(name)}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setIsBusy(false);
      }
    },
    []
  );

  useEffect(() => {
    refreshScenes()
      .then(() => {
        const urlScene = getSceneNameFromUrl();
        if (urlScene) {
          void loadScene(urlScene);
        }
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : String(error));
      });
  }, [loadScene, refreshScenes]);

  const saveScene = useCallback(async () => {
    const targetName = normalizeFileName(sceneName);
    setIsBusy(true);
    try {
      const response = await fetch(`/api/scenes/${encodeURIComponent(targetName)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(latestSceneRef.current)
      });
      if (!response.ok) {
        throw new Error(`Unable to save ${targetName}`);
      }
      setSceneName(targetName);
      window.history.replaceState(null, "", `/?scene=${encodeURIComponent(targetName)}`);
      setStatus(`Saved ${targetName}; refreshing preview`);
      try {
        await refreshPreview(targetName);
        setStatus(`Saved ${targetName}`);
      } catch (previewError) {
        setStatus(
          previewError instanceof Error
            ? `Saved ${targetName}; preview refresh failed: ${previewError.message}`
            : `Saved ${targetName}; preview refresh failed`
        );
      }
      await refreshScenes();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }, [refreshScenes, sceneName]);

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-white text-ink">
      <section className="min-w-0 flex-1 bg-white">
        <Excalidraw
          key={canvasKey}
          initialData={initialData as Parameters<typeof Excalidraw>[0]["initialData"]}
          excalidrawAPI={(api) => {
            apiRef.current = api as unknown as ExcalidrawApi;
          }}
          onChange={(elements, appState, files) => {
            latestSceneRef.current = toScene(
              elements as unknown[],
              appState as unknown as Record<string, unknown>,
              files as unknown as Record<string, unknown>
            );
          }}
        />
      </section>

      <footer className="codex-gallery-strip">
        <div className="codex-gallery-meta">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="truncate text-[13px] font-semibold leading-4 text-neutral-900">Codex Gallery</h1>
            </div>
            <button
              className="ghost-icon-button"
              type="button"
              title="Refresh scenes"
              onClick={() => void refreshScenes()}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <input
            id="scene-name"
            value={sceneName}
            onChange={(event) => setSceneName(event.target.value)}
            className="codex-gallery-input"
            aria-label="Scene file"
          />
          <button className="codex-save-button" type="button" onClick={() => void saveScene()} disabled={isBusy}>
            <Save size={14} />
            Save
          </button>
        </div>

        <section className="codex-gallery-scroll" aria-label="Generated scenes">
          <div className="flex h-full gap-3">
            {scenes.map((scene) => (
              <button
                key={scene.name}
                type="button"
                className={`gallery-card ${scene.name === activeSceneLabel ? "active" : ""}`}
                onClick={() => void loadScene(scene.name)}
                title={`${scene.name} · ${formatDate(scene.modifiedAt)}`}
              >
                <span className="gallery-preview">
                  {scene.previewUrl ? (
                    <img
                      src={`${scene.previewUrl}?v=${encodeURIComponent(scene.previewModifiedAt ?? scene.modifiedAt)}`}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                  ) : (
                    <FolderOpen size={20} />
                  )}
                </span>
                <span className="mt-1 block truncate text-xs font-medium">{scene.name}</span>
              </button>
            ))}
            {scenes.length === 0 ? (
              <div className="flex h-full min-w-[220px] items-center rounded-xl border border-dashed border-neutral-300 bg-white px-4 text-sm text-neutral-500">
                Save or generate a scene to fill this gallery.
              </div>
            ) : null}
          </div>
        </section>
      </footer>
    </main>
  );
}
