export function createSceneFileOperations(dependencies) {
  const {
    applyLayoutPlan,
    applyPatchPlan,
    applyPolishPlan,
    createSnapshot,
    diffScenes,
    normalizeSceneName,
    qaScene,
    readScene,
    writeScene
  } = dependencies;

  async function runSceneFileOperation(name, operationName, plan, applyOperation, options = {}) {
    const fileName = normalizeSceneName(name);
    const before = await readScene(fileName);
    const snapshot = options.dryRun || options.snapshot === false
      ? null
      : await createSnapshot(fileName, { label: options.label || `before-${operationName}` });
    const result = applyOperation(before, plan, options);
    const diff = diffScenes(before, result.scene, {
      name: fileName,
      comparedWith: snapshot?.path || "in-memory-before"
    });
    if (!options.dryRun) {
      await writeScene(fileName, result.scene);
    }
    return {
      ok: true,
      scene: fileName,
      snapshot,
      dryRun: Boolean(options.dryRun),
      report: result.report,
      diff,
      qa: qaScene(result.scene, { name: fileName })
    };
  }

  return {
    patchSceneFile(name, plan, options = {}) {
      return runSceneFileOperation(name, "patch", plan, applyPatchPlan, options);
    },
    layoutSceneFile(name, plan, options = {}) {
      return runSceneFileOperation(name, "layout", plan, applyLayoutPlan, options);
    },
    polishSceneFile(name, plan = {}, options = {}) {
      return runSceneFileOperation(name, "polish", plan, applyPolishPlan, options);
    }
  };
}
