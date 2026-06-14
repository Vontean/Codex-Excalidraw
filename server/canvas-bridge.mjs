import { promises as fs } from "node:fs";
import {
  artifactsDir,
  defaultCanvasBackgroundColor,
  defaultFontFamily,
  defaultFontFamilyName,
  getRuntimeConfig
} from "./config.mjs";
import {
  createSnapshot,
  listScenes,
  normalizeSceneName,
  readScene,
  resolveSnapshotPath,
  restoreSnapshot,
  scenePath,
  writeScene
} from "./scene-workspace.mjs";
import {
  exportSceneAsset,
  patchSceneFile,
  qaScene,
  summarizeScene
} from "./server.mjs";
import { readDiagramGuide } from "./diagram-guide.mjs";
import { convertMermaidToScene } from "./mermaid-scene.mjs";
import { exportSceneToExcalidrawUrl } from "./excalidraw-share.mjs";

const SCENE_SOURCE = "https://codex.local/excalidraw-codex";
const DEFAULT_WORKBENCH_URL = process.env.EXCALIDRAW_CODEX_WORKBENCH_URL || "http://127.0.0.1:3000/";

function browserUrl(scene, baseUrl = DEFAULT_WORKBENCH_URL) {
  return `${baseUrl.replace(/\/$/, "")}/?scene=${encodeURIComponent(normalizeSceneName(scene))}`;
}

function apiUrl(apiPath, baseUrl = DEFAULT_WORKBENCH_URL) {
  return `${baseUrl.replace(/\/$/, "")}/${apiPath.replace(/^\//, "")}`;
}

async function fetchActiveCanvas(input = {}) {
  try {
    const response = await fetch(apiUrl("/api/current-scene", input.baseUrl));
    if (!response.ok) return null;
    const current = await response.json();
    return current?.active && current.scene ? current : null;
  } catch {
    return null;
  }
}

async function resolveCanvasScene(input = {}, fallback) {
  if (input.scene || input.name) {
    return normalizeSceneName(input.scene || input.name);
  }
  const active = await fetchActiveCanvas(input);
  if (active?.scene) {
    return normalizeSceneName(active.scene);
  }
  if (fallback) {
    return normalizeSceneName(fallback);
  }
  throw new Error("No scene was provided and no active browser canvas is registered. Open a canvas in the workbench or pass a scene name.");
}

async function fetchLiveScene(scene, input = {}) {
  if (input.live === false || input.preferLive === false) return null;
  const sceneName = normalizeSceneName(scene);
  try {
    const response = await fetch(
      apiUrl(`/api/live-scenes/${encodeURIComponent(sceneName)}?includeScene=true`, input.baseUrl)
    );
    if (!response.ok) return null;
    const live = await response.json();
    if (!live?.sceneData || live.sceneData.type !== "excalidraw" || !Array.isArray(live.sceneData.elements)) return null;
    return live;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Live canvas conflict")) {
      throw error;
    }
    return null;
  }
}

async function fetchLiveSceneStatus(scene, input = {}) {
  const sceneName = normalizeSceneName(scene);
  try {
    const response = await fetch(
      apiUrl(`/api/live-scenes/${encodeURIComponent(sceneName)}/status`, input.baseUrl)
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWorkbenchSubscriber(scene, input = {}) {
  const waitMs = Math.max(0, Number(input.waitForSubscriberMs || 0));
  const sceneName = normalizeSceneName(scene);
  let status = await fetchLiveSceneStatus(sceneName, input);
  if (!waitMs || status?.browserReady) return status;

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(100);
    status = await fetchLiveSceneStatus(sceneName, input);
    if (status?.browserReady) return status;
  }
  return status;
}

async function readCanvasScene(scene, input = {}) {
  const sceneName = normalizeSceneName(scene);
  const live = await fetchLiveScene(sceneName, input);
  if (live?.sceneData) {
    return {
      scene: live.sceneData,
      source: "live",
      live
    };
  }
  return {
    scene: await readScene(sceneName),
    source: "file",
    live: null
  };
}

async function materializeLiveScene(scene, input = {}) {
  const sceneName = normalizeSceneName(scene);
  const live = await fetchLiveScene(sceneName, input);
  if (!live?.sceneData) {
    return null;
  }
  if (live.revision && !input.baseRevision && !input._liveBaseRevision) {
    input._liveBaseRevision = live.revision;
  }
  await writeScene(sceneName, live.sceneData);
  return live;
}

async function pushLiveScene(scene, sceneData, input = {}) {
  if (input.pushLive === false) return null;
  const sceneName = normalizeSceneName(scene);
  try {
    const response = await fetch(apiUrl(`/api/live-scenes/${encodeURIComponent(sceneName)}`, input.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        scene: sceneData,
        baseRevision: input._liveBaseRevision || input.baseRevision,
        revision: input.revision || `mcp-${Date.now()}`,
        clientId: input.clientId || "excalidraw-codex-mcp",
        source: input.source || "mcp",
        previewUpdated: Boolean(input.previewUpdated)
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (payload?.conflict) {
        throw new Error(
          `Live canvas conflict for ${sceneName}: baseRevision ${payload.baseRevision} is stale; current revision is ${payload.currentRevision}. Read the live canvas again before continuing.`
        );
      }
      return payload || { ok: false, status: response.status };
    }
    if (payload?.revision) {
      input._liveBaseRevision = payload.revision;
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Live canvas conflict")) {
      throw error;
    }
    return null;
  }
}

function shouldRefreshScenePreview(input = {}) {
  if (input.dryRun) return false;
  return input.refreshPreview === true || input.preview === true;
}

async function refreshScenePreview(scene, input = {}) {
  if (!shouldRefreshScenePreview(input)) return undefined;
  const sceneName = normalizeSceneName(scene);
  try {
    return await exportSceneAsset(sceneName, {
      format: input.previewFormat || "png",
      baseUrl: input.baseUrl || DEFAULT_WORKBENCH_URL
    });
  } catch (error) {
    return {
      ok: false,
      scene: sceneName,
      format: "png",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fetchLiveStatus(input = {}) {
  try {
    const path = input.scene || input.name
      ? `/api/live-scenes/${encodeURIComponent(normalizeSceneName(input.scene || input.name))}`
      : "/api/live-scenes";
    const response = await fetch(apiUrl(path, input.baseUrl));
    if (!response.ok) {
      return {
        ok: false,
        live: false,
        status: response.status
      };
    }
    return await response.json();
  } catch (error) {
    return {
      ok: false,
      live: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function createBlankScene(options = {}) {
  return {
    type: "excalidraw",
    version: 2,
    source: SCENE_SOURCE,
    elements: [],
    appState: {
      viewBackgroundColor: options.backgroundColor || defaultCanvasBackgroundColor,
      gridSize: null,
      currentItemFontFamily: defaultFontFamily,
      codex: {
        generator: "canvas-bridge",
        createdBy: "excalidraw-codex-mcp",
        defaultFontFamily,
        defaultFontFamilyName,
        title: options.title || undefined,
        createdAt: new Date().toISOString()
      }
    },
    files: {}
  };
}

async function sceneExists(scene) {
  try {
    await fs.access(scenePath(scene));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function roundNumber(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : undefined;
}

function elementText(element) {
  if (typeof element?.text === "string" && element.text.trim()) return element.text.trim();
  if (typeof element?.label?.text === "string" && element.label.text.trim()) return element.label.text.trim();
  if (typeof element?.customData?.label === "string" && element.customData.label.trim()) return element.customData.label.trim();
  return "";
}

function compactElement(element) {
  return {
    id: element.id,
    type: element.type,
    text: elementText(element) || undefined,
    x: roundNumber(element.x),
    y: roundNumber(element.y),
    width: roundNumber(element.width),
    height: roundNumber(element.height),
    groupIds: Array.isArray(element.groupIds) && element.groupIds.length ? element.groupIds : undefined,
    role: element.customData?.codexRole,
    kind: element.customData?.codexKind
  };
}

function elementBounds(element) {
  const x = Number(element?.x || 0);
  const y = Number(element?.y || 0);
  const width = Number(element?.width || 0);
  const height = Number(element?.height || 0);
  const right = x + width;
  const bottom = y + height;
  return {
    x: Math.min(x, right),
    y: Math.min(y, bottom),
    width: Math.abs(width),
    height: Math.abs(height),
    right: Math.max(x, right),
    bottom: Math.max(y, bottom)
  };
}

function activeElements(scene) {
  return Array.isArray(scene?.elements)
    ? scene.elements.filter((element) => element && !element.isDeleted)
    : [];
}

function touchElement(element) {
  element.version = Number(element.version || 0) + 1;
  element.versionNonce = Math.floor(Math.random() * 2_147_483_647);
  element.updated = Date.now();
}

function parseElementInput(input = {}) {
  const raw = input.elements || input.element || [];
  if (typeof raw === "string") {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("elements JSON must be an array.");
    return parsed;
  }
  if (Array.isArray(raw)) return raw;
  throw new Error("elements must be an array or a JSON array string.");
}

function isPseudoElement(element) {
  return ["cameraUpdate", "delete", "restoreCheckpoint"].includes(element?.type);
}

function externalElementText(element = {}) {
  if (typeof element.text === "string") return element.text;
  if (typeof element.label === "string") return element.label;
  if (typeof element.label?.text === "string") return element.label.text;
  return undefined;
}

function normalizeExternalElement(element = {}) {
  const next = JSON.parse(JSON.stringify(element));
  if (next.startElementId && !next.start) next.start = { id: next.startElementId };
  if (next.endElementId && !next.end) next.end = { id: next.endElementId };
  if (typeof next.fontFamily === "string" && /^\d+$/.test(next.fontFamily)) {
    next.fontFamily = Number(next.fontFamily);
  }
  if (next.type === "text" && next.text === undefined && next.label?.text) {
    next.text = next.label.text;
  }
  return next;
}

function connectionIdsFromExternalElement(element = {}) {
  const start =
    element.startElementId ||
    element.start?.id ||
    element.startBinding?.elementId ||
    element.from ||
    element.source;
  const end =
    element.endElementId ||
    element.end?.id ||
    element.endBinding?.elementId ||
    element.to ||
    element.targetId;
  return { start, end };
}

function externalElementsToPatchOps(elements = []) {
  const normalized = elements
    .filter((element) => element && !isPseudoElement(element))
    .map(normalizeExternalElement);
  const regularElements = [];
  const connectorOps = [];

  for (const element of normalized) {
    const { start, end } = connectionIdsFromExternalElement(element);
    const canBind = (element.type === "arrow" || element.type === "line") && start && end;
    if (!canBind) {
      regularElements.push(element);
      continue;
    }
    connectorOps.push({
      op: "connect",
      id: element.id,
      from: start,
      to: end,
      text: externalElementText(element),
      fontSize: element.fontSize || element.label?.fontSize,
      fontFamily: element.fontFamily || element.label?.fontFamily,
      strokeColor: element.strokeColor,
      strokeWidth: element.strokeWidth,
      strokeStyle: element.strokeStyle,
      roughness: element.roughness,
      endArrowhead: element.endArrowhead,
      startArrowhead: element.startArrowhead,
      customData: element.customData
    });
  }

  const ops = [];
  if (regularElements.length) {
    ops.push({ op: "add", elements: regularElements });
  }
  ops.push(...connectorOps);
  return ops;
}

function deleteIdsFromPseudoElements(elements = []) {
  return elements
    .filter((element) => element?.type === "delete")
    .flatMap((element) => String(element.ids ?? element.id ?? "").split(","))
    .map((id) => id.trim())
    .filter(Boolean);
}

async function readSnapshotScene(scene, reference) {
  const snapshotPath = await resolveSnapshotPath(scene, reference);
  const raw = await fs.readFile(snapshotPath, "utf8");
  return {
    scene: JSON.parse(raw),
    path: snapshotPath
  };
}

function applyDeleteIds(scene, ids = []) {
  if (!ids.length) return 0;
  const deleteIds = new Set(ids.map(String));
  let deleted = 0;
  for (const element of activeElements(scene)) {
    if (deleteIds.has(String(element.id)) || deleteIds.has(String(element.containerId))) {
      element.isDeleted = true;
      touchElement(element);
      deleted += 1;
    }
  }
  return deleted;
}

function cameraUpdatesFromElements(elements = []) {
  return elements
    .filter((element) => element?.type === "cameraUpdate")
    .map((camera) => ({
      x: roundNumber(camera.x),
      y: roundNumber(camera.y),
      width: roundNumber(camera.width),
      height: roundNumber(camera.height),
      zoom: Number.isFinite(Number(camera.zoom)) ? Number(camera.zoom) : undefined
    }));
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(max, Math.max(min, number));
}

function latestCameraUpdate(cameraUpdates = []) {
  return cameraUpdates.filter(Boolean).at(-1);
}

function applyCameraToScene(scene, cameraUpdate, input = {}) {
  if (!cameraUpdate) return null;
  const viewportWidth = Number(input.viewportWidth || 800);
  const padding = Number(input.cameraPadding ?? 40);
  const zoom = clampNumber(
    cameraUpdate.zoom ?? (cameraUpdate.width ? viewportWidth / Number(cameraUpdate.width) : 1),
    0.1,
    4
  ) || 1;
  const x = Number(cameraUpdate.x || 0);
  const y = Number(cameraUpdate.y || 0);
  const viewport = {
    scrollX: Math.round(-x * zoom + padding),
    scrollY: Math.round(-y * zoom + padding),
    zoom: { value: Number(zoom.toFixed(3)) },
    camera: cameraUpdate
  };
  scene.appState = {
    ...(scene.appState || {}),
    scrollX: viewport.scrollX,
    scrollY: viewport.scrollY,
    zoom: viewport.zoom,
    codex: {
      ...(scene.appState?.codex || {}),
      lastCameraUpdate: cameraUpdate,
      viewportFromCameraUpdate: viewport
    }
  };
  return viewport;
}

function shouldRevealCreateView(input = {}) {
  return Boolean(input.reveal || input.progressive || input.stream);
}

function revealDelay(input = {}) {
  return clampNumber(input.revealDelayMs ?? input.delayMs ?? 160, 0, 1200) ?? 160;
}

function revealChunkSize(input = {}) {
  return Math.max(1, Math.min(24, Math.round(Number(input.revealChunkSize || input.chunkSize || 6))));
}

function splitCreateViewRevealStages(elements = [], input = {}) {
  const stages = [];
  let currentCamera = null;
  let chunk = [];
  const maxChunkSize = revealChunkSize(input);

  const flush = () => {
    if (!chunk.length && !currentCamera) return;
    stages.push({
      camera: currentCamera,
      elements: chunk
    });
    chunk = [];
    currentCamera = null;
  };

  for (const element of elements) {
    if (!element || element.type === "restoreCheckpoint") continue;
    if (element.type === "cameraUpdate") {
      flush();
      currentCamera = normalizeExternalElement(element);
      stages.push({
        camera: currentCamera,
        elements: []
      });
      currentCamera = null;
      continue;
    }
    chunk.push(element);
    if (chunk.length >= maxChunkSize || element.type === "delete") {
      flush();
    }
  }
  flush();
  return stages;
}

async function applyCreateViewReveal(scene, baseScene, parsedElements, input = {}) {
  const stages = splitCreateViewRevealStages(parsedElements, input);
  const delayMs = revealDelay(input);
  let appliedStages = 0;
  let deleted = 0;
  let current = baseScene;
  const revealInput = {
    ...input,
    source: "mcp-reveal"
  };

  await writeScene(scene, current);
  revealInput.revision = `mcp-reveal-${Date.now()}-0`;
  await pushLiveScene(scene, current, revealInput);

  for (const [index, stage] of stages.entries()) {
    if (stage.camera) {
      applyCameraToScene(current, stage.camera, input);
    }
    const deleteIds = deleteIdsFromPseudoElements(stage.elements);
    if (deleteIds.length) {
      deleted += applyDeleteIds(current, deleteIds);
      await writeScene(scene, current);
    }
    const ops = externalElementsToPatchOps(stage.elements);
    if (ops.length) {
      await patchSceneFile(scene, { ops }, {
        dryRun: false,
        snapshot: false,
        refreshConnectors: input.refreshConnectors !== false
      });
      current = await readScene(scene);
      if (stage.camera) {
        applyCameraToScene(current, stage.camera, input);
        await writeScene(scene, current);
      }
    } else if (stage.camera || deleteIds.length) {
      await writeScene(scene, current);
    }
    revealInput.revision = `mcp-reveal-${Date.now()}-${index + 1}`;
    await pushLiveScene(scene, current, revealInput);
    appliedStages += 1;
    if (delayMs > 0 && index < stages.length - 1) {
      await sleep(delayMs);
    }
  }
  if (revealInput._liveBaseRevision) {
    input._liveBaseRevision = revealInput._liveBaseRevision;
  }

  return {
    current,
    stages: appliedStages,
    deleted,
    delayMs
  };
}

function compactSummary(scene, name, options = {}) {
  const summary = summarizeScene(scene, { name });
  const elements = activeElements(scene);
  const maxElements = Number(options.maxElements || 120);
  return {
    scene: summary.scene,
    browserUrl: browserUrl(name, options.baseUrl),
    path: scenePath(name),
    elementsByType: summary.elementsByType,
    regions: summary.regions,
    groups: summary.groups,
    connections: summary.connections,
    texts: summary.texts,
    layoutIssues: summary.layoutIssues.slice(0, Number(options.maxIssues || 12)),
    elements: options.includeElements === false ? undefined : elements.slice(0, maxElements).map(compactElement),
    truncated: elements.length > maxElements,
    source: options.source || "file",
    live: options.live
      ? {
          sessionId: options.live.sessionId,
          updatedAt: options.live.updatedAt,
          revision: options.live.revision,
          clientRevision: options.live.clientRevision,
          clientId: options.live.clientId,
          source: options.live.source,
          activeElementCount: options.live.activeElementCount
        }
      : undefined
  };
}

export async function openOrCreateCanvas(input = {}) {
  const scene = await resolveCanvasScene(input, "codex-canvas.excalidraw");
  const created = !(await sceneExists(scene));
  if (created) {
    await writeScene(scene, createBlankScene({
      title: input.title,
      backgroundColor: input.backgroundColor
    }));
  }
  const workbenchStatus = await waitForWorkbenchSubscriber(scene, input);
  const current = await readCanvasScene(scene, input);
  const liveStatus = current.live
    ? {
        ok: true,
        live: true,
        sessionId: current.live.sessionId,
        updatedAt: current.live.updatedAt,
        revision: current.live.revision,
        clientId: current.live.clientId,
        source: current.live.source,
        activeElementCount: current.live.activeElementCount,
        subscriberCount: current.live.subscriberCount,
        browserReady: current.live.browserReady
      }
    : {
        ok: false,
        live: false,
        scene,
        subscriberCount: workbenchStatus?.subscriberCount || 0,
        browserReady: Boolean(workbenchStatus?.browserReady)
      };
  return {
    ok: true,
    scene,
    created,
    path: scenePath(scene),
    browserUrl: browserUrl(scene, input.baseUrl),
    session: {
      scene,
      sessionId: current.live?.sessionId || `file:${scene}`,
      browserUrl: browserUrl(scene, input.baseUrl),
      source: current.source,
      live: Boolean(current.live),
      baseRevision: current.live?.revision || null
    },
    liveStatus,
    readiness: {
      editable: true,
      workbenchUrl: input.baseUrl || DEFAULT_WORKBENCH_URL,
      liveApi: current.live ? "ready" : "file-fallback",
      browserReady: Boolean(workbenchStatus?.browserReady),
      subscriberCount: workbenchStatus?.subscriberCount || 0,
      waitForSubscriberMs: Math.max(0, Number(input.waitForSubscriberMs || 0)),
      conflictPolicy: "baseRevision is enforced when provided"
    },
    baseRevision: current.live?.revision || null,
    context: compactSummary(current.scene, scene, { ...input, source: current.source, live: current.live })
  };
}

export async function getCanvasContext(input = {}) {
  const scene = await resolveCanvasScene(input);
  const current = await readCanvasScene(scene, input);
  const qa = input.qa === false ? undefined : qaScene(current.scene, { name: scene });
  return {
    ok: true,
    scene,
    source: current.source,
    context: compactSummary(current.scene, scene, { ...input, source: current.source, live: current.live }),
    qa
  };
}

export async function applyCanvasPatch(input = {}) {
  const scene = await resolveCanvasScene(input);
  const materializedLive = input.dryRun ? null : await materializeLiveScene(scene, input);
  const plan = input.plan || input.patch || input.operations || input.ops;
  const result = await patchSceneFile(scene, Array.isArray(plan) ? { ops: plan } : plan, {
    dryRun: Boolean(input.dryRun),
    snapshot: input.snapshot !== false,
    label: input.label || "before-mcp-patch",
    refreshConnectors: input.refreshConnectors !== false
  });
  const current = input.dryRun ? result.scene : await readScene(scene);
  let preview;
  if (!input.dryRun) {
    await pushLiveScene(scene, current, input);
    preview = await refreshScenePreview(scene, input);
  }
  return {
    ok: true,
    scene,
    materializedLive: materializedLive
      ? {
          updatedAt: materializedLive.updatedAt,
          revision: materializedLive.revision,
          source: materializedLive.source
        }
      : undefined,
    result,
    preview,
    context: compactSummary(current, scene, { ...input, source: "file" })
  };
}

export async function createCanvasView(input = {}) {
  const scene = await resolveCanvasScene(input, "codex-view.excalidraw");
  const parsedElements = parseElementInput(input);
  const restoreCheckpoint = parsedElements.find((element) => element?.type === "restoreCheckpoint");
  const deleteIds = deleteIdsFromPseudoElements(parsedElements);
  const cameraUpdates = cameraUpdatesFromElements(parsedElements);
  const mode = input.mode || (restoreCheckpoint ? "append" : "replace");
  const existed = await sceneExists(scene);
  if (!input.dryRun && !input.baseRevision && !input._liveBaseRevision) {
    const live = await fetchLiveScene(scene, input);
    if (live?.revision) input._liveBaseRevision = live.revision;
  }
  const beforeSnapshot = input.dryRun || input.snapshot === false || !existed
    ? null
    : await createSnapshot(scene, { label: input.label || "before-create-view" });

  let baseScene;
  let restoredFrom;
  if (restoreCheckpoint?.id) {
    const restored = await readSnapshotScene(scene, restoreCheckpoint.id);
    baseScene = restored.scene;
    restoredFrom = restored.path;
  } else if (mode === "append" && existed) {
    const current = await readCanvasScene(scene, input);
    if (current.live?.revision && !input.baseRevision && !input._liveBaseRevision) {
      input._liveBaseRevision = current.live.revision;
    }
    baseScene = current.scene;
  } else {
    baseScene = createBlankScene({
      title: input.title,
      backgroundColor: input.backgroundColor
    });
  }

  const revealEnabled = !input.dryRun && shouldRevealCreateView(input);
  const deleted = revealEnabled ? 0 : applyDeleteIds(baseScene, deleteIds);
  const finalCameraUpdate = latestCameraUpdate(cameraUpdates);
  const finalViewport = applyCameraToScene(baseScene, finalCameraUpdate, input);
  baseScene.appState = {
    ...(baseScene.appState || {}),
    codex: {
      ...(baseScene.appState?.codex || {}),
      drawingProtocol: "create_view",
      cameraUpdates,
      lastCameraUpdate: finalCameraUpdate,
      updatedAt: new Date().toISOString()
    }
  };

  if (!input.dryRun && !revealEnabled) {
    await writeScene(scene, baseScene);
  }

  const ops = externalElementsToPatchOps(parsedElements);
  let patchResult;
  let revealResult;
  if (revealEnabled) {
    revealResult = await applyCreateViewReveal(scene, baseScene, parsedElements, input);
  } else if (ops.length) {
    patchResult = await patchSceneFile(scene, { ops }, {
      dryRun: Boolean(input.dryRun),
      snapshot: false,
      refreshConnectors: input.refreshConnectors !== false
    });
  }

  const current = input.dryRun
    ? (patchResult?.scene || baseScene)
    : revealResult?.current || await readScene(scene);
  const checkpoint = input.dryRun ? null : await createSnapshot(scene, {
    label: input.checkpointLabel || "checkpoint"
  });

  if (!input.dryRun) {
    const viewport = applyCameraToScene(current, finalCameraUpdate, input) || finalViewport;
    current.appState = {
      ...(current.appState || {}),
      codex: {
        ...(current.appState?.codex || {}),
        drawingProtocol: "create_view",
        checkpointId: checkpoint?.name,
        cameraUpdates,
        lastCameraUpdate: finalCameraUpdate,
        finalViewport: viewport,
        restoredFrom,
        beforeSnapshot,
        deletedByPseudoElements: deleted,
        reveal: revealResult
          ? {
              enabled: true,
              stages: revealResult.stages,
              delayMs: revealResult.delayMs,
              deletedDuringReveal: revealResult.deleted
            }
          : { enabled: false },
        updatedAt: new Date().toISOString()
      }
    };
    await writeScene(scene, current);
    await pushLiveScene(scene, current, input);
  }
  const preview = !input.dryRun ? await refreshScenePreview(scene, input) : undefined;

  return {
    ok: true,
    scene,
    mode,
    path: scenePath(scene),
    browserUrl: browserUrl(scene, input.baseUrl),
    checkpointId: checkpoint?.name,
    checkpoint,
    beforeSnapshot,
    restoredFrom,
    deleted,
    cameraUpdates,
    viewport: input.dryRun ? finalViewport : current.appState?.codex?.finalViewport,
    reveal: revealResult
      ? {
          enabled: true,
          stages: revealResult.stages,
          delayMs: revealResult.delayMs,
          deletedDuringReveal: revealResult.deleted
        }
      : { enabled: false },
    patch: patchResult,
    preview,
    context: compactSummary(current, scene, { ...input, source: input.dryRun ? "dry-run" : "file" })
  };
}

export async function createCanvasFromMermaid(input = {}) {
  const scene = await resolveCanvasScene(input, "mermaid-diagram.excalidraw");
  const definition = input.mermaidDiagram || input.mermaid || input.definition || input.source;
  const existed = await sceneExists(scene);
  const snapshot = input.snapshot === false || !existed ? null : await createSnapshot(scene, {
    label: input.label || "before-create-from-mermaid"
  });
  const sceneData = await convertMermaidToScene(definition, {
    baseUrl: input.baseUrl || DEFAULT_WORKBENCH_URL,
    fontSize: input.fontSize,
    backgroundColor: input.backgroundColor
  });
  sceneData.appState = {
    ...(sceneData.appState || {}),
    codex: {
      ...(sceneData.appState?.codex || {}),
      drawingProtocol: "create_from_mermaid",
      updatedAt: new Date().toISOString()
    }
  };
  if (!input.dryRun) {
    await writeScene(scene, sceneData);
    await pushLiveScene(scene, sceneData, input);
  }
  const preview = !input.dryRun ? await refreshScenePreview(scene, input) : undefined;
  const exported = !input.dryRun && input.export
    ? await exportCanvas({
      ...input,
      scene,
      format: input.exportFormat || input.format || "png",
      materializeLive: false
    })
    : undefined;
  return {
    ok: true,
    scene,
    path: scenePath(scene),
    browserUrl: browserUrl(scene, input.baseUrl),
    snapshot,
    elementCount: activeElements(sceneData).length,
    preview,
    export: exported,
    context: compactSummary(sceneData, scene, { ...input, source: input.dryRun ? "dry-run" : "file" })
  };
}

export async function restoreCanvasSnapshot(input = {}) {
  const scene = await resolveCanvasScene(input);
  const reference = input.from || input.snapshotName || input.checkpointId || "latest";
  const beforeSnapshot = input.snapshot === false ? null : await createSnapshot(scene, {
    label: input.label || "before-restore-snapshot"
  });
  const restored = input.dryRun
    ? {
        scene,
        restoredFrom: await resolveSnapshotPath(scene, reference),
        path: scenePath(scene)
      }
    : await restoreSnapshot(scene, reference);
  const current = input.dryRun ? (await readSnapshotScene(scene, reference)).scene : await readScene(scene);
  let preview;
  if (!input.dryRun) {
    await pushLiveScene(scene, current, input);
    preview = await refreshScenePreview(scene, input);
  }
  return {
    ok: true,
    scene,
    beforeSnapshot,
    restored,
    preview,
    context: compactSummary(current, scene, input)
  };
}

export async function exportCanvas(input = {}) {
  const scene = await resolveCanvasScene(input);
  if (input.materializeLive !== false) {
    await materializeLiveScene(scene, input);
  }
  const format = input.format || "png";
  const formats = format === "all" ? ["png", "svg"] : [format === "svg" ? "svg" : "png"];
  const exports = [];
  for (const item of formats) {
    exports.push(await exportSceneAsset(scene, {
      format: item,
      baseUrl: input.baseUrl || DEFAULT_WORKBENCH_URL
    }));
  }
  if (!input.dryRun && input.notifyWorkbench !== false) {
    try {
      await pushLiveScene(scene, await readScene(scene), {
        ...input,
        source: input.source || "mcp-export",
        previewUpdated: true,
        revision: input.revision || `mcp-export-${Date.now()}`
      });
    } catch {
      // Export already produced the artifact; workbench notification is best-effort.
    }
  }
  return {
    ok: true,
    scene,
    exports
  };
}

export async function exportCanvasToExcalidrawUrl(input = {}) {
  const scene = await resolveCanvasScene(input);
  if (input.materializeLive !== false) {
    await materializeLiveScene(scene, input);
  }
  const current = await readCanvasScene(scene, input);
  const result = await exportSceneToExcalidrawUrl(current.scene, {
    dryRun: Boolean(input.dryRun),
    endpoint: input.endpoint,
    includeFiles: input.includeFiles !== false,
    includeDeleted: Boolean(input.includeDeleted),
    includeCustomData: Boolean(input.includeCustomData)
  });
  return {
    ok: true,
    scene,
    browserUrl: browserUrl(scene, input.baseUrl),
    source: current.source,
    share: result
  };
}

export async function reviewCanvas(input = {}) {
  const scene = await resolveCanvasScene(input);
  let materializedLive = null;
  if (input.materializeLive !== false) {
    materializedLive = await materializeLiveScene(scene, input);
  }

  const currentRead = await readCanvasScene(scene, input);
  const current = currentRead.scene;
  const qa = input.qa === false ? undefined : qaScene(current, { name: scene });
  const guide = input.includeGuide === false ? undefined : readDiagramGuide({ topic: "review" }).guide;
  const reviewProtocol = [
    "Inspect the PNG image directly before deciding the canvas is done.",
    "Use the structured context to locate elements and understand relationships, not as a substitute for visual judgment.",
    "Prefer one targeted patch for local readability issues; do not rebuild the whole canvas unless the expression strategy is wrong.",
    "If the canvas is clear and answers the user's request, stop instead of over-polishing."
  ];

  let screenshot;
  let imageContent;
  if (input.includeImage !== false) {
    const exportResult = await exportSceneAsset(scene, {
      format: "png",
      variant: "review",
      baseUrl: input.baseUrl || DEFAULT_WORKBENCH_URL
    });
    const data = await fs.readFile(exportResult.path, "base64");
    screenshot = {
      path: exportResult.path,
      url: exportResult.url,
      size: exportResult.size,
      mimeType: "image/png",
      modifiedAt: exportResult.modifiedAt
    };
    imageContent = { type: "image", data, mimeType: "image/png" };
  }

  const payload = {
    ok: true,
    scene,
    browserUrl: browserUrl(scene, input.baseUrl),
    source: currentRead.source,
    materializedLive: materializedLive
      ? {
          updatedAt: materializedLive.updatedAt,
          revision: materializedLive.revision,
          source: materializedLive.source
        }
      : undefined,
    reviewProtocol,
    context: compactSummary(current, scene, {
      ...input,
      includeElements: input.includeElements === true,
      source: currentRead.source,
      live: currentRead.live
    }),
    qa,
    guide,
    screenshot
  };

  return {
    ok: true,
    scene,
    ...payload,
    _mcpContent: [
      { type: "text", text: JSON.stringify(payload, null, 2) },
      ...(imageContent ? [imageContent] : [])
    ]
  };
}

export async function snapshotCanvas(input = {}) {
  const scene = await resolveCanvasScene(input);
  if (input.materializeLive !== false) {
    await materializeLiveScene(scene, input);
  }
  return {
    ok: true,
    snapshot: await createSnapshot(scene, {
      label: input.label || "mcp-snapshot"
    })
  };
}

export async function listCanvases() {
  return {
    ok: true,
    scenes: await listScenes(),
    liveScenes: (await fetchLiveStatus()).scenes || [],
    artifactsDir
  };
}

export function getCanvasRuntime() {
  return {
    ok: true,
    ...getRuntimeConfig(),
    workbenchUrl: DEFAULT_WORKBENCH_URL,
    mcpCommand: "excalidraw-codex mcp"
  };
}

export const canvasTools = {
  create_view: createCanvasView,
  create_from_mermaid: createCanvasFromMermaid,
  export_to_excalidraw_url: exportCanvasToExcalidrawUrl,
  restore_snapshot: restoreCanvasSnapshot,
  open_or_create_canvas: openOrCreateCanvas,
  get_canvas_context: getCanvasContext,
  apply_canvas_patch: applyCanvasPatch,
  export_canvas: exportCanvas,
  review_canvas: reviewCanvas,
  snapshot_canvas: snapshotCanvas,
  read_diagram_guide: readDiagramGuide
};
