import { webcrypto, createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { defaultCanvasBackgroundColor } from "./config.mjs";

const DEFAULT_UPLOAD_ENDPOINT = "https://json.excalidraw.com/api/v2/post/";
const ENCODING_METADATA = {
  version: 2,
  compression: "pako@1",
  encryption: "AES-GCM"
};
const CONCAT_BUFFERS_VERSION = 1;

function activeElements(scene, options = {}) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  return options.includeDeleted ? elements : elements.filter((element) => element && !element.isDeleted);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function randomSeed() {
  return Math.floor(Math.random() * 2_147_483_647);
}

function nextIndex(index) {
  return `a${index}`;
}

function elementLabelText(element = {}) {
  if (typeof element.text === "string" && element.type !== "text") return element.text;
  if (typeof element.label === "string") return element.label;
  if (typeof element.label?.text === "string") return element.label.text;
  return "";
}

function pointTuple(point) {
  if (Array.isArray(point)) return [Number(point[0] || 0), Number(point[1] || 0)];
  return [Number(point?.x || 0), Number(point?.y || 0)];
}

function arrowLabelPosition(element, text) {
  const points = Array.isArray(element.points) && element.points.length
    ? element.points.map(pointTuple)
    : [[0, 0], [Number(element.width || 120), Number(element.height || 0)]];
  const last = points.at(-1) || [120, 0];
  const labelWidth = Math.max(80, String(text).length * 10);
  return {
    x: Number(element.x || 0) + last[0] / 2 - labelWidth / 2,
    y: Number(element.y || 0) + last[1] / 2 - 14,
    width: labelWidth,
    height: 28
  };
}

function shapeLabelPosition(element, text) {
  const width = Math.max(80, Number(element.width || 160) - 24);
  const height = Math.max(24, Math.min(48, Number(element.height || 70) - 16));
  return {
    x: Number(element.x || 0) + 12,
    y: Number(element.y || 0) + Math.max(8, (Number(element.height || 70) - height) / 2),
    width: Math.max(width, String(text).length * 8),
    height
  };
}

function makeTextElement(parent, text, index) {
  const isConnector = parent.type === "arrow" || parent.type === "line";
  const position = isConnector ? arrowLabelPosition(parent, text) : shapeLabelPosition(parent, text);
  return {
    id: `${parent.id || `element-${index}`}-label`,
    type: "text",
    x: position.x,
    y: position.y,
    width: position.width,
    height: position.height,
    angle: 0,
    strokeColor: isConnector ? "#1e1e1e" : parent.strokeColor || "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: parent.roughness ?? 1,
    opacity: parent.opacity ?? 100,
    groupIds: Array.isArray(parent.groupIds) ? parent.groupIds : [],
    frameId: parent.frameId ?? null,
    roundness: null,
    seed: randomSeed(),
    version: 1,
    versionNonce: randomSeed(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    text,
    originalText: text,
    fontSize: isConnector ? 14 : parent.fontSize || 16,
    fontFamily: parent.fontFamily || 2,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: parent.id,
    lineHeight: 1.25,
    index: nextIndex(index),
    autoResize: true
  };
}

function sanitizeAppState(appState = {}) {
  const next = {
    viewBackgroundColor: appState.viewBackgroundColor || defaultCanvasBackgroundColor,
    gridSize: appState.gridSize ?? null
  };
  if (Number.isFinite(Number(appState.scrollX))) next.scrollX = Number(appState.scrollX);
  if (Number.isFinite(Number(appState.scrollY))) next.scrollY = Number(appState.scrollY);
  if (appState.zoom?.value !== undefined) next.zoom = { value: Number(appState.zoom.value) };
  return next;
}

function sanitizeElement(element, index, options = {}) {
  const next = cloneJson(element);
  delete next.label;
  delete next.start;
  delete next.end;
  delete next.from;
  delete next.to;
  delete next.source;
  delete next.target;
  if (next.type !== "text") {
    delete next.text;
    delete next.originalText;
  }
  if (!options.includeCustomData) {
    delete next.customData;
  }
  next.id = next.id || `share-${index}`;
  next.angle = next.angle ?? 0;
  next.strokeColor = next.strokeColor || "#1e1e1e";
  next.backgroundColor = next.backgroundColor ?? "transparent";
  next.fillStyle = next.fillStyle || "solid";
  next.strokeWidth = next.strokeWidth ?? 2;
  next.strokeStyle = next.strokeStyle || "solid";
  next.roughness = next.roughness ?? 1;
  next.opacity = next.opacity ?? 100;
  next.groupIds = Array.isArray(next.groupIds) ? next.groupIds : [];
  next.frameId = next.frameId ?? null;
  next.seed = next.seed ?? randomSeed();
  next.version = next.version ?? 1;
  next.versionNonce = next.versionNonce ?? randomSeed();
  next.isDeleted = Boolean(next.isDeleted);
  next.boundElements = Array.isArray(next.boundElements) ? next.boundElements : [];
  next.updated = next.updated ?? Date.now();
  next.link = next.link ?? null;
  next.locked = Boolean(next.locked);
  next.index = next.index || nextIndex(index);
  if (next.type === "arrow" || next.type === "line") {
    next.points = Array.isArray(next.points) && next.points.length ? next.points.map(pointTuple) : [[0, 0], [100, 0]];
    next.startBinding = next.startBinding ? { ...next.startBinding, fixedPoint: next.startBinding.fixedPoint ?? null } : null;
    next.endBinding = next.endBinding ? { ...next.endBinding, fixedPoint: next.endBinding.fixedPoint ?? null } : null;
    next.lastCommittedPoint = null;
    next.startArrowhead = next.startArrowhead ?? null;
    next.endArrowhead = next.endArrowhead ?? (next.type === "arrow" ? "arrow" : null);
  }
  if (next.type === "text") {
    next.text = next.text ?? "";
    next.originalText = next.originalText ?? next.text;
    next.fontSize = next.fontSize ?? 20;
    next.fontFamily = next.fontFamily ?? 2;
    next.textAlign = next.textAlign || "left";
    next.verticalAlign = next.verticalAlign || "top";
    next.lineHeight = next.lineHeight ?? 1.25;
    next.containerId = next.containerId ?? null;
    next.autoResize = next.autoResize ?? true;
  }
  return next;
}

function patchArrowBoundElements(elements) {
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const element of elements) {
    if (element.type !== "arrow" && element.type !== "line") continue;
    for (const binding of [element.startBinding, element.endBinding]) {
      const boundElement = byId.get(binding?.elementId);
      if (!boundElement) continue;
      const bound = Array.isArray(boundElement.boundElements) ? boundElement.boundElements : [];
      if (!bound.some((item) => item.id === element.id)) {
        boundElement.boundElements = [...bound, { type: element.type, id: element.id }];
      }
    }
  }
}

export function sanitizeSceneForExcalidrawShare(scene, options = {}) {
  const sourceElements = activeElements(scene, options);
  const existingContainerText = new Set(
    sourceElements
      .filter((element) => element?.type === "text" && element.containerId)
      .map((element) => element.containerId)
  );
  let index = 0;
  const elements = [];
  const generatedText = [];

  for (const sourceElement of sourceElements) {
    const labelText = elementLabelText(sourceElement);
    const element = sanitizeElement(sourceElement, index++, options);
    if (labelText && !existingContainerText.has(element.id)) {
      const text = makeTextElement(element, labelText, index++);
      generatedText.push(text);
      element.boundElements = [
        ...(Array.isArray(element.boundElements) ? element.boundElements : []),
        { type: "text", id: text.id }
      ];
    }
    elements.push(element);
  }

  elements.push(...generatedText);
  patchArrowBoundElements(elements);

  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements,
    appState: sanitizeAppState(scene?.appState || {}),
    files: options.includeFiles === false ? {} : (scene?.files || {})
  };
}

function concatBuffers(...buffers) {
  let totalLength = 4;
  for (const buffer of buffers) totalLength += 4 + buffer.length;
  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, CONCAT_BUFFERS_VERSION);
  let offset = 4;
  for (const buffer of buffers) {
    view.setUint32(offset, buffer.length);
    offset += 4;
    out.set(buffer, offset);
    offset += buffer.length;
  }
  return out;
}

export async function createExcalidrawSharePayload(scene, options = {}) {
  const sanitizedScene = sanitizeSceneForExcalidrawShare(scene, options);
  const elementCount = activeElements(sanitizedScene, { includeDeleted: false }).length;
  if (!elementCount) {
    throw new Error("Canvas is empty; nothing to share.");
  }

  const encoder = new TextEncoder();
  const sceneBytes = encoder.encode(JSON.stringify(sanitizedScene));
  const metadataBytes = encoder.encode("{}");
  const innerData = concatBuffers(metadataBytes, sceneBytes);
  const compressed = deflateSync(Buffer.from(innerData));
  const key = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, true, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed);
  const encryptedBytes = new Uint8Array(encrypted);
  const encodingBytes = encoder.encode(JSON.stringify(ENCODING_METADATA));
  const payload = concatBuffers(encodingBytes, iv, encryptedBytes);
  const jwk = await webcrypto.subtle.exportKey("jwk", key);

  return {
    payload,
    key: jwk.k,
    elementCount,
    filesCount: Object.keys(sanitizedScene.files || {}).length,
    sceneSize: sceneBytes.length,
    compressedSize: compressed.length,
    encryptedSize: encryptedBytes.length,
    payloadSize: payload.length,
    payloadSha256: createHash("sha256").update(payload).digest("hex"),
    sanitizedScene
  };
}

export async function exportSceneToExcalidrawUrl(scene, options = {}) {
  const endpoint = options.endpoint || process.env.EXCALIDRAW_CODEX_SHARE_ENDPOINT || DEFAULT_UPLOAD_ENDPOINT;
  const payload = await createExcalidrawSharePayload(scene, options);
  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      uploadEndpoint: endpoint,
      elementCount: payload.elementCount,
      filesCount: payload.filesCount,
      sceneSize: payload.sceneSize,
      compressedSize: payload.compressedSize,
      encryptedSize: payload.encryptedSize,
      payloadSize: payload.payloadSize,
      payloadSha256: payload.payloadSha256
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    body: Buffer.from(payload.payload)
  });
  if (!response.ok) {
    throw new Error(`Upload to excalidraw.com failed: ${response.status} ${response.statusText}`);
  }
  const uploaded = await response.json();
  if (!uploaded?.id) {
    throw new Error("Upload to excalidraw.com did not return an id.");
  }

  return {
    ok: true,
    dryRun: false,
    url: `https://excalidraw.com/#json=${uploaded.id},${payload.key}`,
    id: uploaded.id,
    uploadEndpoint: endpoint,
    elementCount: payload.elementCount,
    filesCount: payload.filesCount,
    sceneSize: payload.sceneSize,
    compressedSize: payload.compressedSize,
    encryptedSize: payload.encryptedSize,
    payloadSize: payload.payloadSize,
    payloadSha256: payload.payloadSha256
  };
}
