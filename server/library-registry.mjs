import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, "..");
export const librariesDir = path.join(projectRoot, "libraries");
export const registryPath = path.join(librariesDir, "registry.json");
const OFFICIAL_LIBRARY_INDEX_URL = "https://libraries.excalidraw.com/libraries.json";
const OFFICIAL_LIBRARY_BASE_URL = "https://libraries.excalidraw.com/libraries";
const DEFAULT_KEYWORD_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "into",
  "such",
  "as",
  "of",
  "in",
  "to",
  "a",
  "an",
  "is",
  "are",
  "etc",
  "library",
  "collection",
  "contains"
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value, fallback = "library") {
  const safe = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return safe || fallback;
}

function officialDirectoryId(source) {
  return String(source || "")
    .toLowerCase()
    .replace(/\/|\.excalidrawlib$/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function remoteUrl(relativePath) {
  return `${OFFICIAL_LIBRARY_BASE_URL}/${relativePath}`;
}

function queryTokens(query) {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  return [...new Set(normalized.split(" ").filter((token) => token.length >= 2))];
}

function isAsciiToken(value) {
  return /^[a-z0-9]+$/.test(value);
}

function activeLibraryItems(libraryFile) {
  if (Array.isArray(libraryFile?.libraryItems)) return libraryFile.libraryItems;
  if (Array.isArray(libraryFile?.library)) {
    return libraryFile.library.map((item) => ({ elements: item }));
  }
  return [];
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
    right: Math.max(x, right),
    bottom: Math.max(y, bottom),
    width: Math.abs(width),
    height: Math.abs(height)
  };
}

function elementsBounds(elements) {
  const bounds = elements.map(elementBounds);
  return {
    x: Math.min(...bounds.map((bound) => bound.x)),
    y: Math.min(...bounds.map((bound) => bound.y)),
    right: Math.max(...bounds.map((bound) => bound.right)),
    bottom: Math.max(...bounds.map((bound) => bound.bottom))
  };
}

function registryLibraryPath(library) {
  return path.resolve(projectRoot, library.path);
}

function compactLibrary(library, extra = {}) {
  return {
    id: library.id,
    name: library.name,
    author: library.author,
    description: library.description,
    path: library.path,
    preview: library.preview,
    license: library.license,
    categories: library.categories || [],
    keywords: library.keywords || [],
    useWhen: library.useWhen || [],
    avoidWhen: library.avoidWhen || [],
    ...extra
  };
}

async function readRegistry() {
  const raw = await fs.readFile(registryPath, "utf8");
  const registry = JSON.parse(raw);
  return {
    ...registry,
    libraries: Array.isArray(registry.libraries) ? registry.libraries : []
  };
}

async function writeRegistry(registry) {
  await fs.mkdir(librariesDir, { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

async function readLibraryFile(library) {
  const raw = await fs.readFile(registryLibraryPath(library), "utf8");
  return JSON.parse(raw);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function downloadFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download ${url}: ${response.status} ${response.statusText}`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await pipeline(response.body, createWriteStream(filePath));
}

function remoteLibraryRecord(library) {
  const authors = Array.isArray(library.authors) ? library.authors : [];
  const source = String(library.source || "");
  return {
    id: library.id || officialDirectoryId(source),
    name: library.name,
    authors,
    author: authors.map((author) => author.name).filter(Boolean).join(", ") || "",
    description: library.description || "",
    source,
    preview: library.preview || "",
    remoteSource: remoteUrl(source),
    remotePreview: library.preview ? remoteUrl(library.preview) : "",
    created: library.created,
    updated: library.updated,
    version: library.version,
    itemNames: Array.isArray(library.itemNames) ? library.itemNames : []
  };
}

function scoreRemoteLibrary(library, query) {
  const record = remoteLibraryRecord(library);
  const normalizedQuery = normalizeText(query);
  const tokens = queryTokens(query);
  if (!normalizedQuery || !tokens.length) {
    return { score: 0, reasons: [] };
  }
  const fields = [
    { name: "name", weight: 8, values: [record.name] },
    { name: "author", weight: 5, values: [record.author] },
    { name: "description", weight: 4, values: [record.description] },
    { name: "items", weight: 3, values: record.itemNames },
    { name: "source", weight: 2, values: [record.source, record.id] }
  ];
  let score = 0;
  const reasons = [];
  for (const field of fields) {
    const haystack = normalizeText(field.values.join(" "));
    const haystackTokens = new Set(haystack.split(" ").filter(Boolean));
    if (!haystack) continue;
    if (haystack.includes(normalizedQuery)) {
      score += field.weight * 3;
      reasons.push(`${field.name}:phrase`);
    }
    for (const value of field.values) {
      const normalizedValue = normalizeText(value);
      if (normalizedValue.length >= 2 && normalizedQuery.includes(normalizedValue)) {
        score += field.weight * 2;
        reasons.push(`${field.name}:reverse:${normalizedValue}`);
      }
    }
    for (const token of tokens) {
      const matched = isAsciiToken(token) && token.length <= 3
        ? haystackTokens.has(token)
        : haystack.includes(token);
      if (matched) {
        score += field.weight;
        reasons.push(`${field.name}:${token}`);
      }
    }
  }
  return {
    score,
    reasons: [...new Set(reasons)].slice(0, 10)
  };
}

async function fetchOfficialLibraries() {
  const libraries = await fetchJson(OFFICIAL_LIBRARY_INDEX_URL);
  return libraries.map((library) => ({
    ...library,
    id: officialDirectoryId(library.source)
  }));
}

function matchRemoteCandidates(libraries, selector) {
  const normalizedSelector = normalizeText(selector);
  return libraries
    .map(remoteLibraryRecord)
    .filter((library) => {
      const exactValues = [library.id, library.source, library.name].map(normalizeText);
      if (exactValues.includes(normalizedSelector)) return true;
      return [library.id, library.source, library.name, library.author].some((value) => normalizeText(value).includes(normalizedSelector));
    });
}

function defaultKeywords(remoteLibrary) {
  const joined = [
    remoteLibrary.name,
    remoteLibrary.description,
    ...(remoteLibrary.itemNames || []).slice(0, 24)
  ].join(" ");
  return queryTokens(joined)
    .filter((token) => !DEFAULT_KEYWORD_STOPWORDS.has(token))
    .slice(0, 32);
}

function previewExtension(remoteLibrary) {
  const ext = path.extname(remoteLibrary.preview || "").toLowerCase();
  return ext || ".png";
}

function registryEntryFromRemote(remoteLibrary, options = {}) {
  const localId = slug(options.id || remoteLibrary.name || remoteLibrary.id);
  const sourcePath = remoteLibrary.source;
  const sourceDir = path.dirname(sourcePath);
  const sourceName = path.basename(sourcePath);
  const previewPath = `libraries/previews/${localId}${previewExtension(remoteLibrary)}`;
  return {
    id: localId,
    name: remoteLibrary.name,
    author: remoteLibrary.author,
    description: remoteLibrary.description || "",
    path: `libraries/vendor/${sourceDir}/${sourceName}`,
    preview: previewPath,
    remoteSource: remoteLibrary.remoteSource,
    remotePreview: remoteLibrary.remotePreview,
    license: "MIT",
    categories: options.categories || [],
    keywords: options.keywords?.length ? options.keywords : defaultKeywords(remoteLibrary),
    useWhen: options.useWhen?.length
      ? options.useWhen
      : [`Use when the user request matches "${remoteLibrary.name}" or its component names.`],
    avoidWhen: options.avoidWhen || []
  };
}

function scoreLibrary(library, query) {
  const normalizedQuery = normalizeText(query);
  const tokens = queryTokens(query);
  if (!normalizedQuery || !tokens.length) {
    return { score: 0, reasons: [] };
  }

  const fields = [
    { name: "name", weight: 8, values: [library.name] },
    { name: "categories", weight: 5, values: library.categories || [] },
    { name: "keywords", weight: 4, values: library.keywords || [] },
    { name: "useWhen", weight: 3, values: library.useWhen || [] },
    { name: "description", weight: 2, values: [library.description] }
  ];

  let score = 0;
  const reasons = [];
  for (const field of fields) {
    const haystack = normalizeText(field.values.join(" "));
    const haystackTokens = new Set(haystack.split(" ").filter(Boolean));
    if (!haystack) continue;
    if (haystack.includes(normalizedQuery)) {
      score += field.weight * 3;
      reasons.push(`${field.name}:phrase`);
    }
    for (const value of field.values) {
      const normalizedValue = normalizeText(value);
      if (normalizedValue.length >= 2 && normalizedQuery.includes(normalizedValue)) {
        score += field.weight * 2;
        reasons.push(`${field.name}:reverse:${normalizedValue}`);
      }
    }
    for (const token of tokens) {
      const matched = isAsciiToken(token) && token.length <= 3
        ? haystackTokens.has(token)
        : haystack.includes(token);
      if (matched) {
        score += field.weight;
        reasons.push(`${field.name}:${token}`);
      }
    }
  }

  return {
    score,
    reasons: [...new Set(reasons)].slice(0, 10)
  };
}

export async function listLibraryRegistry(options = {}) {
  const registry = await readRegistry();
  if (!options.includeStats) {
    return {
      version: registry.version,
      source: registry.source,
      principles: registry.principles || [],
      libraries: registry.libraries.map((library) => compactLibrary(library))
    };
  }

  const libraries = await Promise.all(
    registry.libraries.map(async (library) => {
      try {
        const libraryFile = await readLibraryFile(library);
        const items = activeLibraryItems(libraryFile);
        return compactLibrary(library, {
          ok: true,
          version: libraryFile.version,
          itemCount: items.length,
          fileSize: (await fs.stat(registryLibraryPath(library))).size
        });
      } catch (error) {
        return compactLibrary(library, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    })
  );

  return {
    version: registry.version,
    source: registry.source,
    principles: registry.principles || [],
    libraries
  };
}

export async function searchOfficialLibraries(query, options = {}) {
  const libraries = await fetchOfficialLibraries();
  const limit = Number(options.limit || 10);
  const matches = libraries
    .map((library) => {
      const match = scoreRemoteLibrary(library, query);
      return {
        ...remoteLibraryRecord(library),
        score: match.score,
        reasons: match.reasons
      };
    })
    .filter((library) => library.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
  return {
    source: OFFICIAL_LIBRARY_INDEX_URL,
    count: matches.length,
    libraries: matches
  };
}

export async function installOfficialLibrary(selector, options = {}) {
  const libraries = await fetchOfficialLibraries();
  const candidates = matchRemoteCandidates(libraries, selector);
  if (!candidates.length) {
    throw new Error(`No official Excalidraw library matched: ${selector}`);
  }
  const exactSelector = normalizeText(selector);
  const exactCandidates = candidates.filter((library) =>
    [library.id, library.source, library.name].map(normalizeText).includes(exactSelector)
  );
  const resolved = exactCandidates.length === 1 ? exactCandidates[0] : candidates.length === 1 ? candidates[0] : null;
  if (!resolved) {
    const suggestions = candidates.slice(0, 8).map((library) => `${library.id} (${library.name})`).join(", ");
    throw new Error(`Ambiguous library selector "${selector}". Use an exact id or source. Matches: ${suggestions}`);
  }

  const registry = await readRegistry();
  const entry = registryEntryFromRemote(resolved, options);
  const existingIndex = registry.libraries.findIndex((library) => library.id === entry.id || library.remoteSource === entry.remoteSource);
  if (existingIndex >= 0 && !options.replace && !options.dryRun) {
    throw new Error(`Library already installed: ${registry.libraries[existingIndex].id}. Use --replace to reinstall.`);
  }

  if (options.dryRun) {
    return {
      dryRun: true,
      library: entry,
      remote: resolved,
      action: existingIndex >= 0 ? "already-installed" : "install"
    };
  }

  const sourcePath = path.resolve(projectRoot, entry.path);
  const previewPath = path.resolve(projectRoot, entry.preview);
  await downloadFile(resolved.remoteSource, sourcePath);
  if (resolved.remotePreview) {
    await downloadFile(resolved.remotePreview, previewPath);
  }

  const libraryFile = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  const itemCount = activeLibraryItems(libraryFile).length;
  if (libraryFile.type !== "excalidrawlib" || itemCount === 0) {
    throw new Error(`Downloaded file is not a usable Excalidraw library: ${resolved.remoteSource}`);
  }

  if (existingIndex >= 0) {
    registry.libraries[existingIndex] = entry;
  } else {
    registry.libraries.push(entry);
  }
  registry.libraries.sort((a, b) => a.id.localeCompare(b.id));
  await writeRegistry(registry);

  return {
    dryRun: false,
    action: existingIndex >= 0 ? "replace" : "install",
    library: entry,
    remote: resolved,
    itemCount,
    registryPath
  };
}

export async function searchLibraryRegistry(query, options = {}) {
  const registry = await readRegistry();
  const limit = Number(options.limit || registry.libraries.length || 10);
  return registry.libraries
    .map((library) => {
      const match = scoreLibrary(library, query);
      return compactLibrary(library, match);
    })
    .filter((library) => library.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export async function selectLibrariesForBrief(brief, options = {}) {
  const matches = await searchLibraryRegistry(brief, {
    limit: Number(options.limit || 3)
  });
  const minScore = Number(options.minScore || 4);
  return matches.filter((library) => library.score >= minScore);
}

export async function listInstalledLibraryItems() {
  const registry = await readRegistry();
  const librarySummaries = [];
  const libraryItems = [];

  for (const library of registry.libraries) {
    const libraryFile = await readLibraryFile(library);
    const items = activeLibraryItems(libraryFile);
    let usableCount = 0;

    items.forEach((item, index) => {
      const elements = Array.isArray(item.elements)
        ? item.elements.filter((element) => element && !element.isDeleted)
        : [];
      if (!elements.length) return;

      usableCount += 1;
      libraryItems.push({
        ...item,
        id: item.id || `${library.id}-${index + 1}`,
        status: item.status || "published",
        created: Number(item.created || 0),
        name: item.name || `${library.name} ${index + 1}`,
        elements
      });
    });

    librarySummaries.push(compactLibrary(library, {
      itemCount: items.length,
      usableItemCount: usableCount
    }));
  }

  return {
    version: registry.version,
    libraryCount: librarySummaries.length,
    itemCount: libraryItems.length,
    libraries: librarySummaries,
    libraryItems
  };
}

export async function inspectRegisteredLibrary(id) {
  const registry = await readRegistry();
  const library = registry.libraries.find((item) => item.id === id || item.name.toLowerCase() === String(id).toLowerCase());
  if (!library) {
    throw new Error(`Unknown library: ${id}`);
  }
  const libraryFile = await readLibraryFile(library);
  const items = activeLibraryItems(libraryFile);
  return compactLibrary(library, {
    version: libraryFile.version,
    source: libraryFile.source,
    itemCount: items.length,
    items: items.slice(0, 80).map((item, index) => ({
      index,
      name: item.name || `item-${index + 1}`,
      elementCount: Array.isArray(item.elements) ? item.elements.length : 0
    }))
  });
}

export async function createLibraryItemElements(id, itemSelector = 0, options = {}) {
  const registry = await readRegistry();
  const library = registry.libraries.find((item) => item.id === id || item.name.toLowerCase() === String(id).toLowerCase());
  if (!library) {
    throw new Error(`Unknown library: ${id}`);
  }
  const libraryFile = await readLibraryFile(library);
  const items = activeLibraryItems(libraryFile);
  const selectorText = String(itemSelector ?? "0").trim();
  const itemIndex = Number.isInteger(Number(selectorText))
    ? Number(selectorText)
    : items.findIndex((item) => normalizeText(item.name).includes(normalizeText(selectorText)));
  if (itemIndex < 0 || itemIndex >= items.length) {
    throw new Error(`Library item not found: ${selectorText}`);
  }

  const item = items[itemIndex];
  const sourceElements = (item.elements || []).filter((element) => element && !element.isDeleted);
  if (!sourceElements.length) {
    throw new Error(`Library item has no active elements: ${selectorText}`);
  }

  const bounds = elementsBounds(sourceElements);
  const scale = Number(options.scale || 1);
  const targetX = Number(options.x ?? 80);
  const targetY = Number(options.y ?? 80);
  const prefix = options.prefix || `lib-${library.id}-${itemIndex}-${Date.now().toString(36)}`;
  const idMap = new Map();
  const groupMap = new Map();
  const nextId = (oldId, index) => {
    if (!idMap.has(oldId)) {
      idMap.set(oldId, `${prefix}-${index}-${String(oldId || "item").slice(0, 8)}`);
    }
    return idMap.get(oldId);
  };
  const nextGroupId = (oldId) => {
    if (!groupMap.has(oldId)) {
      groupMap.set(oldId, `${prefix}-group-${groupMap.size + 1}`);
    }
    return groupMap.get(oldId);
  };

  sourceElements.forEach((element, index) => {
    nextId(element.id, index);
  });

  const cloned = sourceElements.map((element, index) => {
    const next = JSON.parse(JSON.stringify(element));
    next.id = nextId(element.id, index);
    next.groupIds = Array.isArray(element.groupIds) ? element.groupIds.map(nextGroupId) : [];
    next.x = targetX + (Number(element.x || 0) - bounds.x) * scale;
    next.y = targetY + (Number(element.y || 0) - bounds.y) * scale;
    if (Number.isFinite(Number(next.width))) next.width = Number(next.width) * scale;
    if (Number.isFinite(Number(next.height))) next.height = Number(next.height) * scale;
    if (Number.isFinite(Number(next.fontSize))) next.fontSize = Number(next.fontSize) * scale;
    if (Array.isArray(next.points)) {
      next.points = next.points.map(([x, y]) => [Number(x || 0) * scale, Number(y || 0) * scale]);
    }
    if (next.startBinding?.elementId && idMap.has(next.startBinding.elementId)) {
      next.startBinding.elementId = idMap.get(next.startBinding.elementId);
    }
    if (next.endBinding?.elementId && idMap.has(next.endBinding.elementId)) {
      next.endBinding.elementId = idMap.get(next.endBinding.elementId);
    }
    if (next.start?.id && idMap.has(next.start.id)) {
      next.start.id = idMap.get(next.start.id);
    }
    if (next.end?.id && idMap.has(next.end.id)) {
      next.end.id = idMap.get(next.end.id);
    }
    if (next.containerId && idMap.has(next.containerId)) {
      next.containerId = idMap.get(next.containerId);
    }
    if (Array.isArray(next.boundElements)) {
      next.boundElements = next.boundElements.map((boundElement) => ({
        ...boundElement,
        id: idMap.get(boundElement.id) || boundElement.id
      }));
    }
    next.version = 1;
    next.versionNonce = Math.floor(Math.random() * 2_147_483_647);
    next.updated = Date.now();
    next.customData = {
      ...(next.customData || {}),
      codexLibrary: library.id,
      codexLibraryItemIndex: itemIndex,
      codexLibraryItemName: item.name || `item-${itemIndex + 1}`
    };
    return next;
  });

  return {
    library: compactLibrary(library),
    item: {
      index: itemIndex,
      name: item.name || `item-${itemIndex + 1}`,
      elementCount: cloned.length
    },
    elements: cloned
  };
}

export async function validateLibraryRegistry() {
  const registry = await readRegistry();
  const results = [];
  for (const library of registry.libraries) {
    try {
      const libraryFile = await readLibraryFile(library);
      const items = activeLibraryItems(libraryFile);
      const previewPath = path.resolve(projectRoot, library.preview);
      await fs.access(previewPath);
      results.push({
        id: library.id,
        name: library.name,
        ok: libraryFile.type === "excalidrawlib" && items.length > 0,
        type: libraryFile.type,
        version: libraryFile.version,
        itemCount: items.length
      });
    } catch (error) {
      results.push({
        id: library.id,
        name: library.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return {
    ok: results.every((result) => result.ok),
    count: results.length,
    results
  };
}
