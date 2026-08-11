"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isWaterTerrain, type Plane, type PreviewCondition, type Province, type TerrainKey } from "./domain";
import { terrainPreviewKey } from "./dom6";
import {
  computeProvinceTopology,
  computeVoronoiCells,
  connectionKey,
  type Cell,
  type Point,
  type ProvinceTopology,
} from "./geometry";

const TERRAIN_COLORS: Record<TerrainKey, [string, string]> = {
  plains: ["#8ea56c", "#6f8752"],
  forest: ["#3d674d", "#264b3a"],
  farm: ["#b9a75f", "#8d7c42"],
  swamp: ["#54756c", "#365852"],
  waste: ["#b47b51", "#82553f"],
  highland: ["#7f806a", "#5b5f54"],
  mountains: ["#777870", "#4e514d"],
  freshwater: ["#46879b", "#2e6577"],
  sea: ["#2e728d", "#1e526c"],
  deepsea: ["#193e5b", "#112d46"],
  kelp: ["#2e6c68", "#1b4d4a"],
  cave: ["#675d55", "#463e39"],
  caveforest: ["#405f4e", "#2a4338"],
  caveswamp: ["#455f5b", "#304744"],
  cavewaste: ["#7a5948", "#583e34"],
  cavehighland: ["#69645f", "#494542"],
  cavewall: ["#282829", "#171719"],
};

interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

interface MapCanvasProps {
  plane: Plane;
  selectedId?: string;
  previewCondition: PreviewCondition;
  onSelect: (provinceId: string) => void;
  onZoomChange?: (zoom: number) => void;
  tool?: string;
}

export function MapCanvas({ plane, selectedId, previewCondition, onSelect, onZoomChange, tool = "select" }: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 });
  const cells = useMemo(() => computeVoronoiCells(plane), [plane]);
  const topology = useMemo(() => computeProvinceTopology(plane), [plane]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const bounds = wrapper.getBoundingClientRect();
    const width = Math.max(320, Math.floor(bounds.width));
    const height = Math.max(260, Math.floor(bounds.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = plane.kind === "underworld" || plane.kind === "abyss" ? "#17171b" : "#183544";
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(width / 2 + view.panX, height / 2 + view.panY);
    context.scale(view.zoom, view.zoom);
    context.translate(-width / 2, -height / 2);
    paintPlane(context, plane, cells, topology, previewCondition, width, height, { selectedId, labels: view.zoom >= 1.35, detail: view.zoom >= 0.92 });
    context.restore();
    drawVignette(context, width, height);
  }, [cells, plane, previewCondition, selectedId, topology, view]);

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(draw);
    if (wrapperRef.current) observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [draw]);

  const screenToWorld = (clientX: number, clientY: number) => {
    const bounds = canvasRef.current!.getBoundingClientRect();
    const sx = clientX - bounds.left;
    const sy = clientY - bounds.top;
    const x = ((sx - bounds.width / 2 - view.panX) / view.zoom + bounds.width / 2) / bounds.width;
    const y = ((sy - bounds.height / 2 - view.panY) / view.zoom + bounds.height / 2) / bounds.height;
    return { x, y };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY, moved: false };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) setView((current) => ({ ...current, panX: drag.panX + dx, panY: drag.panY + dy }));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.moved) {
      const point = screenToWorld(event.clientX, event.clientY);
      const province = nearestProvince(plane, point.x, point.y);
      if (province) onSelect(province.id);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const nextZoom = clamp(view.zoom * Math.exp(-event.deltaY * 0.001), 0.78, 4);
    setView((current) => ({ ...current, zoom: nextZoom }));
    onZoomChange?.(nextZoom);
  };

  return (
    <div className="map-canvas-wrap" ref={wrapperRef}>
      <canvas
        ref={canvasRef}
        className={`map-canvas tool-${tool}`}
        aria-label={`${plane.name} interactive province map`}
        role="img"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragRef.current = null; }}
        onWheel={handleWheel}
        onKeyDown={(event) => {
          if (!selectedId) return;
          const selected = plane.provinces.find((province) => province.id === selectedId);
          if (!selected) return;
          const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
          if (!delta) return;
          event.preventDefault();
          const nextIndex = (selected.index - 1 + delta + plane.provinces.length) % plane.provinces.length;
          onSelect(plane.provinces[nextIndex]!.id);
        }}
      />
      <div className="map-compass" aria-hidden="true"><span>N</span><i /></div>
      <button
        className="map-reset"
        type="button"
        onClick={() => {
          setView({ zoom: 1, panX: 0, panY: 0 });
          onZoomChange?.(1);
        }}
        aria-label="Reset map view"
      >
        Fit
      </button>
    </div>
  );
}

export async function renderPlanePng(plane: Plane, condition: PreviewCondition): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = plane.width;
  canvas.height = plane.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");
  context.fillStyle = plane.kind === "underworld" || plane.kind === "abyss" ? "#17171b" : "#183544";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const cells = computeVoronoiCells(plane);
  const topology = computeProvinceTopology(plane);
  paintPlane(context, plane, cells, topology, condition, canvas.width, canvas.height, { labels: true, detail: true });
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The preview image could not be encoded.")), "image/png");
  });
}

function paintPlane(
  context: CanvasRenderingContext2D,
  plane: Plane,
  cells: Cell[],
  topology: ProvinceTopology,
  condition: PreviewCondition,
  width: number,
  height: number,
  options: { selectedId?: string; labels?: boolean; detail?: boolean },
) {
  const cellById = new Map(cells.map((cell) => [cell.provinceId, cell]));
  for (const province of plane.provinces) {
    const cell = cellById.get(province.id);
    if (!cell?.polygons.length) continue;
    const terrain = terrainPreviewKey(province.terrain, condition);
    const [primary, secondary] = colorsForCondition(TERRAIN_COLORS[terrain], condition);
    drawCellPath(context, cell.polygons, width, height);
    const gradient = context.createLinearGradient(province.x * width - width * 0.05, province.y * height - height * 0.05, province.x * width + width * 0.05, province.y * height + height * 0.05);
    gradient.addColorStop(0, primary);
    gradient.addColorStop(1, secondary);
    context.fillStyle = gradient;
    context.fill();
    context.strokeStyle = options.selectedId === province.id ? "#f5d67c" : "rgba(15, 24, 27, .72)";
    context.lineWidth = options.selectedId === province.id ? Math.max(2, width / 900) : Math.max(0.75, width / 3400);
    context.stroke();
    if (options.detail) drawTerrainMarks(context, province, terrain, cell.polygons, width, height, condition);
  }

  context.save();
  context.lineCap = "round";
  for (const edge of plane.edges) {
    // Ordinary shared cell outlines are the standard-connection display. Only
    // special movement rules need an overlay, and those overlays follow the
    // actual shared border instead of crossing province interiors.
    if (edge.kind === "standard") continue;
    const segments = topology.sharedBorders.get(connectionKey(edge.a, edge.b));
    if (!segments?.length) continue;
    const style = edgeStyle(edge.kind);
    context.strokeStyle = style.color;
    context.lineWidth = Math.max(style.width, width / 1900);
    context.setLineDash(style.dash.map((value) => value * Math.max(1, width / 1700)));
    context.beginPath();
    for (const segment of segments) {
      context.moveTo(segment.from.x * width, segment.from.y * height);
      context.lineTo(segment.to.x * width, segment.to.y * height);
    }
    context.stroke();
  }
  context.setLineDash([]);
  context.restore();

  for (const province of plane.provinces) {
    const x = province.x * width;
    const y = province.y * height;
    const markerRadius = clamp(Math.min(width, height) / 270, 2.4, 7);
    context.beginPath();
    context.arc(x, y, markerRadius, 0, TAU);
    context.fillStyle = province.start ? "#f5d67c" : province.throne === "preferred" || province.throne === "fixed" ? "#d5a8ff" : "rgba(245, 238, 209, .88)";
    context.fill();
    context.lineWidth = Math.max(1, width / 3200);
    context.strokeStyle = "rgba(18, 22, 23, .86)";
    context.stroke();
    if (province.start || province.throne !== "none" || province.sites.length || province.defenders.length) {
      const badge = province.start ? "S" : province.throne !== "none" ? "T" : province.defenders.length ? "D" : "✦";
      context.fillStyle = "#181b1c";
      context.font = `700 ${Math.max(8, markerRadius * 1.55)}px ui-sans-serif, system-ui`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(badge, x, y + 0.25);
    }
    if (options.labels) {
      context.font = `600 ${clamp(width / 230, 9, 18)}px ui-sans-serif, system-ui`;
      context.textAlign = "center";
      context.textBaseline = "top";
      context.lineWidth = Math.max(2, width / 1400);
      context.strokeStyle = "rgba(16, 19, 20, .82)";
      context.fillStyle = "rgba(250, 245, 225, .94)";
      context.strokeText(province.name, x, y + markerRadius + 3);
      context.fillText(province.name, x, y + markerRadius + 3);
    }
  }
}

function drawTerrainMarks(
  context: CanvasRenderingContext2D,
  province: Province,
  terrain: TerrainKey,
  polygons: Point[][],
  width: number,
  height: number,
  condition: PreviewCondition,
) {
  const radius = Math.max(2, Math.min(width, height) / 330);
  context.save();
  drawCellPath(context, polygons, width, height);
  context.clip();
  const count = clamp(Math.round(3 + Math.min(width, height) / 450), 3, 12);
  for (let index = 0; index < count; index += 1) {
    const angle = ((hash(`${province.id}:${index}:a`) % 360) / 360) * TAU;
    const distance = ((hash(`${province.id}:${index}:d`) % 100) / 100) * Math.min(width, height) * 0.035;
    const x = province.x * width + Math.cos(angle) * distance;
    const y = province.y * height + Math.sin(angle) * distance;
    context.globalAlpha = 0.23;
    context.strokeStyle = condition === "winter" ? "#f4f7ef" : "#172b25";
    context.fillStyle = condition === "winter" ? "#e7eee7" : "#1d352c";
    context.lineWidth = Math.max(0.65, radius * 0.18);
    if (["forest", "caveforest", "kelp"].includes(terrain)) {
      context.beginPath();
      context.moveTo(x, y - radius);
      context.lineTo(x - radius * 0.68, y + radius * 0.55);
      context.lineTo(x + radius * 0.68, y + radius * 0.55);
      context.closePath();
      context.fill();
    } else if (["highland", "mountains", "cavehighland"].includes(terrain)) {
      context.beginPath();
      context.moveTo(x - radius, y + radius * 0.7);
      context.lineTo(x, y - radius);
      context.lineTo(x + radius, y + radius * 0.7);
      context.stroke();
    } else if (isWaterTerrain(terrain) || terrain === "freshwater" || terrain.includes("swamp")) {
      context.beginPath();
      context.moveTo(x - radius, y);
      context.quadraticCurveTo(x - radius * 0.4, y - radius * 0.45, x, y);
      context.quadraticCurveTo(x + radius * 0.4, y + radius * 0.45, x + radius, y);
      context.stroke();
    } else if (terrain === "farm") {
      context.beginPath();
      context.moveTo(x - radius, y - radius);
      context.lineTo(x + radius, y + radius);
      context.moveTo(x, y - radius);
      context.lineTo(x + radius, y);
      context.stroke();
    } else if (terrain.includes("waste")) {
      context.beginPath();
      context.arc(x, y, radius * 0.52, 0, TAU);
      context.stroke();
    }
  }
  context.restore();
}

function drawCellPath(context: CanvasRenderingContext2D, polygons: Point[][], width: number, height: number) {
  context.beginPath();
  for (const points of polygons) {
    points.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
  }
}

function edgeStyle(kind: string) {
  if (kind === "impassable") return { color: "rgba(225, 91, 76, .9)", width: 2.2, dash: [3, 3] };
  if (kind === "river") return { color: "rgba(83, 174, 213, .82)", width: 2, dash: [] as number[] };
  if (kind === "bridge") return { color: "rgba(213, 188, 126, .9)", width: 2.2, dash: [5, 2] };
  if (kind === "road") return { color: "rgba(223, 196, 122, .78)", width: 2, dash: [5, 3] };
  if (kind === "mountain_border") return { color: "rgba(195, 129, 82, .82)", width: 2.2, dash: [2, 2] };
  if (kind === "mountain_pass") return { color: "rgba(220, 158, 91, .9)", width: 2.2, dash: [6, 2] };
  return { color: "rgba(20, 32, 34, .52)", width: 1.15, dash: [] as number[] };
}

function colorsForCondition(colors: [string, string], condition: PreviewCondition): [string, string] {
  if (condition === "winter") return [mix(colors[0], "#e8eee8", 0.58), mix(colors[1], "#cdd9d5", 0.46)];
  return colors;
}

function mix(first: string, second: string, amount: number): string {
  const a = hexRgb(first);
  const b = hexRgb(second);
  const channel = (left: number, right: number) => Math.round(left + (right - left) * amount).toString(16).padStart(2, "0");
  return `#${channel(a[0], b[0])}${channel(a[1], b[1])}${channel(a[2], b[2])}`;
}

function hexRgb(value: string): [number, number, number] {
  return [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16)];
}

function nearestProvince(plane: Plane, x: number, y: number): Province | undefined {
  let nearest: Province | undefined;
  let distance = Infinity;
  for (const province of plane.provinces) {
    let dx = Math.abs(x - province.x);
    let dy = Math.abs(y - province.y);
    if (plane.wrapX) dx = Math.min(dx, 1 - dx);
    if (plane.wrapY) dy = Math.min(dy, 1 - dy);
    const current = dx * dx + dy * dy;
    if (current < distance) {
      nearest = province;
      distance = current;
    }
  }
  return nearest;
}

function drawVignette(context: CanvasRenderingContext2D, width: number, height: number) {
  const gradient = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.28, width / 2, height / 2, Math.max(width, height) * 0.7);
  gradient.addColorStop(0, "rgba(8, 12, 14, 0)");
  gradient.addColorStop(1, "rgba(8, 12, 14, .42)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

const TAU = Math.PI * 2;
