import { promises as fs } from "node:fs";
import path from "node:path";
import {
  artifactsDir,
  snapshotsDir
} from "./config.mjs";

export function normalizeSceneName(input) {
  const basename = path.basename(String(input || "untitled.excalidraw"));
  const safe = basename.replace(/[^a-zA-Z0-9._-]/g, "-");
  return safe.endsWith(".excalidraw") ? safe : `${safe}.excalidraw`;
}

export async function ensureArtifactsDir() {
  await fs.mkdir(artifactsDir, { recursive: true });
}

export function scenePath(name) {
  return path.join(artifactsDir, normalizeSceneName(name));
}

function sceneSlug(name) {
  return normalizeSceneName(name).replace(/\.excalidraw$/, "");
}

async function ensureSceneSnapshotsDir(name) {
  const dir = path.join(snapshotsDir, sceneSlug(name));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function safeLabel(input) {
  const label = String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return label.slice(0, 48);
}

function snapshotTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function readScene(name) {
  const raw = await fs.readFile(scenePath(name), "utf8");
  return JSON.parse(raw);
}

export async function writeScene(name, scene) {
  await ensureArtifactsDir();
  const fileName = normalizeSceneName(name);
  await fs.writeFile(scenePath(fileName), `${JSON.stringify(scene, null, 2)}\n`, "utf8");
  return fileName;
}

export async function createSnapshot(name, options = {}) {
  await ensureArtifactsDir();
  const fileName = normalizeSceneName(name);
  const raw = await fs.readFile(scenePath(fileName), "utf8");
  const dir = await ensureSceneSnapshotsDir(fileName);
  const label = safeLabel(options.label);
  const snapshotName = `${snapshotTimestamp()}${label ? `-${label}` : ""}.excalidraw`;
  const filePath = path.join(dir, snapshotName);
  await fs.writeFile(filePath, raw, "utf8");
  return {
    scene: fileName,
    name: snapshotName,
    path: filePath
  };
}

export async function listSnapshots(name) {
  const fileName = normalizeSceneName(name);
  const dir = path.join(snapshotsDir, sceneSlug(fileName));
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const snapshots = await Promise.all(
    names
      .filter((snapshot) => snapshot.endsWith(".excalidraw"))
      .map(async (snapshot) => {
        const filePath = path.join(dir, snapshot);
        const stat = await fs.stat(filePath);
        return {
          scene: fileName,
          name: snapshot,
          path: filePath,
          size: stat.size,
          createdAt: stat.mtime.toISOString()
        };
      })
  );
  return snapshots.sort((a, b) => b.name.localeCompare(a.name));
}

export async function resolveSnapshotPath(name, reference = "latest") {
  const fileName = normalizeSceneName(name);
  const snapshotRef = String(reference || "latest");
  if (snapshotRef === "latest") {
    const [latest] = await listSnapshots(fileName);
    if (!latest) {
      throw new Error(`No snapshots found for ${fileName}`);
    }
    return latest.path;
  }
  const directPath = path.resolve(process.cwd(), snapshotRef);
  if (path.isAbsolute(snapshotRef) || snapshotRef.includes(path.sep)) {
    return directPath;
  }
  const snapshotName = snapshotRef.endsWith(".excalidraw") ? snapshotRef : `${snapshotRef}.excalidraw`;
  return path.join(snapshotsDir, sceneSlug(fileName), snapshotName);
}

export async function restoreSnapshot(name, reference = "latest") {
  const fileName = normalizeSceneName(name);
  const snapshotPath = await resolveSnapshotPath(fileName, reference);
  const raw = await fs.readFile(snapshotPath, "utf8");
  await fs.writeFile(scenePath(fileName), raw, "utf8");
  return {
    scene: fileName,
    restoredFrom: snapshotPath,
    path: scenePath(fileName)
  };
}

export async function listScenes() {
  await ensureArtifactsDir();
  const names = await fs.readdir(artifactsDir);
  const summaries = await Promise.all(
    names
      .filter((name) => name.endsWith(".excalidraw"))
      .map(async (name) => {
        const stat = await fs.stat(path.join(artifactsDir, name));
        const previewName = name.replace(/\.excalidraw$/, ".png");
        const snapshots = await listSnapshots(name);
        let previewUrl;
        let previewModifiedAt;
        try {
          const previewStat = await fs.stat(path.join(artifactsDir, previewName));
          previewUrl = `/artifacts/excalidraw/${encodeURIComponent(previewName)}`;
          previewModifiedAt = previewStat.mtime.toISOString();
        } catch {
          previewUrl = undefined;
        }
        return {
          name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          snapshotCount: snapshots.length,
          previewModifiedAt,
          previewUrl
        };
      })
  );
  return summaries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
