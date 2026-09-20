import type { Plane } from "./domain";

export interface MapView { zoom: number; panX: number; panY: number }

/** One aspect-preserving transform for drawing and pointer hit testing. */
export function fitMapFrame(plane: Pick<Plane, "width" | "height">, width: number, height: number) {
  const aspect = plane.width > 0 && plane.height > 0 && Number.isFinite(plane.width / plane.height)
    ? plane.width / plane.height : 1;
  const mapWidth = Math.min(width, height * aspect);
  const mapHeight = mapWidth / aspect;
  return { width: mapWidth, height: mapHeight, x: (width - mapWidth) / 2, y: (height - mapHeight) / 2 };
}

export function screenToMapPoint(plane: Pick<Plane, "width" | "height">, width: number, height: number, view: MapView, x: number, y: number) {
  const frame = fitMapFrame(plane, width, height);
  return {
    x: ((x - width / 2 - view.panX) / view.zoom + frame.width / 2) / frame.width,
    y: ((y - height / 2 - view.panY) / view.zoom + frame.height / 2) / frame.height,
  };
}

export interface LabelBox { x: number; y: number; width: number; height: number }

export function provinceBadgeRadius(width: number, screenScale = 1): number {
  return Math.max(6, Math.min(10, width * screenScale / 330)) / screenScale;
}

/** Labels may use negative space, but never collide with another label/marker. */
export function placeMapLabel(x: number, y: number, labelWidth: number, labelHeight: number, offset: number, width: number, height: number, occupied: readonly LabelBox[]): LabelBox | undefined {
  const candidates = [
    { x: x - labelWidth / 2, y: y + offset },
    { x: x - labelWidth / 2, y: y - offset - labelHeight },
    { x: x + offset, y: y - labelHeight / 2 },
    { x: x - offset - labelWidth, y: y - labelHeight / 2 },
  ];
  for (const point of candidates) {
    const box = { x: Math.max(2, Math.min(width - labelWidth - 2, point.x)), y: point.y, width: labelWidth, height: labelHeight };
    if (box.x + box.width > width - 2 || box.y < 2 || box.y + box.height > height - 2) continue;
    if (occupied.some(other => box.x < other.x + other.width + 2 && box.x + box.width + 2 > other.x
      && box.y < other.y + other.height + 2 && box.y + box.height + 2 > other.y)) continue;
    return box;
  }
  return undefined;
}
