import type { Edge } from "./domain";
import { edgeSpecial } from "./dom6";

export interface BorderStyle { color: string; width: number; dash: number[] }

export function setBorderKind(edge: Edge, kind: Edge["kind"]): void {
  if (kind === "custom") edge.special = edgeSpecial(edge);
  edge.kind = kind;
}

/** Use effective native bits for both presets and custom combinations. */
export function borderStyles(edge?: Pick<Edge, "kind" | "special">): BorderStyle[] {
  const bits = edge ? edgeSpecial(edge as Edge) : 0;
  const styles: BorderStyle[] = [];
  if (bits & 32) styles.push({ color: "rgba(195, 129, 82, .82)", width: 4.5, dash: [2, 2] });
  // A bridge keeps the same visible watercourse without adding native river
  // bit 2, which would make the crossing condition-dependent again.
  if (bits & (2 | 16)) styles.push({ color: "rgba(83, 174, 213, .9)", width: 3.5, dash: [] });
  if (bits & 8) styles.push({ color: "rgba(223, 196, 122, .9)", width: 2, dash: [5, 3] });
  if (bits & 16) styles.push({ color: "rgba(213, 188, 126, .95)", width: 2.2, dash: [5, 2] });
  if (bits & 1) styles.push({ color: "rgba(220, 158, 91, .95)", width: 2.2, dash: [6, 2] });
  // Impassability remains the most prominent rule in a combined border.
  if (bits & 4) styles.push({ color: "rgba(225, 91, 76, .95)", width: 2.8, dash: [3, 3] });
  if (bits & 192) styles.push({ color: "rgba(212, 153, 240, .9)", width: 1.2, dash: [1, 4] });
  return styles.length ? styles : [{ color: "rgba(20, 32, 34, .52)", width: 1.15, dash: [] }];
}
