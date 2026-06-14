import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  convertToExcalidrawElements
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import {
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Save,
  X
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
  updateLibrary: (library: {
    libraryItems: unknown[] | Promise<unknown[]>;
    merge?: boolean;
    defaultStatus?: "published" | "unpublished";
  }) => Promise<unknown>;
  resetScene: () => void;
};

type InitialSceneData = ExcalidrawScene & {
  scrollToContent?: boolean;
};

type InstalledLibrariesResponse = {
  ok: boolean;
  itemCount: number;
  libraryItems: unknown[];
};

type LiveSceneResponse = {
  ok: boolean;
  scene: string;
  sessionId?: string;
  live: boolean;
  updatedAt: string;
  revision: string;
  clientRevision?: string;
  clientId: string;
  source: string;
  previewUpdated?: boolean;
  activeElementCount: number;
  conflict?: boolean;
  sceneData?: ExcalidrawScene;
};

const FALLBACK_SCENE_NAME = "untitled.excalidraw";
const DEFAULT_FONT_FAMILY = 6;

function liveSourceLabel(source: string) {
  if (source === "mcp" || source === "mcp-reveal" || source === "mcp-export") return "Codex";
  if (source === "workbench") return "the browser";
  return "a collaborator";
}

function liveStatusMessage(live: LiveSceneResponse) {
  if (live.previewUpdated) return "Preview updated";
  return `Canvas updated from ${liveSourceLabel(live.source)}`;
}

function normalizeFileName(value: string) {
  const trimmed = value.trim() || FALLBACK_SCENE_NAME;
  return trimmed.endsWith(".excalidraw") ? trimmed : `${trimmed}.excalidraw`;
}

function toDisplaySceneName(value: string) {
  return normalizeFileName(value).replace(/\.excalidraw$/, "");
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
  const latestSceneRef = useRef<ExcalidrawScene>(createBlankScene(DEFAULT_FONT_FAMILY));
  const liveSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const galleryRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveSyncRevisionRef = useRef(0);
  const liveSyncClientIdRef = useRef(`workbench-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const liveAppliedRevisionRef = useRef<string | null>(null);
  const localChangeAtRef = useRef(0);
  const suppressLiveSyncUntilRef = useRef(0);
  const [excalidrawApi, setExcalidrawApi] = useState<ExcalidrawApi | null>(null);
  const [sceneName, setSceneName] = useState(toDisplaySceneName(FALLBACK_SCENE_NAME));
  const [currentSceneName, setCurrentSceneName] = useState(FALLBACK_SCENE_NAME);
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [defaultFontFamily, setDefaultFontFamily] = useState(DEFAULT_FONT_FAMILY);
  const [defaultCanvasBackgroundColor, setDefaultCanvasBackgroundColor] = useState<string | undefined>();
  const [installedLibraryItems, setInstalledLibraryItems] = useState<unknown[]>([]);
  const [initialData, setInitialData] = useState<InitialSceneData>(createBlankScene(DEFAULT_FONT_FAMILY));
  const [canvasKey, setCanvasKey] = useState(0);
  const [, setStatus] = useState("Ready");
  const [, setStatusTone] = useState<"neutral" | "error">("neutral");
  const [isBusy, setIsBusy] = useState(false);

  const activeSceneLabel = useMemo(() => normalizeFileName(currentSceneName), [currentSceneName]);

  const refreshScenes = useCallback(async () => {
    const response = await fetch("/api/scenes");
    if (!response.ok) {
      throw new Error(`Unable to list scenes: ${response.status}`);
    }
    const data = (await response.json()) as SceneSummary[];
    setScenes(data);
    setStatusTone("neutral");
  }, []);

  const scheduleGalleryRefresh = useCallback(
    (delayMs = 1200) => {
      if (galleryRefreshTimerRef.current) {
        clearTimeout(galleryRefreshTimerRef.current);
      }
      galleryRefreshTimerRef.current = setTimeout(() => {
        galleryRefreshTimerRef.current = null;
        refreshScenes().catch((error: unknown) => {
          setStatus(error instanceof Error ? error.message : String(error));
          setStatusTone("error");
        });
      }, delayMs);
    },
    [refreshScenes]
  );

  const applyRemoteLiveScene = useCallback(
    (live: LiveSceneResponse) => {
      if (!excalidrawApi || !live.sceneData) return;
      const normalized = normalizeLoadedScene(live.sceneData);
      liveAppliedRevisionRef.current = live.revision;
      latestSceneRef.current = normalized;
      suppressLiveSyncUntilRef.current = Date.now() + 1600;
      if (liveSyncTimerRef.current) {
        clearTimeout(liveSyncTimerRef.current);
        liveSyncTimerRef.current = null;
      }
      excalidrawApi.updateScene({
        elements: normalized.elements,
        appState: normalized.appState,
        files: normalized.files
      });
      setInitialData(toInitialData(normalized, normalized.elements.length > 0));
      setStatus(liveStatusMessage(live));
      setStatusTone("neutral");
      scheduleGalleryRefresh(live.previewUpdated ? 80 : 1200);
    },
    [excalidrawApi, scheduleGalleryRefresh]
  );

  const handleIncomingLiveScene = useCallback(
    (live: LiveSceneResponse) => {
      if (!live.sceneData) return;
      if (live.clientId === liveSyncClientIdRef.current) {
        liveAppliedRevisionRef.current = live.revision;
        return;
      }
      if (live.revision === liveAppliedRevisionRef.current) return;
      const liveUpdatedAt = Date.parse(live.updatedAt);
      if (Number.isFinite(liveUpdatedAt) && localChangeAtRef.current > liveUpdatedAt + 250) {
        return;
      }
      applyRemoteLiveScene(live);
    },
    [applyRemoteLiveScene]
  );

  const syncLiveScene = useCallback(async (name: string, scene: ExcalidrawScene) => {
    liveSyncRevisionRef.current += 1;
    const response = await fetch(`/api/live-scenes/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        scene,
        baseRevision: liveAppliedRevisionRef.current ?? undefined,
        revision: `${Date.now()}-${liveSyncRevisionRef.current}`,
        clientId: liveSyncClientIdRef.current,
        source: "workbench"
      })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as LiveSceneResponse | null;
      if (payload?.conflict) {
        setStatus(`Canvas changed elsewhere; reloading the latest version of ${name}`);
        setStatusTone("error");
        const latestResponse = await fetch(`/api/live-scenes/${encodeURIComponent(name)}?includeScene=true`);
        if (latestResponse.ok) {
          const latest = (await latestResponse.json()) as LiveSceneResponse;
          applyRemoteLiveScene(latest);
        }
        return;
      }
      throw new Error(`Unable to sync live canvas for ${name}`);
    }
    const live = (await response.json()) as LiveSceneResponse;
    liveAppliedRevisionRef.current = live.revision;
  }, [applyRemoteLiveScene]);

  const publishCurrentScene = useCallback(async (name: string) => {
    await fetch("/api/current-scene", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        scene: normalizeFileName(name),
        source: "workbench",
        clientId: liveSyncClientIdRef.current
      })
    });
  }, []);

  const publishLiveScene = useCallback(async (name: string, scene: ExcalidrawScene) => {
    const response = await fetch(`/api/live-scenes/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        scene,
        revision: `${Date.now()}-save`,
        clientId: liveSyncClientIdRef.current,
        source: "workbench"
      })
    });
    if (!response.ok) {
      throw new Error(`Unable to publish live canvas for ${name}`);
    }
    const live = (await response.json()) as LiveSceneResponse;
    liveAppliedRevisionRef.current = live.revision;
  }, []);

  const scheduleLiveSync = useCallback(
    (scene: ExcalidrawScene) => {
      const targetName = activeSceneLabel;
      if (liveSyncTimerRef.current) {
        clearTimeout(liveSyncTimerRef.current);
      }
      liveSyncTimerRef.current = setTimeout(() => {
        syncLiveScene(targetName, scene).catch((error: unknown) => {
          setStatus(error instanceof Error ? error.message : String(error));
          setStatusTone("error");
        });
      }, 650);
    },
    [activeSceneLabel, syncLiveScene]
  );

  const loadScene = useCallback(
    async (name: string) => {
      const targetName = normalizeFileName(name);
      setIsBusy(true);
      try {
        const response = await fetch(`/api/scenes/${encodeURIComponent(targetName)}`);
        if (!response.ok) {
          if (response.status === 404) {
            const blank = createBlankScene(defaultFontFamily, defaultCanvasBackgroundColor);
            latestSceneRef.current = blank;
            liveAppliedRevisionRef.current = null;
            localChangeAtRef.current = 0;
            setSceneName(toDisplaySceneName(targetName));
            setCurrentSceneName(targetName);
            void publishCurrentScene(targetName);
            setInitialData(toInitialData(blank, false));
            setCanvasKey((value) => value + 1);
            setStatus(`Waiting for live canvas ${targetName}`);
            setStatusTone("neutral");
            window.history.replaceState(null, "", `/?scene=${encodeURIComponent(targetName)}`);
            return;
          }
          throw new Error(`Unable to load ${targetName}`);
        }
        const scene = normalizeLoadedScene((await response.json()) as ExcalidrawScene);
        latestSceneRef.current = scene;
        liveAppliedRevisionRef.current = null;
        localChangeAtRef.current = 0;
        setSceneName(toDisplaySceneName(targetName));
        setCurrentSceneName(targetName);
        void publishCurrentScene(targetName);
        setInitialData(toInitialData(scene, scene.elements.length > 0));
        setCanvasKey((value) => value + 1);
        setStatus(`Loaded ${targetName}`);
        setStatusTone("neutral");
        window.history.replaceState(null, "", `/?scene=${encodeURIComponent(targetName)}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
        setStatusTone("error");
      } finally {
        setIsBusy(false);
      }
    },
    [defaultCanvasBackgroundColor, defaultFontFamily, publishCurrentScene]
  );

  useEffect(() => {
    void publishCurrentScene(activeSceneLabel);
  }, [activeSceneLabel, publishCurrentScene]);

  useEffect(() => {
    fetch("/api/health")
      .then(async (response) => {
        if (!response.ok) return;
        const health = (await response.json()) as {
          defaultCanvasBackgroundColor?: string;
          defaultFontFamily?: number;
        };
        const canvasBackgroundColor = health.defaultCanvasBackgroundColor || undefined;
        setDefaultCanvasBackgroundColor(canvasBackgroundColor);
        if (Number.isFinite(Number(health.defaultFontFamily))) {
          const fontFamily = Number(health.defaultFontFamily);
          setDefaultFontFamily(fontFamily);
          if (!getSceneNameFromUrl()) {
            const blank = createBlankScene(fontFamily, canvasBackgroundColor);
            latestSceneRef.current = blank;
            setInitialData(blank);
          }
        }
      })
      .catch(() => undefined);

    fetch("/api/libraries/items")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Unable to load installed libraries: ${response.status}`);
        }
        const data = (await response.json()) as InstalledLibrariesResponse;
        setInstalledLibraryItems(Array.isArray(data.libraryItems) ? data.libraryItems : []);
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : String(error));
        setStatusTone("error");
      });

    refreshScenes()
      .then(() => {
        const urlScene = getSceneNameFromUrl();
        if (urlScene) {
          void loadScene(urlScene);
        }
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : String(error));
        setStatusTone("error");
      });
  }, [loadScene, refreshScenes]);

  useEffect(() => {
    if (!excalidrawApi) return;
    let cancelled = false;
    const pollLiveScene = async () => {
      try {
        const targetName = activeSceneLabel;
        const response = await fetch(`/api/live-scenes/${encodeURIComponent(targetName)}?includeScene=true`);
        if (!response.ok) return;
        const live = (await response.json()) as LiveSceneResponse;
        if (cancelled || !live.sceneData) return;
        handleIncomingLiveScene(live);
      } catch {
        // Live updates are opportunistic; keep the workbench usable if polling fails.
      }
    };

    const interval = window.setInterval(() => {
      void pollLiveScene();
    }, 1200);
    void pollLiveScene();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeSceneLabel, excalidrawApi, handleIncomingLiveScene]);

  useEffect(() => {
    if (!excalidrawApi || typeof EventSource === "undefined") return;
    const events = new EventSource(`/api/live-scenes/${encodeURIComponent(activeSceneLabel)}/events`);
    const onLiveScene = (event: MessageEvent) => {
      try {
        handleIncomingLiveScene(JSON.parse(event.data) as LiveSceneResponse);
      } catch {
        // Polling remains the fallback for malformed or interrupted SSE events.
      }
    };
    events.addEventListener("live-scene", onLiveScene);
    return () => {
      events.removeEventListener("live-scene", onLiveScene);
      events.close();
    };
  }, [activeSceneLabel, excalidrawApi, handleIncomingLiveScene]);

  useEffect(() => {
    return () => {
      if (liveSyncTimerRef.current) {
        clearTimeout(liveSyncTimerRef.current);
      }
      if (galleryRefreshTimerRef.current) {
        clearTimeout(galleryRefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!excalidrawApi || installedLibraryItems.length === 0) return;

    let cancelled = false;
    excalidrawApi
      .updateLibrary({
        libraryItems: installedLibraryItems,
        merge: true,
        defaultStatus: "published"
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus(error instanceof Error ? error.message : String(error));
        setStatusTone("error");
      });

    return () => {
      cancelled = true;
    };
  }, [excalidrawApi, installedLibraryItems]);

  const refreshSavedPreview = useCallback(
    async (targetName: string, saveLabel: string) => {
      try {
        await refreshPreview(targetName);
        setStatus(`${saveLabel} ${targetName}`);
        setStatusTone("neutral");
      } catch (previewError) {
        setStatus(
          previewError instanceof Error
            ? `${saveLabel} ${targetName}; preview refresh failed: ${previewError.message}`
            : `${saveLabel} ${targetName}; preview refresh failed`
        );
        setStatusTone("error");
      } finally {
        await refreshScenes().catch((error: unknown) => {
          setStatus(error instanceof Error ? error.message : String(error));
          setStatusTone("error");
        });
      }
    },
    [refreshScenes]
  );

  const saveScene = useCallback(async () => {
    const sourceName = activeSceneLabel;
    const targetName = normalizeFileName(sceneName);
    setIsBusy(true);
    try {
      const isRename = sourceName !== targetName;
      const response = isRename
        ? await fetch(`/api/scenes/${encodeURIComponent(sourceName)}/rename`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              to: targetName,
              scene: latestSceneRef.current
            })
          })
        : await fetch(`/api/scenes/${encodeURIComponent(targetName)}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(latestSceneRef.current)
          });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `Unable to save ${targetName}`);
      }
      if (isRename) {
        await fetch(`/api/live-scenes/${encodeURIComponent(sourceName)}`, {
          method: "DELETE"
        }).catch(() => undefined);
      }
      await publishLiveScene(targetName, latestSceneRef.current);
      setSceneName(toDisplaySceneName(targetName));
      setCurrentSceneName(targetName);
      void publishCurrentScene(targetName);
      window.history.replaceState(null, "", `/?scene=${encodeURIComponent(targetName)}`);
      const saveLabel = isRename ? "Renamed and saved" : "Saved";
      setStatus(`${saveLabel} ${targetName}`);
      setStatusTone("neutral");
      void refreshScenes().catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : String(error));
        setStatusTone("error");
      });
      void refreshSavedPreview(targetName, saveLabel);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setStatusTone("error");
    } finally {
      setIsBusy(false);
    }
  }, [activeSceneLabel, publishCurrentScene, publishLiveScene, refreshSavedPreview, refreshScenes, sceneName]);

  const deleteScene = useCallback(
    async (name: string) => {
      const targetName = normalizeFileName(name);
      const shouldDelete = window.confirm(`Delete ${targetName}?`);
      if (!shouldDelete) return;

      setIsBusy(true);
      try {
        const response = await fetch(`/api/scenes/${encodeURIComponent(targetName)}`, {
          method: "DELETE"
        });
        if (!response.ok) {
          throw new Error(`Unable to delete ${targetName}`);
        }

        const remainingScenes = scenes.filter((scene) => scene.name !== targetName);
        setScenes(remainingScenes);
        setStatus(`Deleted ${targetName}`);
        setStatusTone("neutral");

        if (targetName === activeSceneLabel) {
          const nextScene = remainingScenes[0];
          if (nextScene) {
            await loadScene(nextScene.name);
          } else {
            const blank = createBlankScene(defaultFontFamily, defaultCanvasBackgroundColor);
            latestSceneRef.current = blank;
            setSceneName(toDisplaySceneName(FALLBACK_SCENE_NAME));
            setCurrentSceneName(FALLBACK_SCENE_NAME);
            void publishCurrentScene(FALLBACK_SCENE_NAME);
            setInitialData(blank);
            setCanvasKey((value) => value + 1);
            window.history.replaceState(null, "", "/");
          }
        }

        await refreshScenes();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
        setStatusTone("error");
      } finally {
        setIsBusy(false);
      }
    },
    [activeSceneLabel, defaultCanvasBackgroundColor, defaultFontFamily, loadScene, refreshScenes, scenes]
  );

  const blankScene = useMemo(
    () => createBlankScene(defaultFontFamily, defaultCanvasBackgroundColor),
    [defaultCanvasBackgroundColor, defaultFontFamily]
  );

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-white text-ink">
      <section className="min-w-0 flex-1 bg-white">
        <Excalidraw
          key={canvasKey}
          initialData={(initialData || blankScene) as Parameters<typeof Excalidraw>[0]["initialData"]}
          excalidrawAPI={(api) => {
            const nextApi = api as unknown as ExcalidrawApi;
            if (apiRef.current !== nextApi) {
              apiRef.current = nextApi;
              setExcalidrawApi(nextApi);
            }
          }}
          onChange={(elements, appState, files) => {
            const nextScene = toScene(
              elements as unknown[],
              appState as unknown as Record<string, unknown>,
              files as unknown as Record<string, unknown>
            );
            latestSceneRef.current = nextScene;
            if (Date.now() < suppressLiveSyncUntilRef.current) {
              return;
            }
            localChangeAtRef.current = Date.now();
            scheduleLiveSync(nextScene);
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
              onClick={() => {
                refreshScenes().catch((error: unknown) => {
                  setStatus(error instanceof Error ? error.message : String(error));
                  setStatusTone("error");
                });
              }}
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
            {isBusy ? (
              <LoaderCircle aria-label="Saving" className="animate-spin" size={15} />
            ) : (
              <>
                <Save size={14} />
                Save
              </>
            )}
          </button>
        </div>

        <section className="codex-gallery-scroll" aria-label="Generated scenes">
          <div className="flex h-full gap-3">
            {scenes.map((scene) => (
              <div className="gallery-card-shell" key={scene.name}>
                <button
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
                <button
                  type="button"
                  className="gallery-delete-button"
                  title={`Delete ${scene.name}`}
                  aria-label={`Delete ${scene.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteScene(scene.name);
                  }}
                  disabled={isBusy}
                >
                  <X size={14} strokeWidth={2.2} />
                </button>
              </div>
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
