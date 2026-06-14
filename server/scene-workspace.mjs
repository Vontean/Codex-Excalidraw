import { promises as fs } from "node:fs";
import path from "node:path";
import {
  artifactsDir,
  snapshotRetentionLimit,
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

function scenePreviewPaths(name) {
  const fileName = normalizeSceneName(name);
  return [
    ...["png", "svg"].map((extension) =>
      path.join(artifactsDir, fileName.replace(/\.excalidraw$/, `.${extension}`))
    ),
    path.join(artifactsDir, fileName.replace(/\.excalidraw$/, ".review.png"))
  ];
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

async function resolveUniqueSnapshotPath(dir, snapshotName) {
  const extension = ".excalidraw";
  const baseName = snapshotName.endsWith(extension)
    ? snapshotName.slice(0, -extension.length)
    : snapshotName;

  for (let index = 0; index < 1000; index += 1) {
    const name = index === 0 ? `${baseName}${extension}` : `${baseName}-${index}${extension}`;
    const filePath = path.join(dir, name);
    try {
      await fs.access(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { name, path: filePath };
      }
      throw error;
    }
  }

  throw new Error(`Could not allocate a unique snapshot name for ${snapshotName}`);
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

export async function deleteScene(name) {
  await ensureArtifactsDir();
  const fileName = normalizeSceneName(name);
  const sourcePath = scenePath(fileName);
  const previewPaths = scenePreviewPaths(fileName);
  const sceneSnapshotsDir = path.join(snapshotsDir, sceneSlug(fileName));

  await fs.unlink(sourcePath);
  await Promise.all([
    ...previewPaths.map((filePath) => fs.rm(filePath, { force: true })),
    fs.rm(sceneSnapshotsDir, { force: true, recursive: true })
  ]);

  return {
    scene: fileName,
    deleted: {
      source: sourcePath,
      previews: previewPaths,
      snapshotsDir: sceneSnapshotsDir
    }
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function renameIfExists(fromPath, toPath) {
  if (!(await pathExists(fromPath))) return false;
  if (await pathExists(toPath)) {
    const error = new Error(`Cannot rename because ${toPath} already exists.`);
    error.code = "EEXIST";
    throw error;
  }
  await fs.mkdir(path.dirname(toPath), { recursive: true });
  await fs.rename(fromPath, toPath);
  return true;
}

export async function renameScene(from, to) {
  await ensureArtifactsDir();
  const fromName = normalizeSceneName(from);
  const toName = normalizeSceneName(to);
  if (fromName === toName) {
    return {
      from: fromName,
      to: toName,
      renamed: false,
      moved: {
        source: false,
        previews: [],
        snapshotsDir: false
      }
    };
  }

  const fromPath = scenePath(fromName);
  const toPath = scenePath(toName);
  if (!(await pathExists(fromPath))) {
    const error = new Error(`Scene ${fromName} does not exist.`);
    error.code = "ENOENT";
    throw error;
  }
  if (await pathExists(toPath)) {
    const error = new Error(`Scene ${toName} already exists.`);
    error.code = "EEXIST";
    throw error;
  }

  const fromPreviewPaths = scenePreviewPaths(fromName);
  const toPreviewPaths = scenePreviewPaths(toName);
  for (let index = 0; index < fromPreviewPaths.length; index += 1) {
    if ((await pathExists(fromPreviewPaths[index])) && (await pathExists(toPreviewPaths[index]))) {
      const error = new Error(`Cannot rename because ${toPreviewPaths[index]} already exists.`);
      error.code = "EEXIST";
      throw error;
    }
  }

  const fromSnapshotsDir = path.join(snapshotsDir, sceneSlug(fromName));
  const toSnapshotsDir = path.join(snapshotsDir, sceneSlug(toName));
  if ((await pathExists(fromSnapshotsDir)) && (await pathExists(toSnapshotsDir))) {
    const error = new Error(`Cannot rename because ${toSnapshotsDir} already exists.`);
    error.code = "EEXIST";
    throw error;
  }

  await fs.rename(fromPath, toPath);

  const movedPreviews = [];
  for (let index = 0; index < fromPreviewPaths.length; index += 1) {
    if (await renameIfExists(fromPreviewPaths[index], toPreviewPaths[index])) {
      movedPreviews.push({
        from: fromPreviewPaths[index],
        to: toPreviewPaths[index]
      });
    }
  }

  const movedSnapshotsDir = await renameIfExists(fromSnapshotsDir, toSnapshotsDir);

  return {
    from: fromName,
    to: toName,
    renamed: true,
    moved: {
      source: {
        from: fromPath,
        to: toPath
      },
      previews: movedPreviews,
      snapshotsDir: movedSnapshotsDir
        ? {
            from: fromSnapshotsDir,
            to: toSnapshotsDir
          }
        : false
    }
  };
}

export async function createSnapshot(name, options = {}) {
  await ensureArtifactsDir();
  const fileName = normalizeSceneName(name);
  const raw = await fs.readFile(scenePath(fileName), "utf8");
  const dir = await ensureSceneSnapshotsDir(fileName);
  const label = safeLabel(options.label);
  const baseSnapshotName = `${snapshotTimestamp()}${label ? `-${label}` : ""}.excalidraw`;
  const { name: snapshotName, path: filePath } = await resolveUniqueSnapshotPath(dir, baseSnapshotName);
  await fs.writeFile(filePath, raw, "utf8");
  const prunedSnapshots = await pruneSnapshots(fileName, {
    keep: options.keep ?? options.retentionLimit ?? snapshotRetentionLimit,
    protect: snapshotName
  });
  return {
    scene: fileName,
    name: snapshotName,
    path: filePath,
    prunedSnapshots
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

export async function pruneSnapshots(name, options = {}) {
  const keep = Number(options.keep);
  if (!Number.isFinite(keep) || keep <= 0) return [];

  const fileName = normalizeSceneName(name);
  const snapshots = await listSnapshots(fileName);
  const protectedName = options.protect ? String(options.protect) : "";
  const protectedSnapshots = protectedName
    ? snapshots.filter((snapshot) => snapshot.name === protectedName)
    : [];
  const otherSnapshots = snapshots.filter((snapshot) => snapshot.name !== protectedName);
  const removable = [...protectedSnapshots, ...otherSnapshots].slice(Math.floor(keep));
  const pruned = [];

  for (const snapshot of removable) {
    await fs.rm(snapshot.path, { force: true });
    pruned.push(snapshot);
  }

  return pruned;
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
