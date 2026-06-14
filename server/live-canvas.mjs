import { normalizeSceneName } from "./scene-workspace.mjs";

const liveScenes = new Map();
const liveSubscribers = new Map();
let liveRevisionCounter = 0;

function activeElementCount(scene) {
  return Array.isArray(scene?.elements)
    ? scene.elements.filter((element) => element && !element.isDeleted).length
    : 0;
}

function compactLiveEntry(name, entry, options = {}) {
  const sceneName = normalizeSceneName(name);
  return {
    ok: true,
    scene: sceneName,
    sessionId: entry.sessionId,
    live: true,
    updatedAt: entry.updatedAt,
    revision: entry.revision,
    clientRevision: entry.clientRevision,
    clientId: entry.clientId,
    activeElementCount: entry.activeElementCount,
    source: entry.source,
    previewUpdated: Boolean(entry.previewUpdated),
    conflict: false,
    subscriberCount: getLiveSubscriberCount(sceneName),
    browserReady: getLiveSubscriberCount(sceneName) > 0,
    sceneData: options.includeScene ? entry.scene : undefined
  };
}

function nextLiveRevision() {
  liveRevisionCounter += 1;
  return String(liveRevisionCounter);
}

function notifyLiveSubscribers(name, payload) {
  const sceneName = normalizeSceneName(name);
  const subscribers = liveSubscribers.get(sceneName);
  if (!subscribers?.size) return;
  for (const subscriber of subscribers) {
    subscriber(payload);
  }
}

export function updateLiveScene(name, scene, options = {}) {
  const sceneName = normalizeSceneName(name);
  const previous = liveScenes.get(sceneName);
  if (
    options.baseRevision &&
    previous?.revision &&
    String(options.baseRevision) !== String(previous.revision)
  ) {
    return {
      ok: false,
      scene: sceneName,
      sessionId: previous.sessionId,
      live: true,
      conflict: true,
      status: 409,
      message: "Live scene was updated after the caller's baseRevision.",
      baseRevision: String(options.baseRevision),
      currentRevision: previous.revision,
      updatedAt: previous.updatedAt,
      clientId: previous.clientId,
      source: previous.source,
      activeElementCount: previous.activeElementCount
    };
  }
  const entry = {
    scene,
    sessionId: previous?.sessionId || `live:${sceneName}`,
    updatedAt: new Date().toISOString(),
    revision: nextLiveRevision(),
    clientRevision: options.revision ? String(options.revision) : undefined,
    clientId: options.clientId || "workbench",
    source: options.source || "workbench",
    previewUpdated: Boolean(options.previewUpdated),
    activeElementCount: activeElementCount(scene)
  };
  liveScenes.set(sceneName, entry);
  const payload = compactLiveEntry(sceneName, entry);
  notifyLiveSubscribers(sceneName, payload);
  return payload;
}

export function getLiveScene(name, options = {}) {
  const sceneName = normalizeSceneName(name);
  const entry = liveScenes.get(sceneName);
  if (!entry) return null;
  return compactLiveEntry(sceneName, entry, options);
}

export function listLiveScenes() {
  return [...liveScenes.entries()].map(([name, entry]) => compactLiveEntry(name, entry));
}

export function getLiveSubscriberCount(name) {
  const sceneName = normalizeSceneName(name);
  return liveSubscribers.get(sceneName)?.size || 0;
}

export function getLiveSceneStatus(name, options = {}) {
  const sceneName = normalizeSceneName(name);
  const entry = liveScenes.get(sceneName);
  const subscriberCount = getLiveSubscriberCount(sceneName);
  if (!entry) {
    return {
      ok: true,
      scene: sceneName,
      live: false,
      browserReady: subscriberCount > 0,
      subscriberCount,
      sceneData: undefined
    };
  }
  return compactLiveEntry(sceneName, entry, options);
}

export function clearLiveScene(name) {
  const sceneName = normalizeSceneName(name);
  const deleted = liveScenes.delete(sceneName);
  if (deleted) {
    notifyLiveSubscribers(sceneName, {
      ok: true,
      scene: sceneName,
      sessionId: `live:${sceneName}`,
      live: false,
      deleted: true,
      updatedAt: new Date().toISOString(),
      revision: nextLiveRevision()
    });
  }
  return deleted;
}

export function subscribeLiveScene(name, subscriber) {
  const sceneName = normalizeSceneName(name);
  if (!liveSubscribers.has(sceneName)) {
    liveSubscribers.set(sceneName, new Set());
  }
  const subscribers = liveSubscribers.get(sceneName);
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      liveSubscribers.delete(sceneName);
    }
  };
}
