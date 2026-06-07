import { promises as fs } from "node:fs";
import path from "node:path";
import {
  artifactsDir,
  defaultFontFamily,
  defaultFontFamilyName,
  getRuntimeConfig
} from "./config.mjs";
import { createLibraryItemElements, inspectRegisteredLibrary, searchLibraryRegistry } from "./library-registry.mjs";
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
  inspectSceneFile,
  layoutSceneFile,
  patchSceneFile,
  polishSceneFile,
  qaScene,
  summarizeScene
} from "./server.mjs";
import { readDiagramGuide } from "./diagram-guide.mjs";
import { convertMermaidToScene, createSceneFromElements } from "./mermaid-scene.mjs";
import { exportSceneToExcalidrawUrl } from "./excalidraw-share.mjs";

const SCENE_SOURCE = "https://codex.local/excalidraw-codex";
const DEFAULT_WORKBENCH_URL = process.env.EXCALIDRAW_CODEX_WORKBENCH_URL || "http://127.0.0.1:3000/";

function browserUrl(scene, baseUrl = DEFAULT_WORKBENCH_URL) {
  return `${baseUrl.replace(/\/$/, "")}/?scene=${encodeURIComponent(normalizeSceneName(scene))}`;
}

function apiUrl(apiPath, baseUrl = DEFAULT_WORKBENCH_URL) {
  return `${baseUrl.replace(/\/$/, "")}/${apiPath.replace(/^\//, "")}`;
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
  } catch {
    return null;
  }
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
        revision: input.revision || `mcp-${Date.now()}`,
        clientId: input.clientId || "excalidraw-codex-mcp",
        source: input.source || "mcp"
      })
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
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
    return response.json();
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
      viewBackgroundColor: options.backgroundColor || "#ffffff",
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

function matchesSelector(element, selector = {}) {
  if (!selector || selector.all) return true;
  if (Array.isArray(selector.ids) && selector.ids.length && !selector.ids.includes(element.id)) return false;
  if (selector.id && element.id !== selector.id) return false;
  if (selector.type && element.type !== selector.type) return false;
  if (selector.role && element.customData?.codexRole !== selector.role) return false;
  if (selector.kind && element.customData?.codexKind !== selector.kind) return false;
  if (selector.groupId && !(element.groupIds || []).includes(selector.groupId)) return false;
  if (selector.text && elementText(element) !== selector.text) return false;
  if (selector.textIncludes && !elementText(element).toLowerCase().includes(String(selector.textIncludes).toLowerCase())) return false;
  if (selector.bounds) {
    const bounds = elementBounds(element);
    const target = selector.bounds;
    if (target.x !== undefined && bounds.right < Number(target.x)) return false;
    if (target.y !== undefined && bounds.bottom < Number(target.y)) return false;
    if (target.right !== undefined && bounds.x > Number(target.right)) return false;
    if (target.bottom !== undefined && bounds.y > Number(target.bottom)) return false;
  }
  return true;
}

function selectCanvasElements(scene, input = {}) {
  const selector = input.selector || input.target || input;
  return activeElements(scene).filter((element) => matchesSelector(element, selector));
}

function touchElement(element) {
  element.version = Number(element.version || 0) + 1;
  element.versionNonce = Math.floor(Math.random() * 2_147_483_647);
  element.updated = Date.now();
}

function cloneElementsForDuplicate(elements, options = {}) {
  const offsetX = Number(options.offsetX ?? options.dx ?? 40);
  const offsetY = Number(options.offsetY ?? options.dy ?? 40);
  const prefix = options.prefix || `dup-${Date.now().toString(36)}`;
  const idMap = new Map();
  const groupMap = new Map();
  const nextId = (oldId, index) => {
    if (!idMap.has(oldId)) idMap.set(oldId, `${prefix}-${index}-${String(oldId || "element").slice(0, 10)}`);
    return idMap.get(oldId);
  };
  const nextGroupId = (oldId) => {
    if (!groupMap.has(oldId)) groupMap.set(oldId, `${prefix}-group-${groupMap.size + 1}`);
    return groupMap.get(oldId);
  };

  elements.forEach((element, index) => nextId(element.id, index));
  return elements.map((element, index) => {
    const next = JSON.parse(JSON.stringify(element));
    next.id = nextId(element.id, index);
    next.x = Number(next.x || 0) + offsetX;
    next.y = Number(next.y || 0) + offsetY;
    next.groupIds = Array.isArray(next.groupIds) ? next.groupIds.map(nextGroupId) : [];
    if (next.startBinding?.elementId && idMap.has(next.startBinding.elementId)) next.startBinding.elementId = idMap.get(next.startBinding.elementId);
    if (next.endBinding?.elementId && idMap.has(next.endBinding.elementId)) next.endBinding.elementId = idMap.get(next.endBinding.elementId);
    if (next.start?.id && idMap.has(next.start.id)) next.start.id = idMap.get(next.start.id);
    if (next.end?.id && idMap.has(next.end.id)) next.end.id = idMap.get(next.end.id);
    if (next.containerId && idMap.has(next.containerId)) next.containerId = idMap.get(next.containerId);
    if (Array.isArray(next.boundElements)) {
      next.boundElements = next.boundElements.map((boundElement) => ({
        ...boundElement,
        id: idMap.get(boundElement.id) || boundElement.id
      }));
    }
    next.customData = {
      ...(next.customData || {}),
      duplicatedFrom: element.id
    };
    touchElement(next);
    return next;
  });
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  await writeScene(scene, current);
  await pushLiveScene(scene, current, {
    ...input,
    source: "mcp-reveal",
    revision: `mcp-reveal-${Date.now()}-0`
  });

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
    await pushLiveScene(scene, current, {
      ...input,
      source: "mcp-reveal",
      revision: `mcp-reveal-${Date.now()}-${index + 1}`
    });
    appliedStages += 1;
    if (delayMs > 0 && index < stages.length - 1) {
      await sleep(delayMs);
    }
  }

  return {
    current,
    stages: appliedStages,
    deleted,
    delayMs
  };
}

function elementCenterForArrange(element) {
  const bounds = elementBounds(element);
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  };
}

function describeSceneText(scene, name, options = {}) {
  const summary = compactSummary(scene, name, { ...options, maxElements: options.maxElements || 160 });
  const lines = [
    `Scene: ${name}`,
    `Source: ${options.source || "file"}`,
    `Elements: ${activeElements(scene).length}`,
    `Bounds: ${JSON.stringify(summary.scene?.bounds || {})}`
  ];
  if (summary.texts?.length) {
    lines.push("Texts:");
    for (const text of summary.texts.slice(0, 24)) {
      lines.push(`- ${text.text || text.label || ""}`);
    }
  }
  if (summary.regions?.length) {
    lines.push("Regions:");
    for (const region of summary.regions.slice(0, 16)) {
      lines.push(`- ${region.label || region.id || "region"} at ${region.x},${region.y} ${region.width}x${region.height}`);
    }
  }
  if (summary.connections?.length) {
    lines.push("Connections:");
    for (const connection of summary.connections.slice(0, 24)) {
      lines.push(`- ${connection.from || "?"} -> ${connection.to || "?"}${connection.label ? ` (${connection.label})` : ""}`);
    }
  }
  if (summary.layoutIssues?.length) {
    lines.push("Layout issues:");
    for (const issue of summary.layoutIssues.slice(0, 12)) {
      lines.push(`- ${issue.severity || "warning"}: ${issue.message || issue.type}`);
    }
  }
  return lines.join("\n");
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
          updatedAt: options.live.updatedAt,
          revision: options.live.revision,
          clientId: options.live.clientId,
          source: options.live.source
        }
      : undefined
  };
}

export async function openOrCreateCanvas(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name || "codex-canvas.excalidraw");
  const created = !(await sceneExists(scene));
  if (created) {
    await writeScene(scene, createBlankScene({
      title: input.title,
      backgroundColor: input.backgroundColor
    }));
  }
  const current = await readCanvasScene(scene, input);
  return {
    ok: true,
    scene,
    created,
    path: scenePath(scene),
    browserUrl: browserUrl(scene, input.baseUrl),
    context: compactSummary(current.scene, scene, { ...input, source: current.source, live: current.live })
  };
}

export async function getCanvasContext(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
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

export async function queryCanvasElements(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  const current = await readCanvasScene(scene, input);
  const matches = selectCanvasElements(current.scene, input);
  const limit = Number(input.limit || 80);
  return {
    ok: true,
    scene,
    source: current.source,
    count: matches.length,
    elements: (input.includeRaw ? matches : matches.map(compactElement)).slice(0, limit),
    truncated: matches.length > limit
  };
}

export async function getCanvasElement(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  const current = await readCanvasScene(scene, input);
  const element = activeElements(current.scene).find((item) => item.id === input.id);
  if (!element) {
    throw new Error(`Element not found: ${input.id}`);
  }
  return {
    ok: true,
    scene,
    source: current.source,
    element: input.includeRaw ? element : compactElement(element)
  };
}

export async function applyCanvasPatch(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  const materializedLive = input.dryRun ? null : await materializeLiveScene(scene, input);
  const plan = input.plan || input.patch || input.operations || input.ops;
  const result = await patchSceneFile(scene, Array.isArray(plan) ? { ops: plan } : plan, {
    dryRun: Boolean(input.dryRun),
    snapshot: input.snapshot !== false,
    label: input.label || "before-mcp-patch",
    refreshConnectors: input.refreshConnectors !== false
  });
  const current = input.dryRun ? result.scene : await readScene(scene);
  if (!input.dryRun) await pushLiveScene(scene, current, input);
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
    context: compactSummary(current, scene, { ...input, source: "file" })
  };
}

export async function createCanvasView(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name || "codex-view.excalidraw");
  const parsedElements = parseElementInput(input);
  const restoreCheckpoint = parsedElements.find((element) => element?.type === "restoreCheckpoint");
  const deleteIds = deleteIdsFromPseudoElements(parsedElements);
  const cameraUpdates = cameraUpdatesFromElements(parsedElements);
  const mode = input.mode || (restoreCheckpoint ? "append" : "replace");
  const existed = await sceneExists(scene);
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
    context: compactSummary(current, scene, { ...input, source: input.dryRun ? "dry-run" : "file" })
  };
}

export async function batchCreateElements(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name || "codex-canvas.excalidraw");
  if (!(await sceneExists(scene))) {
    await writeScene(scene, createBlankScene({
      title: input.title,
      backgroundColor: input.backgroundColor
    }));
  } else if (!input.dryRun) {
    await materializeLiveScene(scene, input);
  }
  const ops = externalElementsToPatchOps(parseElementInput(input));
  if (!ops.length) {
    throw new Error("batch_create_elements did not contain drawable elements.");
  }
  const result = await patchSceneFile(scene, { ops }, {
    dryRun: Boolean(input.dryRun),
    snapshot: input.snapshot !== false,
    label: input.label || "before-batch-create-elements",
    refreshConnectors: input.refreshConnectors !== false
  });
  const current = input.dryRun ? result.scene : await readScene(scene);
  if (!input.dryRun) await pushLiveScene(scene, current, input);
  return {
    ok: true,
    scene,
    result,
    context: compactSummary(current, scene, { ...input, source: input.dryRun ? "dry-run" : "file" })
  };
}

export async function createCanvasFromMermaid(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name || "mermaid-diagram.excalidraw");
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
  if (!input.dryRun && (input.export || input.preview)) {
    await exportCanvas({
      ...input,
      scene,
      format: input.exportFormat || input.format || "png",
      materializeLive: false
    });
  }
  return {
    ok: true,
    scene,
    path: scenePath(scene),
    browserUrl: browserUrl(scene, input.baseUrl),
    snapshot,
    elementCount: activeElements(sceneData).length,
    context: compactSummary(sceneData, scene, { ...input, source: input.dryRun ? "dry-run" : "file" })
  };
}

function resolveExternalPath(filePath) {
  return path.resolve(process.cwd(), String(filePath || ""));
}

function sceneFromImportPayload(payload, input = {}) {
  if (payload?.type === "excalidraw" && Array.isArray(payload.elements)) {
    return {
      ...payload,
      appState: {
        ...(payload.appState || {}),
        codex: {
          ...(payload.appState?.codex || {}),
          importedAt: new Date().toISOString()
        }
      },
      files: payload.files || {}
    };
  }
  if (Array.isArray(payload)) {
    return createSceneFromElements(payload, {}, {
      backgroundColor: input.backgroundColor,
      codex: {
        generator: "import-elements",
        importedAt: new Date().toISOString()
      }
    });
  }
  if (payload?.elements && Array.isArray(payload.elements)) {
    return createSceneFromElements(payload.elements, payload.files || {}, {
      backgroundColor: input.backgroundColor,
      codex: {
        ...(payload.appState?.codex || {}),
        generator: "import-elements",
        importedAt: new Date().toISOString()
      }
    });
  }
  throw new Error("Imported data must be an Excalidraw scene, an element array, or an object with elements.");
}

async function readImportPayload(input = {}) {
  if (input.sceneData) return input.sceneData;
  if (input.data) return typeof input.data === "string" ? JSON.parse(input.data) : input.data;
  if (input.filePath || input.path) {
    const raw = await fs.readFile(resolveExternalPath(input.filePath || input.path), "utf8");
    return JSON.parse(raw);
  }
  throw new Error("import_scene requires filePath, data, or sceneData.");
}

export async function importCanvasScene(input = {}) {
  const payload = await readImportPayload(input);
  const importedScene = sceneFromImportPayload(payload, input);
  const scene = normalizeSceneName(
    input.scene ||
      input.name ||
      (input.filePath || input.path ? path.basename(input.filePath || input.path) : "imported-scene.excalidraw")
  );
  const existed = await sceneExists(scene);
  if (existed && !input.dryRun) {
    await materializeLiveScene(scene, input);
  }
  const snapshot = input.snapshot === false || !existed ? null : await createSnapshot(scene, {
    label: input.label || "before-import-scene"
  });
  let nextScene = importedScene;
  const mode = input.mode || "replace";
  if (mode === "merge" && existed) {
    const current = await readScene(scene);
    nextScene = {
      ...current,
      elements: [...(current.elements || []), ...(importedScene.elements || [])],
      files: {
        ...(current.files || {}),
        ...(importedScene.files || {})
      },
      appState: {
        ...(current.appState || {}),
        codex: {
          ...(current.appState?.codex || {}),
          lastImport: {
            mode,
            importedAt: new Date().toISOString(),
            importedElementCount: activeElements(importedScene).length
          }
        }
      }
    };
  }
  if (!input.dryRun) {
    await writeScene(scene, nextScene);
    await pushLiveScene(scene, nextScene, input);
  }
  return {
    ok: true,
    scene,
    mode,
    path: scenePath(scene),
    browserUrl: browserUrl(scene, input.baseUrl),
    snapshot,
    importedElementCount: activeElements(importedScene).length,
    activeElementCount: activeElements(nextScene).length,
    context: compactSummary(nextScene, scene, { ...input, source: input.dryRun ? "dry-run" : "file" })
  };
}

export async function exportCanvasSceneFile(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  if (input.materializeLive !== false) {
    await materializeLiveScene(scene, input);
  }
  const current = await readScene(scene);
  let outputPath = scenePath(scene);
  if (input.filePath || input.out || input.path) {
    outputPath = resolveExternalPath(input.filePath || input.out || input.path);
    if (!input.dryRun) {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
    }
  }
  const stat = input.dryRun
    ? null
    : await fs.stat(outputPath);
  return {
    ok: true,
    scene,
    path: outputPath,
    size: stat?.size,
    sceneData: input.includeScene || input.includeData ? current : undefined
  };
}

export async function updateCanvasElement(input = {}) {
  const { scene, name, id, elementId, selector, snapshot, dryRun, label, ...props } = input;
  const targetId = id || elementId;
  if (!targetId && !selector) throw new Error("update_element requires id, elementId, or selector.");
  return applyCanvasPatch({
    scene: scene || name,
    dryRun,
    snapshot,
    label: label || "before-update-element",
    operations: [{
      op: "update",
      target: selector || { id: targetId },
      text: props.text,
      props
    }]
  });
}

export async function deleteCanvasElement(input = {}) {
  const target = input.selector || (input.ids ? { ids: input.ids } : { id: input.id || input.elementId });
  if (!target.id && !target.ids && !target.all && !target.type && !target.textIncludes) {
    throw new Error("delete_element requires id, ids, or selector.");
  }
  return applyCanvasPatch({
    scene: input.scene || input.name,
    dryRun: input.dryRun,
    snapshot: input.snapshot,
    label: input.label || "before-delete-element",
    operations: [{ op: "delete", target }]
  });
}

export async function groupCanvasElements(input = {}) {
  const ids = input.elementIds || input.ids;
  const target = input.selector || (ids ? { ids } : undefined);
  return applyCanvasPatch({
    scene: input.scene || input.name,
    dryRun: input.dryRun,
    snapshot: input.snapshot,
    label: input.label || "before-group-elements",
    operations: [{
      op: "group",
      target,
      groupId: input.groupId
    }]
  });
}

export async function ungroupCanvasElements(input = {}) {
  const target = input.selector || (input.groupId ? { groupId: input.groupId } : undefined);
  return applyCanvasPatch({
    scene: input.scene || input.name,
    dryRun: input.dryRun,
    snapshot: input.snapshot,
    label: input.label || "before-ungroup-elements",
    operations: [{
      op: "ungroup",
      target,
      groupId: input.groupId
    }]
  });
}

export async function alignCanvasElements(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  if (!input.dryRun) await materializeLiveScene(scene, input);
  const current = await readScene(scene);
  const selector = input.selector || (input.elementIds || input.ids ? { ids: input.elementIds || input.ids } : null);
  if (!selector) throw new Error("align_elements requires elementIds, ids, or selector.");
  const selected = selectCanvasElements(current, { selector });
  if (selected.length < 2) throw new Error("align_elements needs at least 2 matched elements.");
  const alignment = input.alignment || "left";
  const bounds = selected.map(elementBounds);
  const centers = selected.map(elementCenterForArrange);
  const target = {
    left: Math.min(...bounds.map((item) => item.x)),
    right: Math.max(...bounds.map((item) => item.right)),
    top: Math.min(...bounds.map((item) => item.y)),
    bottom: Math.max(...bounds.map((item) => item.bottom)),
    center: centers.reduce((sum, item) => sum + item.x, 0) / centers.length,
    middle: centers.reduce((sum, item) => sum + item.y, 0) / centers.length
  };
  const snapshot = input.snapshot === false ? null : await createSnapshot(scene, {
    label: input.label || "before-align-elements"
  });
  for (const element of selected) {
    const itemBounds = elementBounds(element);
    if (alignment === "left") element.x = target.left;
    if (alignment === "right") element.x = target.right - itemBounds.width;
    if (alignment === "center") element.x = target.center - itemBounds.width / 2;
    if (alignment === "top") element.y = target.top;
    if (alignment === "bottom") element.y = target.bottom - itemBounds.height;
    if (alignment === "middle") element.y = target.middle - itemBounds.height / 2;
    touchElement(element);
  }
  if (!input.dryRun) await writeScene(scene, current);
  if (!input.dryRun) await pushLiveScene(scene, current, input);
  return {
    ok: true,
    scene,
    alignment,
    matched: selected.length,
    snapshot,
    elements: selected.map(compactElement),
    context: compactSummary(current, scene, input)
  };
}

export async function distributeCanvasElements(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  if (!input.dryRun) await materializeLiveScene(scene, input);
  const current = await readScene(scene);
  const selector = input.selector || (input.elementIds || input.ids ? { ids: input.elementIds || input.ids } : null);
  if (!selector) throw new Error("distribute_elements requires elementIds, ids, or selector.");
  const selected = selectCanvasElements(current, { selector });
  if (selected.length < 3) throw new Error("distribute_elements needs at least 3 matched elements.");
  const direction = input.direction || "horizontal";
  const axis = direction === "vertical" ? "y" : "x";
  const size = direction === "vertical" ? "height" : "width";
  const sorted = [...selected].sort((a, b) => elementBounds(a)[axis] - elementBounds(b)[axis]);
  const sortedBounds = sorted.map(elementBounds);
  const start = sortedBounds[0][axis];
  const end = sortedBounds.at(-1)[axis] + sortedBounds.at(-1)[size];
  const totalSize = sortedBounds.reduce((sum, item) => sum + item[size], 0);
  const gap = (end - start - totalSize) / (sorted.length - 1);
  const snapshot = input.snapshot === false ? null : await createSnapshot(scene, {
    label: input.label || "before-distribute-elements"
  });
  let cursor = start;
  for (const element of sorted) {
    element[axis] = cursor;
    cursor += elementBounds(element)[size] + gap;
    touchElement(element);
  }
  if (!input.dryRun) await writeScene(scene, current);
  if (!input.dryRun) await pushLiveScene(scene, current, input);
  return {
    ok: true,
    scene,
    direction,
    matched: sorted.length,
    gap: roundNumber(gap),
    snapshot,
    elements: sorted.map(compactElement),
    context: compactSummary(current, scene, input)
  };
}

export async function describeCanvasScene(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  const current = await readCanvasScene(scene, input);
  return {
    ok: true,
    scene,
    source: current.source,
    description: describeSceneText(current.scene, scene, { ...input, source: current.source }),
    context: compactSummary(current.scene, scene, { ...input, source: current.source, live: current.live })
  };
}

export async function restoreCanvasSnapshot(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
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
  if (!input.dryRun) await pushLiveScene(scene, current, input);
  return {
    ok: true,
    scene,
    beforeSnapshot,
    restored,
    context: compactSummary(current, scene, input)
  };
}

export async function clearCanvas(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  const currentRead = await readCanvasScene(scene, input);
  const current = currentRead.scene;
  const elements = activeElements(current);
  const snapshot = input.snapshot === false ? null : await createSnapshot(scene, {
    label: input.label || "before-mcp-clear"
  });
  for (const element of elements) {
    element.isDeleted = true;
    touchElement(element);
  }
  current.appState = {
    ...(current.appState || {}),
    codex: {
      ...(current.appState?.codex || {}),
      clearedAt: new Date().toISOString()
    }
  };
  if (!input.dryRun) await writeScene(scene, current);
  if (!input.dryRun) await pushLiveScene(scene, current, input);
  return {
    ok: true,
    scene,
    source: currentRead.source,
    cleared: elements.length,
    snapshot,
    context: compactSummary(current, scene, { ...input, source: "file" })
  };
}

export async function duplicateCanvasElements(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  if (!input.dryRun) await materializeLiveScene(scene, input);
  const current = await readScene(scene);
  const selected = selectCanvasElements(current, input);
  if (!selected.length) {
    throw new Error("duplicate_elements did not match any active elements.");
  }
  const snapshot = input.snapshot === false ? null : await createSnapshot(scene, {
    label: input.label || "before-mcp-duplicate"
  });
  const duplicates = cloneElementsForDuplicate(selected, input);
  current.elements.push(...duplicates);
  if (!input.dryRun) await writeScene(scene, current);
  if (!input.dryRun) await pushLiveScene(scene, current, input);
  return {
    ok: true,
    scene,
    duplicated: duplicates.length,
    snapshot,
    elements: duplicates.map(compactElement),
    context: compactSummary(current, scene, input)
  };
}

export async function setElementsLocked(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  if (!input.dryRun) await materializeLiveScene(scene, input);
  const current = await readScene(scene);
  const selected = selectCanvasElements(current, input);
  if (!selected.length) {
    throw new Error("lock/unlock did not match any active elements.");
  }
  const locked = input.locked !== false;
  const snapshot = input.snapshot === false ? null : await createSnapshot(scene, {
    label: input.label || (locked ? "before-mcp-lock" : "before-mcp-unlock")
  });
  for (const element of selected) {
    element.locked = locked;
    touchElement(element);
  }
  if (!input.dryRun) await writeScene(scene, current);
  if (!input.dryRun) await pushLiveScene(scene, current, input);
  return {
    ok: true,
    scene,
    locked,
    matched: selected.length,
    snapshot,
    elements: selected.map(compactElement)
  };
}

export async function arrangeCanvas(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  if (!input.dryRun) await materializeLiveScene(scene, input);
  const mode = input.mode || "polish";
  const operation = mode === "layout" ? layoutSceneFile : polishSceneFile;
  const result = await operation(scene, input.plan || input, {
    dryRun: Boolean(input.dryRun),
    snapshot: input.snapshot !== false,
    label: input.label || `before-mcp-${mode}`
  });
  const current = input.dryRun ? result.scene : await readScene(scene);
  if (!input.dryRun) await pushLiveScene(scene, current, input);
  return {
    ok: true,
    scene,
    mode,
    result,
    context: compactSummary(current, scene, input)
  };
}

export async function insertLibraryItem(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  const created = !(await sceneExists(scene));
  if (created) {
    await writeScene(scene, createBlankScene({ title: input.title }));
  } else if (!input.dryRun) {
    await materializeLiveScene(scene, input);
  }
  const library = await createLibraryItemElements(input.libraryId || input.library, input.item ?? input.itemSelector ?? 0, {
    x: input.x,
    y: input.y,
    scale: input.scale,
    prefix: input.prefix
  });
  const result = await patchSceneFile(scene, {
    ops: [{
      op: "add",
      elements: library.elements
    }]
  }, {
    snapshot: input.snapshot !== false,
    label: input.label || "before-mcp-library-insert"
  });
  const current = await readScene(scene);
  await pushLiveScene(scene, current, input);
  return {
    ok: true,
    scene,
    library: {
      library: library.library,
      item: library.item
    },
    result,
    context: compactSummary(current, scene, input)
  };
}

export async function searchCanvasLibraries(input = {}) {
  const query = input.query || input.q || "";
  return {
    ok: true,
    query,
    matches: await searchLibraryRegistry(query, {
      limit: Number(input.limit || 8)
    })
  };
}

export async function inspectCanvasLibrary(input = {}) {
  return {
    ok: true,
    library: await inspectRegisteredLibrary(input.libraryId || input.library || input.id)
  };
}

export async function exportCanvas(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
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
  return {
    ok: true,
    scene,
    exports
  };
}

export async function exportCanvasToExcalidrawUrl(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
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

export async function getCanvasScreenshot(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  if (input.materializeLive !== false) {
    await materializeLiveScene(scene, input);
  }
  const exportResult = await exportSceneAsset(scene, {
    format: "png",
    baseUrl: input.baseUrl || DEFAULT_WORKBENCH_URL
  });
  const data = await fs.readFile(exportResult.path, "base64");
  const text = JSON.stringify({
    ok: true,
    scene,
    screenshot: {
      path: exportResult.path,
      url: exportResult.url,
      size: exportResult.size,
      mimeType: "image/png",
      modifiedAt: exportResult.modifiedAt
    }
  }, null, 2);
  return {
    ok: true,
    scene,
    screenshot: {
      path: exportResult.path,
      url: exportResult.url,
      size: exportResult.size,
      mimeType: "image/png",
      modifiedAt: exportResult.modifiedAt
    },
    _mcpContent: [
      { type: "text", text },
      { type: "image", data, mimeType: "image/png" }
    ]
  };
}

export async function reviewCanvas(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
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

export async function setCanvasViewport(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  const currentRead = await readCanvasScene(scene, input);
  const current = currentRead.scene;
  const nextAppState = {
    ...(current.appState || {})
  };
  if (Number.isFinite(Number(input.scrollX))) nextAppState.scrollX = Number(input.scrollX);
  if (Number.isFinite(Number(input.scrollY))) nextAppState.scrollY = Number(input.scrollY);
  if (Number.isFinite(Number(input.zoom))) nextAppState.zoom = { value: Number(input.zoom) };
  if (input.viewBackgroundColor) nextAppState.viewBackgroundColor = input.viewBackgroundColor;
  nextAppState.codex = {
    ...(nextAppState.codex || {}),
    viewportUpdatedAt: new Date().toISOString()
  };
  current.appState = nextAppState;
  if (!input.dryRun) await writeScene(scene, current);
  if (!input.dryRun) await pushLiveScene(scene, current, input);
  return {
    ok: true,
    scene,
    viewport: {
      scrollX: current.appState.scrollX,
      scrollY: current.appState.scrollY,
      zoom: current.appState.zoom,
      viewBackgroundColor: current.appState.viewBackgroundColor
    }
  };
}

export async function snapshotCanvas(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
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

export async function inspectCanvas(input = {}) {
  const scene = normalizeSceneName(input.scene || input.name);
  if (input.materializeLive !== false) {
    await materializeLiveScene(scene, input);
  }
  return {
    ok: true,
    ...(await inspectSceneFile(scene, {
      from: input.from || "latest"
    }))
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

export async function getLiveCanvasStatus(input = {}) {
  return fetchLiveStatus(input);
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
  read_me: (input) => readDiagramGuide({ ...input, topic: input.topic || "all" }),
  create_view: createCanvasView,
  describe_scene: describeCanvasScene,
  create_from_mermaid: createCanvasFromMermaid,
  batch_create_elements: batchCreateElements,
  update_element: updateCanvasElement,
  delete_element: deleteCanvasElement,
  export_scene: exportCanvasSceneFile,
  import_scene: importCanvasScene,
  export_to_image: exportCanvas,
  export_to_excalidraw_url: exportCanvasToExcalidrawUrl,
  group_elements: groupCanvasElements,
  ungroup_elements: ungroupCanvasElements,
  align_elements: alignCanvasElements,
  distribute_elements: distributeCanvasElements,
  snapshot_scene: snapshotCanvas,
  restore_snapshot: restoreCanvasSnapshot,
  open_or_create_canvas: openOrCreateCanvas,
  get_canvas_context: getCanvasContext,
  query_elements: queryCanvasElements,
  get_element: getCanvasElement,
  apply_canvas_patch: applyCanvasPatch,
  clear_canvas: clearCanvas,
  duplicate_elements: duplicateCanvasElements,
  lock_elements: (input) => setElementsLocked({ ...input, locked: true }),
  unlock_elements: (input) => setElementsLocked({ ...input, locked: false }),
  arrange_canvas: arrangeCanvas,
  insert_library_item: insertLibraryItem,
  search_libraries: searchCanvasLibraries,
  inspect_library: inspectCanvasLibrary,
  export_canvas: exportCanvas,
  get_canvas_screenshot: getCanvasScreenshot,
  review_canvas: reviewCanvas,
  set_viewport: setCanvasViewport,
  snapshot_canvas: snapshotCanvas,
  inspect_canvas: inspectCanvas,
  list_canvases: listCanvases,
  get_live_canvas_status: getLiveCanvasStatus,
  get_runtime_config: getCanvasRuntime,
  read_diagram_guide: readDiagramGuide
};
