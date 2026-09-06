"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  effectiveProvinceTerrainFlags,
  isWaterTerrain,
  type Plane,
  type PreviewCondition,
  type Province,
  type TerrainKey,
} from "./domain";
import { terrainPreviewKey } from "./dom6";
import { provinceTerrainVisuals, terrainVisualKey, type TerrainMarkKind } from "./terrainVisuals";
import { planTerrainMarks } from "./terrainArtwork";
import {
  computeProvinceTopology,
  connectionKey,
  createProvinceOwnershipModel,
  type Cell,
  type Point,
  type ProvinceOwnershipModel,
  type ProvinceTopology,
} from "./geometry";
import {
  measurePolygonProvinceArtwork,
  measureSparseProvinceArtwork,
  periodicArtworkCopies,
  planSeamlessTiles,
  type ProvinceArtworkMetrics,
  type SeamlessTileLayout,
} from "./adaptiveArtwork";

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
  markerAnnotations?: ReadonlyMap<string, ProvinceMarkerAnnotations>;
  onNavigate: (provinceId: string) => void;
  onActivate: (provinceId: string) => void;
  onZoomChange?: (zoom: number) => void;
  tool?: string;
}

export interface ProvinceMarkerAnnotations {
  specificStartNation?: number;
  gateNumbers?: readonly number[];
}

export type ProvinceMarkerKind = "generic-start" | "team-start" | "specific-start" | "preferred-throne" | "fixed-throne" | "avoided-throne" | "placed-site" | "many-sites" | "guardians" | "gateway";

export interface ProvinceMarkerBadge {
  kind: ProvinceMarkerKind;
  glyph: string;
  label: string;
  color: string;
}

export interface MapKeyboardCommand {
  type: "navigate" | "activate";
  provinceId: string;
}

export function resolveMapKeyboardCommand(
  provinces: readonly Pick<Province, "id">[],
  selectedId: string | undefined,
  key: string,
): MapKeyboardCommand | undefined {
  if (!provinces.length) return undefined;
  const selectedIndex = provinces.findIndex((province) => province.id === selectedId);
  let nextIndex: number | undefined;
  if (key === "ArrowRight" || key === "ArrowDown") nextIndex = selectedIndex < 0 ? 0 : (selectedIndex + 1) % provinces.length;
  else if (key === "ArrowLeft" || key === "ArrowUp") nextIndex = selectedIndex < 0 ? provinces.length - 1 : (selectedIndex - 1 + provinces.length) % provinces.length;
  else if (key === "Home") nextIndex = 0;
  else if (key === "End") nextIndex = provinces.length - 1;
  else if (key === "Enter" || key === " ") return { type: "activate", provinceId: provinces[selectedIndex < 0 ? 0 : selectedIndex]!.id };
  return nextIndex === undefined ? undefined : { type: "navigate", provinceId: provinces[nextIndex]!.id };
}

export function dispatchMapKeyboardCommand(
  command: MapKeyboardCommand,
  onNavigate: (provinceId: string) => void,
  onActivate: (provinceId: string) => void,
): void {
  if (command.type === "navigate") onNavigate(command.provinceId);
  else onActivate(command.provinceId);
}

export function MapCanvas({ plane, selectedId, previewCondition, markerAnnotations, onNavigate, onActivate, onZoomChange, tool = "select" }: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const keyboardHelpId = useId();
  const provinceStatusId = useId();
  const currentOptionId = useId();
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const keyboardActionSerial = useRef(0);
  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 });
  const [keyboardAction, setKeyboardAction] = useState<{ provinceId: string; tool: string; message: string }>();
  const topology = useMemo(() => computeProvinceTopology(plane), [plane]);
  const ownership = useMemo(() => createProvinceOwnershipModel(plane), [plane]);
  const cells = useMemo(() => ownership.mode === "solid" ? topology.cells : [], [ownership.mode, topology]);
  const backgroundAsset = useMemo(() => planeBackgroundAsset(plane, ownership), [ownership, plane]);
  const [loadedBackground, setLoadedBackground] = useState<{ source: string; image: HTMLImageElement }>();
  const backgroundImage = loadedBackground && loadedBackground.source === backgroundAsset ? loadedBackground.image : undefined;
  const materialSources = useMemo(() => planeMaterialAssets(plane, previewCondition), [plane, previewCondition]);
  const materialSignature = materialSources.join("|");
  const [loadedMaterials, setLoadedMaterials] = useState<{ signature: string; images: Map<string, HTMLImageElement> }>();
  const materialImages = loadedMaterials?.signature === materialSignature ? loadedMaterials.images : undefined;
  const selectedProvince = plane.provinces.find((province) => province.id === selectedId);
  const selectedPosition = selectedProvince ? plane.provinces.findIndex((province) => province.id === selectedProvince.id) + 1 : undefined;
  const toolLabel = `${tool.charAt(0).toUpperCase()}${tool.slice(1)}`;
  const selectedMarkerSummary = selectedProvince
    ? provinceMarkerBadges(selectedProvince, markerAnnotations?.get(selectedProvince.id)).map((badge) => badge.label).join(", ")
    : "";
  const provinceStatus = selectedProvince
    ? `Current province ${selectedProvince.index} of ${plane.provinces.length}: ${selectedProvince.name}. Terrain: ${[...effectiveProvinceTerrainFlags(selectedProvince)].join(", ") || "plains"}.${selectedMarkerSummary ? ` Markers: ${selectedMarkerSummary}.` : ""} ${toolLabel} tool active.`
    : `${plane.provinces.length} provinces. No current province. ${toolLabel} tool active.`;
  const liveStatus = keyboardAction && keyboardAction.provinceId === selectedId && keyboardAction.tool === tool
    ? keyboardAction.message
    : provinceStatus;

  useEffect(() => {
    let cancelled = false;
    if (!backgroundAsset || typeof Image === "undefined") return () => { cancelled = true; };
    const next = new Image();
    next.decoding = "async";
    next.onload = () => { if (!cancelled) setLoadedBackground({ source: backgroundAsset, image: next }); };
    next.src = backgroundAsset;
    return () => { cancelled = true; };
  }, [backgroundAsset]);

  useEffect(() => {
    let cancelled = false;
    void loadArtworkImages(materialSources).then((images) => {
      if (!cancelled) setLoadedMaterials({ signature: materialSignature, images });
    });
    return () => { cancelled = true; };
  }, [materialSignature, materialSources]);

  useEffect(() => { onZoomChange?.(1); }, [onZoomChange]);

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
    context.fillStyle = mapBackgroundColor(plane, ownership);
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(width / 2 + view.panX, height / 2 + view.panY);
    context.scale(view.zoom, view.zoom);
    context.translate(-width / 2, -height / 2);
    if (backgroundImage) paintRealmBackground(context, backgroundImage, width, height, plane.wrapX, plane.wrapY);
    paintPlane(context, plane, cells, topology, ownership, previewCondition, width, height, { selectedId, labels: view.zoom >= 1.35, detail: view.zoom >= 0.92, materialImages, markerAnnotations });
    context.restore();
    drawVignette(context, width, height);
  }, [backgroundImage, cells, markerAnnotations, materialImages, ownership, plane, previewCondition, selectedId, topology, view]);

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
    wrapperRef.current?.focus();
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
      const province = provinceAtOwnershipPoint(plane, ownership, point.x, point.y);
      if (province) {
        setKeyboardAction(undefined);
        onActivate(province.id);
      }
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const nextZoom = clamp(view.zoom * Math.exp(-event.deltaY * 0.001), 0.78, 4);
    setView((current) => ({ ...current, zoom: nextZoom }));
    onZoomChange?.(nextZoom);
  };

  return (
    <>
      <div
        className="map-canvas-wrap"
        ref={wrapperRef}
        aria-label={`${plane.name} interactive province map. ${provinceStatus}`}
        role="listbox"
        aria-describedby={`${keyboardHelpId} ${provinceStatusId}`}
        aria-activedescendant={selectedProvince ? currentOptionId : undefined}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End Enter Space"
        tabIndex={0}
        onKeyDown={(event) => {
          const command = resolveMapKeyboardCommand(plane.provinces, selectedId, event.key);
          if (!command) return;
          event.preventDefault();
          if (command.type === "navigate") setKeyboardAction(undefined);
          else {
            keyboardActionSerial.current += 1;
            const province = plane.provinces.find((item) => item.id === command.provinceId)!;
            setKeyboardAction({
              provinceId: province.id,
              tool,
              message: `Activated ${toolLabel} on province ${province.index}: ${province.name}. Action ${keyboardActionSerial.current}.`,
            });
          }
          dispatchMapKeyboardCommand(command, onNavigate, onActivate);
        }}
      >
        <canvas
          ref={canvasRef}
          className={`map-canvas tool-${tool}`}
          aria-hidden="true"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => { dragRef.current = null; }}
          onWheel={handleWheel}
        />
        {selectedProvince && <div id={currentOptionId} className="sr-only" role="option" aria-selected="true" aria-posinset={selectedPosition} aria-setsize={plane.provinces.length}>{selectedProvince.name}</div>}
      </div>
      <p id={keyboardHelpId} className="sr-only">Arrow keys move the current province without applying the active tool. Home or End jumps to the first or last province. Enter or Space applies the active tool exactly once.</p>
      <p id={provinceStatusId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveStatus}</p>
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
    </>
  );
}

export async function renderPlanePng(plane: Plane, condition: PreviewCondition, markerAnnotations?: ReadonlyMap<string, ProvinceMarkerAnnotations>): Promise<Blob> {
  if (!canRenderPlanePreview(plane)) {
    throw new Error("Preview dimensions must be whole positive pixels within the supported 8.29-megapixel envelope.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = plane.width;
  canvas.height = plane.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");
  const ownership = createProvinceOwnershipModel(plane);
  context.fillStyle = mapBackgroundColor(plane, ownership);
  context.fillRect(0, 0, canvas.width, canvas.height);
  const backgroundImage = await loadPlaneBackground(planeBackgroundAsset(plane, ownership));
  if (backgroundImage) paintRealmBackground(context, backgroundImage, canvas.width, canvas.height, plane.wrapX, plane.wrapY);
  const materialImages = await loadArtworkImages(planeMaterialAssets(plane, condition));
  const topology = computeProvinceTopology(plane);
  const cells = ownership.mode === "solid" ? topology.cells : [];
  paintPlane(context, plane, cells, topology, ownership, condition, canvas.width, canvas.height, { labels: true, detail: true, materialImages, markerAnnotations });
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The preview image could not be encoded.")), "image/png");
  });
}

export function canRenderPlanePreview(plane: Pick<Plane, "width" | "height">): boolean {
  return Number.isSafeInteger(plane.width)
    && Number.isSafeInteger(plane.height)
    && plane.width > 0
    && plane.height > 0
    && plane.width * plane.height <= 8_294_400;
}

const PLANE_BACKGROUND_ASSETS: Partial<Record<Plane["kind"], string>> = {
  cave: "/plane-backgrounds/cavern.png",
  cavern: "/plane-backgrounds/cavern.png",
  cloud: "/plane-backgrounds/cloud-air.png",
  air: "/plane-backgrounds/cloud-air.png",
  underworld: "/plane-backgrounds/underworld.png",
  hell: "/plane-backgrounds/infernal.png",
  abyss: "/plane-backgrounds/abyss.png",
  dream: "/plane-backgrounds/dream.png",
  elemental: "/plane-backgrounds/elemental.png",
};

export const UNIVERSAL_MATERIAL_ASSETS = {
  earth: "/map-art/materials/earth.png",
  foliage: "/map-art/materials/foliage.png",
  stone: "/map-art/materials/stone.png",
  water: "/map-art/materials/water.png",
} as const;

type MaterialFamily = keyof typeof UNIVERSAL_MATERIAL_ASSETS;

function materialFamilyForTerrain(terrain: TerrainKey): MaterialFamily {
  if (["forest", "caveforest", "kelp"].includes(terrain)) return "foliage";
  if (["highland", "mountains", "cave", "cavehighland", "cavewall"].includes(terrain)) return "stone";
  if (["freshwater", "sea", "deepsea", "swamp", "caveswamp"].includes(terrain)) return "water";
  return "earth";
}

export function planeMaterialAssets(plane: Pick<Plane, "provinces">, condition: PreviewCondition = "normal"): string[] {
  return [...new Set(plane.provinces.flatMap((province) => {
    const visuals = visualsForCondition(province, condition);
    return visuals.layers.map((terrain) => UNIVERSAL_MATERIAL_ASSETS[materialFamilyForTerrain(terrain)]);
  }))].sort();
}

function visualsForCondition(province: Province, condition: PreviewCondition) {
  return provinceTerrainVisuals(province, terrainPreviewKey(terrainVisualKey(province), condition));
}

function terrainGradient(context: CanvasRenderingContext2D, province: Province, layers: readonly TerrainKey[], condition: PreviewCondition, width: number, height: number, periodic: boolean) {
  const gradient = context.createLinearGradient(province.x * width - width * 0.05, province.y * height - height * 0.05, province.x * width + width * 0.05, province.y * height + height * 0.05);
  const base = layers[0]!;
  const colors = layers.flatMap((terrain) => {
    let palette = TERRAIN_COLORS[terrain];
    // Mountain relief in a sea is still submerged; a mixed wall stays blocked.
    const tint = base === "cavewall" ? 0.8 : isWaterTerrain(base) && !isWaterTerrain(terrain) ? 0.64 : 0;
    if (tint) palette = [mix(palette[0], TERRAIN_COLORS[base][0], tint), mix(palette[1], TERRAIN_COLORS[base][1], tint)];
    return colorsForCondition(palette, condition);
  });
  if (periodic) {
    // A map-relative linear gradient cannot continue through a torus seam.
    // Use one mixed tint per owner; seamless materials and marks carry detail.
    const tint = colors.reduce((current, color, index) => index ? mix(current, color, 1 / (index + 1)) : color);
    gradient.addColorStop(0, tint);
    gradient.addColorStop(1, tint);
  } else {
    colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), color));
  }
  return gradient;
}

/** Artwork is only needed where canonical owner-0 leaves visible negative space. */
export function planeBackgroundAsset(
  plane: Plane,
  ownership = createProvinceOwnershipModel(plane),
): string | undefined {
  return ownership.mode === "sparse" ? PLANE_BACKGROUND_ASSETS[plane.kind] : undefined;
}

async function loadPlaneBackground(source: string | undefined): Promise<HTMLImageElement | undefined> {
  if (!source || typeof Image === "undefined") return undefined;
  return await new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = source;
  });
}

async function loadArtworkImages(sources: readonly string[]): Promise<Map<string, HTMLImageElement>> {
  if (typeof Image === "undefined") return new Map();
  const loaded = await Promise.all(sources.map(async (source) => {
    const image = await new Promise<HTMLImageElement | undefined>((resolve) => {
      const next = new Image();
      next.decoding = "async";
      next.onload = () => resolve(next);
      next.onerror = () => resolve(undefined);
      next.src = source;
    });
    return image ? [source, image] as const : undefined;
  }));
  return new Map(loaded.filter((item): item is readonly [string, HTMLImageElement] => Boolean(item)));
}

function paintRealmBackground(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  wrapX: boolean,
  wrapY: boolean,
) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return;
  if (wrapX || wrapY) {
    context.save();
    context.globalAlpha = 0.58;
    paintSeamlessTileLayout(context, image, planSeamlessTiles(width, height, sourceWidth, sourceHeight, wrapX, wrapY));
    context.globalAlpha = 1;
    context.fillStyle = "rgba(4, 8, 10, .34)";
    context.fillRect(0, 0, width, height);
    context.restore();
    return;
  }
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = width / height;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;
  if (targetAspect > sourceAspect) {
    sh = sourceWidth / targetAspect;
    sy = (sourceHeight - sh) / 2;
  } else {
    sw = sourceHeight * targetAspect;
    sx = (sourceWidth - sw) / 2;
  }
  context.save();
  context.globalAlpha = 0.58;
  context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
  context.globalAlpha = 1;
  context.fillStyle = "rgba(4, 8, 10, .34)";
  context.fillRect(0, 0, width, height);
  context.restore();
}

function paintPlane(
  context: CanvasRenderingContext2D,
  plane: Plane,
  cells: Cell[],
  topology: ProvinceTopology,
  ownership: ProvinceOwnershipModel,
  condition: PreviewCondition,
  width: number,
  height: number,
  options: { selectedId?: string; labels?: boolean; detail?: boolean; materialImages?: Map<string, HTMLImageElement>; markerAnnotations?: ReadonlyMap<string, ProvinceMarkerAnnotations> },
) {
  if (ownership.mode === "sparse") {
    paintSparsePlane(context, plane, topology, ownership, condition, width, height, options);
    return;
  }
  const cellById = new Map(cells.map((cell) => [cell.provinceId, cell]));
  const materialLayouts = new Map<string, SeamlessTileLayout>();
  for (const province of plane.provinces) {
    const cell = cellById.get(province.id);
    if (!cell?.polygons.length) continue;
    const visuals = visualsForCondition(province, condition);
    drawCellPath(context, cell.polygons, width, height);
    context.fillStyle = terrainGradient(context, province, visuals.layers, condition, width, height, plane.wrapX || plane.wrapY);
    context.fill();
    const metrics = measurePolygonProvinceArtwork(cell.polygons, province, plane, width, height);
    paintProvinceMaterial(context, plane, province, visuals.layers, cell.polygons, undefined, width, height, options.materialImages, materialLayouts);
    context.strokeStyle = options.selectedId === province.id ? "#f5d67c" : "rgba(15, 24, 27, .72)";
    context.lineWidth = options.selectedId === province.id ? Math.max(2, width / 900) : Math.max(0.75, width / 3400);
    context.stroke();
    drawTerrainMarks(context, plane, province, visuals.marks, metrics, cell.polygons, width, height, condition, options.detail);
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

  drawProvinceMarkers(context, plane, width, height, options);
}

interface SparsePaintMask {
  ownerPaths: Path2D[];
  combinedPath: Path2D;
}

const sparsePaintMaskCache = new WeakMap<ProvinceOwnershipModel, Map<string, SparsePaintMask>>();

/** Pixel-center ownership sampling shared by the interactive and PNG renderers. */
export function samplePlaneOwnership(
  plane: Plane,
  width: number,
  height: number,
  ownership = createProvinceOwnershipModel(plane),
): Int16Array {
  const rasterWidth = Math.max(1, Math.floor(width));
  const rasterHeight = Math.max(1, Math.floor(height));
  const owners = new Int16Array(rasterWidth * rasterHeight);
  owners.fill(-1);
  for (let y = 0; y < rasterHeight; y += 1) {
    const ny = (y + 0.5) / rasterHeight;
    for (let x = 0; x < rasterWidth; x += 1) {
      const owner = ownership.ownerAt((x + 0.5) / rasterWidth, ny);
      if (owner >= 0 && owner < plane.provinces.length) owners[y * rasterWidth + x] = owner;
    }
  }
  // Match D6M's quantized-capital guarantee at the exact exported pixel.
  plane.provinces.forEach((province, owner) => {
    const x = clamp(Math.round(province.x * (rasterWidth - 1)), 0, rasterWidth - 1);
    const y = clamp(Math.round(province.y * (rasterHeight - 1)), 0, rasterHeight - 1);
    owners[y * rasterWidth + x] = owner;
  });
  return owners;
}

/** Resolve a click through canonical ownership; owner-0 space deliberately returns nothing. */
export function provinceAtOwnershipPoint(
  plane: Plane,
  ownership: ProvinceOwnershipModel,
  x: number,
  y: number,
): Province | undefined {
  // Panning or zooming can expose canvas outside the rendered unit square.
  // Solid ownership is mathematically unbounded to support Voronoi clipping,
  // so reject that visible margin before asking for an owner.
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return undefined;
  const owner = ownership.ownerAt(x, y);
  return owner >= 0 && owner < plane.provinces.length ? plane.provinces[owner] : undefined;
}

function paintSparsePlane(
  context: CanvasRenderingContext2D,
  plane: Plane,
  topology: ProvinceTopology,
  ownership: ProvinceOwnershipModel,
  condition: PreviewCondition,
  width: number,
  height: number,
  options: { selectedId?: string; labels?: boolean; detail?: boolean; materialImages?: Map<string, HTMLImageElement>; markerAnnotations?: ReadonlyMap<string, ProvinceMarkerAnnotations> },
) {
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const layerContext = layer.getContext("2d");
  if (!layerContext) return;
  const mask = sparsePaintMask(plane, ownership, width, height);
  const materialLayouts = new Map<string, SeamlessTileLayout>();

  plane.provinces.forEach((province, owner) => {
    const path = mask.ownerPaths[owner];
    if (!path) return;
    const visuals = visualsForCondition(province, condition);
    layerContext.save();
    layerContext.clip(path);
    layerContext.fillStyle = terrainGradient(layerContext, province, visuals.layers, condition, width, height, plane.wrapX || plane.wrapY);
    layerContext.fillRect(0, 0, width, height);
    paintProvinceMaterial(layerContext, plane, province, visuals.layers, undefined, path, width, height, options.materialImages, materialLayouts);
    const metrics = measureSparseProvinceArtwork(owner, province, ownership, width, height);
    drawTerrainMarks(layerContext, plane, province, visuals.marks, metrics, undefined, width, height, condition, options.detail);
    if (options.selectedId === province.id) {
      layerContext.fillStyle = "rgba(245, 214, 124, .2)";
      layerContext.fillRect(0, 0, width, height);
    }
    layerContext.restore();
  });

  drawSparseTopologyBorders(layerContext, plane, topology, width, height);
  drawProvinceMarkers(layerContext, plane, width, height, options, mask.ownerPaths);

  // Erase every overlay pixel outside canonical owner space, including
  // antialiased borders, labels, and terrain marks around chamber edges.
  layerContext.save();
  layerContext.globalCompositeOperation = "destination-in";
  layerContext.fillStyle = "#fff";
  layerContext.fill(mask.combinedPath);
  layerContext.restore();
  context.drawImage(layer, 0, 0, width, height);
}

function sparsePaintMask(
  plane: Plane,
  ownership: ProvinceOwnershipModel,
  width: number,
  height: number,
): SparsePaintMask {
  const key = `${width}x${height}:${plane.provinces.length}`;
  const cacheable = width * height <= 1_500_000;
  const cached = sparsePaintMaskCache.get(ownership)?.get(key);
  if (cached) return cached;
  const owners = samplePlaneOwnership(plane, width, height, ownership);
  const ownerPaths = Array.from({ length: plane.provinces.length }, () => new Path2D());
  const combinedPath = new Path2D();
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let runStart = 0;
    let runOwner = owners[row] ?? -1;
    for (let x = 1; x <= width; x += 1) {
      const owner = x < width ? owners[row + x]! : -2;
      if (owner === runOwner) continue;
      if (runOwner >= 0 && runOwner < ownerPaths.length) {
        const runWidth = x - runStart;
        ownerPaths[runOwner]!.rect(runStart, y, runWidth, 1);
        combinedPath.rect(runStart, y, runWidth, 1);
      }
      runStart = x;
      runOwner = owner;
    }
  }
  const mask = { ownerPaths, combinedPath };
  if (cacheable) {
    const masks = sparsePaintMaskCache.get(ownership) ?? new Map<string, SparsePaintMask>();
    if (masks.size >= 2) masks.delete(masks.keys().next().value!);
    masks.set(key, mask);
    sparsePaintMaskCache.set(ownership, masks);
  }
  return mask;
}

function drawSparseTopologyBorders(
  context: CanvasRenderingContext2D,
  plane: Plane,
  topology: ProvinceTopology,
  width: number,
  height: number,
) {
  const edgeKind = new Map(plane.edges.map((edge) => [connectionKey(edge.a, edge.b), edge.kind]));
  context.save();
  context.lineCap = "round";
  for (const pair of topology.pairs) {
    const segments = topology.sharedBorders.get(pair.key);
    if (!segments?.length) continue;
    const style = edgeStyle(edgeKind.get(pair.key) ?? "standard");
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
}

function drawProvinceMarkers(
  context: CanvasRenderingContext2D,
  plane: Plane,
  width: number,
  height: number,
  options: { labels?: boolean; markerAnnotations?: ReadonlyMap<string, ProvinceMarkerAnnotations> },
  ownerPaths?: Path2D[],
) {
  plane.provinces.forEach((province, owner) => {
    const ownerPath = ownerPaths?.[owner];
    if (ownerPath) {
      context.save();
      context.clip(ownerPath);
    }
    const x = province.x * width;
    const y = province.y * height;
    const markerRadius = clamp(Math.min(width, height) / 270, 2.4, 7);
    const badges = provinceMarkerBadges(province, options.markerAnnotations?.get(province.id));
    context.beginPath();
    context.arc(x, y, markerRadius, 0, TAU);
    context.fillStyle = badges[0]?.color ?? "rgba(245, 238, 209, .88)";
    context.fill();
    context.lineWidth = Math.max(1, width / 3200);
    context.strokeStyle = "rgba(18, 22, 23, .86)";
    context.stroke();
    drawProvinceMarkerBadges(context, badges, x, y, markerRadius, width);
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
    if (ownerPath) context.restore();
  });
}

export function provinceMarkerBadges(province: Province, annotations?: ProvinceMarkerAnnotations): ProvinceMarkerBadge[] {
  const badges: ProvinceMarkerBadge[] = [];
  if (province.start) badges.push({ kind: "generic-start", glyph: "S", label: "generic start", color: "#f5d67c" });
  if (province.teamStart !== undefined) badges.push({ kind: "team-start", glyph: `#${province.teamStart}`, label: `team start group ${province.teamStart}`, color: "#f0bd65" });
  if (annotations?.specificStartNation !== undefined) badges.push({ kind: "specific-start", glyph: "N", label: `nation-specific start ${annotations.specificStartNation}`, color: "#ff9f70" });
  if (province.throne === "preferred") badges.push({ kind: "preferred-throne", glyph: "♜", label: "preferred throne", color: "#d5a8ff" });
  if (province.throne === "fixed") badges.push({ kind: "fixed-throne", glyph: "♛", label: "fixed throne", color: "#b993ff" });
  if (province.throne === "avoid") badges.push({ kind: "avoided-throne", glyph: "×", label: "avoid throne", color: "#89918e" });
  if (province.sites.length) badges.push({ kind: "placed-site", glyph: "✦", label: `${province.sites.length} placed magic site${province.sites.length === 1 ? "" : "s"}`, color: "#80c4b1" });
  if (province.manySites) badges.push({ kind: "many-sites", glyph: "M", label: "many-sites terrain", color: "#5eb8a2" });
  if (province.defenders.length) badges.push({ kind: "guardians", glyph: "G", label: `${province.defenders.length} guardian group${province.defenders.length === 1 ? "" : "s"}`, color: "#d28b65" });
  if (annotations?.gateNumbers?.length) badges.push({ kind: "gateway", glyph: "◎", label: `gateway endpoint ${annotations.gateNumbers.join(", ")}`, color: "#74b9da" });
  return badges;
}

function drawProvinceMarkerBadges(
  context: CanvasRenderingContext2D,
  badges: readonly ProvinceMarkerBadge[],
  x: number,
  y: number,
  markerRadius: number,
  width: number,
) {
  if (!badges.length) return;
  const radius = clamp(markerRadius * 0.82, 3.2, 5.5);
  const step = radius * 2 + 1;
  const columns = Math.min(4, badges.length);
  const rows = Math.ceil(badges.length / columns);
  badges.forEach((badge, index) => {
    const row = Math.floor(index / columns);
    const rowStart = row * columns;
    const rowCount = Math.min(columns, badges.length - rowStart);
    const column = index - rowStart;
    const badgeX = x + (column - (rowCount - 1) / 2) * step;
    const badgeY = y + (row - (rows - 1) / 2) * step;
    context.beginPath();
    context.arc(badgeX, badgeY, radius, 0, TAU);
    context.fillStyle = badge.color;
    context.fill();
    context.lineWidth = Math.max(0.8, width / 4200);
    context.strokeStyle = "rgba(18, 22, 23, .92)";
    context.stroke();
    context.fillStyle = "#181b1c";
    context.font = `800 ${badge.glyph.length > 1 ? Math.max(5.5, radius * 1.15) : Math.max(7, radius * 1.55)}px ui-sans-serif, system-ui`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(badge.glyph, badgeX, badgeY + 0.2);
  });
}

function paintProvinceMaterial(
  context: CanvasRenderingContext2D,
  plane: Plane,
  province: Province,
  terrains: readonly TerrainKey[],
  polygons: Point[][] | undefined,
  path: Path2D | undefined,
  width: number,
  height: number,
  images: Map<string, HTMLImageElement> | undefined,
  layouts: Map<string, SeamlessTileLayout>,
) {
  const sources = [...new Set(terrains.map((terrain) => UNIVERSAL_MATERIAL_ASSETS[materialFamilyForTerrain(terrain)]))];
  for (const source of sources) {
    const image = images?.get(source);
    if (!image) continue; // The mixed terrain gradient is the load-failure fallback.
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) continue;
    let layout = layouts.get(source);
    if (!layout) {
      layout = planSeamlessTiles(width, height, sourceWidth, sourceHeight, plane.wrapX, plane.wrapY);
      layouts.set(source, layout);
    }
    context.save();
    if (path) context.clip(path);
    else if (polygons) {
      drawCellPath(context, polygons, width, height);
      context.clip();
    }
    // Materials stay in one map-relative coordinate system; adjacent provinces
    // sample the same texture phase instead of each stretching a tile to fit.
    context.globalCompositeOperation = "soft-light";
    context.globalAlpha = (province.small ? 0.13 : province.large ? 0.22 : 0.18) / sources.length;
    paintSeamlessTileLayout(context, image, layout);
    context.restore();
  }
}

function paintSeamlessTileLayout(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  layout: SeamlessTileLayout,
) {
  for (const tile of layout.tiles) {
    context.save();
    context.translate(tile.x + tile.width / 2, tile.y + tile.height / 2);
    context.scale(tile.flipX ? -1 : 1, tile.flipY ? -1 : 1);
    context.drawImage(
      image,
      tile.sourceX,
      tile.sourceY,
      tile.sourceWidth,
      tile.sourceHeight,
      -tile.width / 2,
      -tile.height / 2,
      tile.width,
      tile.height,
    );
    context.restore();
  }
}

function drawTerrainMarks(
  context: CanvasRenderingContext2D,
  plane: Plane,
  province: Province,
  markKinds: readonly TerrainMarkKind[],
  metrics: ProvinceArtworkMetrics,
  polygons: Point[][] | undefined,
  width: number,
  height: number,
  condition: PreviewCondition,
  detail = true,
) {
  const placements = planTerrainMarks(metrics, markKinds, province.id, !detail ? 0.35 : province.small ? 0.65 : province.large ? 1.25 : 1);
  if (!placements.length) return;
  context.save();
  if (polygons) {
    drawCellPath(context, polygons, width, height);
    context.clip();
  }
  for (const placement of placements) {
    const mark = placement.kind;
    for (const copy of periodicArtworkCopies(placement, width, height, plane.wrapX, plane.wrapY)) {
      const x = copy.x;
      const y = copy.y;
      const radius = Math.min(copy.width, copy.height) * 0.42;
      context.globalAlpha = copy.opacity;
      context.strokeStyle = condition === "winter" ? "#f4f7ef" : "#c2c49b";
      context.fillStyle = condition === "winter" ? "#b7c8bb" : "#193d29";
      context.lineWidth = Math.max(0.45, radius * 0.18);
      if (mark === "forest") {
        context.beginPath();
        context.moveTo(x, y - radius);
        context.lineTo(x - radius * 0.68, y + radius * 0.55);
        context.lineTo(x + radius * 0.68, y + radius * 0.55);
        context.closePath();
        context.fill();
        context.stroke();
      } else if (mark === "mountain") {
        context.beginPath();
        context.moveTo(x - radius, y + radius * 0.7);
        context.lineTo(x, y - radius);
        context.lineTo(x + radius, y + radius * 0.7);
        context.stroke();
      } else if (mark === "highland") {
        context.beginPath();
        context.moveTo(x - radius, y + radius * 0.5);
        context.quadraticCurveTo(x, y - radius, x + radius, y + radius * 0.5);
        context.stroke();
      } else if (["water", "freshwater", "swamp", "deep"].includes(mark)) {
        if (condition !== "winter") context.strokeStyle = mark === "freshwater" ? "#7be6f4" : "#9dccd9";
        const rows = mark === "deep" ? 3 : mark === "freshwater" ? 2 : 1;
        for (let row = 0; row < rows; row++) {
          const waveY = y + (row - (rows - 1) / 2) * radius * 0.65;
          context.beginPath();
          context.moveTo(x - radius, waveY);
          context.quadraticCurveTo(x - radius * 0.4, waveY - radius * 0.45, x, waveY);
          context.quadraticCurveTo(x + radius * 0.4, waveY + radius * 0.45, x + radius, waveY);
          context.stroke();
        }
        if (mark === "swamp") {
          context.beginPath();
          context.moveTo(x, y + radius * 0.5);
          context.lineTo(x, y - radius);
          context.moveTo(x - radius * 0.55, y - radius * 0.8);
          context.lineTo(x, y - radius * 0.3);
          context.lineTo(x + radius * 0.55, y - radius * 0.8);
          context.stroke();
        }
      } else if (mark === "farm") {
        context.fillStyle = condition === "winter" ? "#d8dfc5" : "#dab568";
        context.strokeStyle = condition === "winter" ? "#778577" : "#674d24";
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        for (let row = -1; row <= 1; row++) {
          context.beginPath();
          context.moveTo(x - radius * 0.8, y + row * radius * 0.55);
          context.lineTo(x + radius * 0.8, y + row * radius * 0.55);
          context.stroke();
        }
      } else if (mark === "cave") {
        context.fillStyle = "#211c1b";
        context.beginPath();
        context.arc(x, y, radius, Math.PI, 0);
        context.lineTo(x + radius, y + radius * 0.7);
        context.lineTo(x - radius, y + radius * 0.7);
        context.closePath();
        context.fill();
        context.stroke();
      } else if (mark === "kelp") {
        context.strokeStyle = condition === "winter" ? "#d6e6bc" : "#a4c885";
        for (let stalk = -1; stalk <= 1; stalk++) {
          const stalkX = x + stalk * radius * 0.6;
          context.beginPath();
          context.moveTo(stalkX, y + radius);
          context.quadraticCurveTo(stalkX - radius * 0.4, y, stalkX, y - radius);
          context.stroke();
        }
      } else if (mark === "cavewall") {
        context.beginPath();
        context.moveTo(x - radius, y - radius);
        context.lineTo(x + radius, y + radius);
        context.moveTo(x - radius, y + radius);
        context.lineTo(x + radius, y - radius);
        context.stroke();
      } else if (mark === "waste") {
        context.beginPath();
        context.arc(x, y, radius * 0.52, 0, TAU);
        context.stroke();
      }
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

function mapBackgroundColor(plane: Plane, ownership: ProvinceOwnershipModel): string {
  if (ownership.mode === "sparse") return plane.kind === "underworld" || plane.kind === "abyss" ? "#101014" : "#0d1315";
  return plane.kind === "underworld" || plane.kind === "abyss" ? "#17171b" : "#183544";
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

function drawVignette(context: CanvasRenderingContext2D, width: number, height: number) {
  const gradient = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.28, width / 2, height / 2, Math.max(width, height) * 0.7);
  gradient.addColorStop(0, "rgba(8, 12, 14, 0)");
  gradient.addColorStop(1, "rgba(8, 12, 14, .42)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

const TAU = Math.PI * 2;
