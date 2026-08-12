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
  planProvinceArtwork,
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
  onNavigate: (provinceId: string) => void;
  onActivate: (provinceId: string) => void;
  onZoomChange?: (zoom: number) => void;
  tool?: string;
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

export function MapCanvas({ plane, selectedId, previewCondition, onNavigate, onActivate, onZoomChange, tool = "select" }: MapCanvasProps) {
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
  const provinceStatus = selectedProvince
    ? `Current province ${selectedProvince.index} of ${plane.provinces.length}: ${selectedProvince.name}. ${toolLabel} tool active.`
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
    paintPlane(context, plane, cells, topology, ownership, previewCondition, width, height, { selectedId, labels: view.zoom >= 1.35, detail: view.zoom >= 0.92, materialImages });
    context.restore();
    drawVignette(context, width, height);
  }, [backgroundImage, cells, materialImages, ownership, plane, previewCondition, selectedId, topology, view]);

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

export async function renderPlanePng(plane: Plane, condition: PreviewCondition): Promise<Blob> {
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
  paintPlane(context, plane, cells, topology, ownership, condition, canvas.width, canvas.height, { labels: true, detail: true, materialImages });
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
  return [...new Set(plane.provinces.map((province) => {
    const terrain = terrainPreviewKey(visualTerrainKey(province), condition);
    return UNIVERSAL_MATERIAL_ASSETS[materialFamilyForTerrain(terrain)];
  }))].sort();
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
  options: { selectedId?: string; labels?: boolean; detail?: boolean; materialImages?: Map<string, HTMLImageElement> },
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
    const terrain = terrainPreviewKey(visualTerrainKey(province), condition);
    const [primary, secondary] = colorsForCondition(TERRAIN_COLORS[terrain], condition);
    drawCellPath(context, cell.polygons, width, height);
    const gradient = context.createLinearGradient(province.x * width - width * 0.05, province.y * height - height * 0.05, province.x * width + width * 0.05, province.y * height + height * 0.05);
    gradient.addColorStop(0, primary);
    gradient.addColorStop(1, secondary);
    context.fillStyle = gradient;
    context.fill();
    const metrics = measurePolygonProvinceArtwork(cell.polygons, province, plane, width, height);
    paintProvinceMaterial(context, plane, province, terrain, cell.polygons, undefined, width, height, options.materialImages, materialLayouts);
    context.strokeStyle = options.selectedId === province.id ? "#f5d67c" : "rgba(15, 24, 27, .72)";
    context.lineWidth = options.selectedId === province.id ? Math.max(2, width / 900) : Math.max(0.75, width / 3400);
    context.stroke();
    if (options.detail) drawTerrainMarks(context, plane, province, terrain, metrics, cell.polygons, width, height, condition);
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
  options: { selectedId?: string; labels?: boolean; detail?: boolean; materialImages?: Map<string, HTMLImageElement> },
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
    const terrain = terrainPreviewKey(visualTerrainKey(province), condition);
    const [primary, secondary] = colorsForCondition(TERRAIN_COLORS[terrain], condition);
    layerContext.save();
    layerContext.clip(path);
    const gradient = layerContext.createLinearGradient(
      province.x * width - width * 0.05,
      province.y * height - height * 0.05,
      province.x * width + width * 0.05,
      province.y * height + height * 0.05,
    );
    gradient.addColorStop(0, primary);
    gradient.addColorStop(1, secondary);
    layerContext.fillStyle = gradient;
    layerContext.fillRect(0, 0, width, height);
    paintProvinceMaterial(layerContext, plane, province, terrain, undefined, path, width, height, options.materialImages, materialLayouts);
    if (options.detail) {
      const metrics = measureSparseProvinceArtwork(owner, province, ownership, width, height);
      drawTerrainMarks(layerContext, plane, province, terrain, metrics, undefined, width, height, condition);
    }
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
  options: { labels?: boolean },
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
    if (ownerPath) context.restore();
  });
}

function paintProvinceMaterial(
  context: CanvasRenderingContext2D,
  plane: Plane,
  province: Province,
  terrain: TerrainKey,
  polygons: Point[][] | undefined,
  path: Path2D | undefined,
  width: number,
  height: number,
  images: Map<string, HTMLImageElement> | undefined,
  layouts: Map<string, SeamlessTileLayout>,
) {
  const family = materialFamilyForTerrain(terrain);
  const source = UNIVERSAL_MATERIAL_ASSETS[family];
  const image = images?.get(source);
  if (!image) return; // The terrain gradient is the guaranteed load-failure fallback.
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return;
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
  context.globalAlpha = province.small ? 0.13 : province.large ? 0.22 : 0.18;
  paintSeamlessTileLayout(context, image, layout);
  context.restore();
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
  terrain: TerrainKey,
  metrics: ProvinceArtworkMetrics,
  polygons: Point[][] | undefined,
  width: number,
  height: number,
  condition: PreviewCondition,
) {
  const flags = effectiveProvinceTerrainFlags(province);
  const markKinds: Array<"forest" | "mountain" | "water" | "farm" | "waste"> = [];
  if (flags.has("forest") || ["forest", "caveforest", "kelp"].includes(terrain)) markKinds.push("forest");
  if (flags.has("highland") || flags.has("mountains") || ["highland", "mountains", "cavehighland"].includes(terrain)) markKinds.push("mountain");
  if (flags.has("sea") || flags.has("freshwater") || flags.has("swamp") || isWaterTerrain(terrain) || terrain.includes("swamp")) markKinds.push("water");
  if (flags.has("farm") || terrain === "farm") markKinds.push("farm");
  if (flags.has("waste") || terrain.includes("waste")) markKinds.push("waste");
  if (!markKinds.length) return;
  const plan = planProvinceArtwork(metrics, {
    id: `procedural-terrain-${markKinds.join("-")}`,
    minAreaReferencePx2: 120,
    minInscribedRadiusReferencePx: 3.5,
    maxAspectRatio: 3.8,
    safeInsetRatio: 0.2,
    nominalSizeReferencePx: 10,
    density: province.small ? 0.65 : province.large ? 1.25 : 1,
    rotation: "free",
    mirroring: "both",
    fallback: "micro",
  }, province.id);
  if (!plan.placements.length) return;
  context.save();
  if (polygons) {
    drawCellPath(context, polygons, width, height);
    context.clip();
  }
  let markIndex = 0;
  for (const placement of plan.placements) {
    for (const copy of periodicArtworkCopies(placement, width, height, plane.wrapX, plane.wrapY)) {
      const x = copy.x;
      const y = copy.y;
      const radius = Math.max(1.25, Math.min(copy.width, copy.height) * 0.36);
      context.globalAlpha = 0.23;
      context.strokeStyle = condition === "winter" ? "#f4f7ef" : "#172b25";
      context.fillStyle = condition === "winter" ? "#e7eee7" : "#1d352c";
      context.lineWidth = Math.max(0.65, radius * 0.18);
      const mark = markKinds[markIndex % markKinds.length]!;
      if (mark === "forest") {
        context.beginPath();
        context.moveTo(x, y - radius);
        context.lineTo(x - radius * 0.68, y + radius * 0.55);
        context.lineTo(x + radius * 0.68, y + radius * 0.55);
        context.closePath();
        context.fill();
      } else if (mark === "mountain") {
        context.beginPath();
        context.moveTo(x - radius, y + radius * 0.7);
        context.lineTo(x, y - radius);
        context.lineTo(x + radius, y + radius * 0.7);
        context.stroke();
      } else if (mark === "water") {
        if (condition !== "winter" && flags.has("freshwater") && !flags.has("sea")) {
          context.globalAlpha = 0.42;
          context.strokeStyle = "#63b5ce";
        }
        context.beginPath();
        context.moveTo(x - radius, y);
        context.quadraticCurveTo(x - radius * 0.4, y - radius * 0.45, x, y);
        context.quadraticCurveTo(x + radius * 0.4, y + radius * 0.45, x + radius, y);
        context.stroke();
      } else if (mark === "farm") {
        context.beginPath();
        context.moveTo(x - radius, y - radius);
        context.lineTo(x + radius, y + radius);
        context.moveTo(x, y - radius);
        context.lineTo(x + radius, y);
        context.stroke();
      } else if (mark === "waste") {
        context.beginPath();
        context.arc(x, y, radius * 0.52, 0, TAU);
        context.stroke();
      }
      markIndex += 1;
    }
  }
  context.restore();
}

function visualTerrainKey(province: Province): TerrainKey {
  const flags = effectiveProvinceTerrainFlags(province);
  if (flags.has("cavewall")) return "cavewall";
  if (flags.has("sea")) {
    if (flags.has("deep")) return "deepsea";
    if (flags.has("forest")) return "kelp";
    return "sea";
  }
  if (flags.has("cave")) {
    if (flags.has("forest")) return "caveforest";
    if (flags.has("swamp")) return "caveswamp";
    if (flags.has("waste")) return "cavewaste";
    if (flags.has("mountains") || flags.has("highland")) return "cavehighland";
    return "cave";
  }
  if (province.terrain !== "plains" && province.terrain !== "freshwater") return province.terrain;
  if (flags.has("mountains")) return "mountains";
  if (flags.has("highland")) return "highland";
  if (flags.has("forest")) return "forest";
  if (flags.has("swamp")) return "swamp";
  if (flags.has("waste")) return "waste";
  if (flags.has("farm")) return "farm";
  return "plains";
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
