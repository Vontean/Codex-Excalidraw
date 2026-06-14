function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pointTuple(value) {
  if (!Array.isArray(value)) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

export function isLinearElement(element) {
  return element?.type === "arrow" || element?.type === "line";
}

export function hasValidLinearPoints(points) {
  if (!Array.isArray(points) || points.length < 2) return false;
  return points.slice(0, 2).every((point) => Boolean(pointTuple(point)));
}

function normalizedPoints(points) {
  if (!Array.isArray(points)) return null;
  const next = points.map(pointTuple).filter(Boolean);
  return next.length >= 2 ? next : null;
}

function ensureNullish(element, key, value) {
  if (element[key] != null) return false;
  if (Object.prototype.hasOwnProperty.call(element, key) && element[key] === value) return false;
  element[key] = value;
  return true;
}

export function normalizeLinearElement(element) {
  if (!isLinearElement(element)) return false;
  let changed = false;

  const points = normalizedPoints(element.points);
  if (points) {
    if (points.length !== element.points.length || points.some((point, index) =>
      point[0] !== Number(element.points[index]?.[0]) || point[1] !== Number(element.points[index]?.[1])
    )) {
      element.points = points;
      changed = true;
    }
  } else {
    element.points = [
      [0, 0],
      [finiteNumber(element.width), finiteNumber(element.height)]
    ];
    changed = true;
  }

  changed = ensureNullish(element, "lastCommittedPoint", null) || changed;
  changed = ensureNullish(element, "startBinding", null) || changed;
  changed = ensureNullish(element, "endBinding", null) || changed;
  changed = ensureNullish(element, "startArrowhead", null) || changed;
  changed = ensureNullish(element, "endArrowhead", element.type === "arrow" ? "arrow" : null) || changed;
  return changed;
}

export function normalizeSceneLinearElements(scene) {
  if (!Array.isArray(scene?.elements)) return 0;
  let changed = 0;
  for (const element of scene.elements) {
    if (normalizeLinearElement(element)) changed += 1;
  }
  return changed;
}
