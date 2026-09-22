"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  effectiveProvinceTerrainFlags,
  isWaterTerrain,
  planeGenerationKey,
  type Plane,
  type PreviewCondition,
  type Province,
  type TerrainKey,
} from "./domain";
import { previewProvinceTerrain, provinceTerrainVisuals, winterPreviewStrength, type TerrainMarkKind } from "./terrainVisuals";
import { renderSkyRgb, skyVariantForPreview } from "./skyArt";
import { isRealmArtworkKind, renderRealmRgb } from "./realmArt";
import { borderStyles } from "./edgeVisuals";
import { fitMapFrame, placeMapLabel, provinceBadgeRadius, screenToMapPoint, type LabelBox } from "./mapView";
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
  /** Editor-only analysis overlay; deliberately omitted from exported PNGs and D6M. */
  analysisProvinceIds?: ReadonlySet<string>;
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

export function MapCanvas({ plane, selectedId, previewCondition, markerAnnotations, analysisProvinceIds, onNavigate, onActivate, onZoomChange, tool = "select" }: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const keyboardHelpId = useId();
  const provinceStatusId = useId();
  const currentOptionId = useId();
  const dragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const keyboardActionSerial = useRef(0);
  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 });
  const [keyboardAction, setKeyboardAction] = useState<{ provinceId: string; tool: string; message: string }>();
  const [hoveredId, setHoveredId] = useState<string>();
  const topology = useMemo(() => computeProvinceTopology(plane), [plane]);
  const ownership = useMemo(() => createProvinceOwnershipModel(plane), [plane]);
  const cells = useMemo(() => ownership.mode === "solid" ? topology.cells : [], [ownership.mode, topology]);
  const backgroundAsset = useMemo(() => usesProceduralArtwork(plane) ? undefined : planeBackgroundAsset(plane, ownership), [ownership, plane]);
  const [loadedBackground, setLoadedBackground] = useState<{ source: string; image: HTMLImageElement }>();
  const backgroundImage = loadedBackground && loadedBackground.source === backgroundAsset ? loadedBackground.image : undefined;
  const materialSources = useMemo(() => usesProceduralArtwork(plane) ? [] : planeMaterialAssets(plane, previewCondition), [plane, previewCondition]);
  const materialSignature = materialSources.join("|");
  const [loadedMaterials, setLoadedMaterials] = useState<{ signature: string; images: Map<string, HTMLImageElement> }>();
  const materialImages = loadedMaterials?.signature === materialSignature ? loadedMaterials.images : undefined;
  const selectedProvince = plane.provinces.find((province) => province.id === selectedId);
  const hoverProvince = plane.provinces.find((province) => province.id === hoveredId);
  const readableProvince = hoverProvince ?? selectedProvince;
  const readableBadges = readableProvince ? provinceMarkerBadges(readableProvince, markerAnnotations?.get(readableProvince.id)) : [];
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

  const wheelStateRef = useRef({ zoom: view.zoom, onZoomChange });
  useEffect(() => { wheelStateRef.current = { zoom: view.zoom, onZoomChange }; }, [onZoomChange, view.zoom]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // React attaches wheel listeners as passive, where preventDefault is
    // ignored and the page scrolls or pinch-zooms along with the map.
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = wheelStateRef.current;
      const nextZoom = clamp(state.zoom * Math.exp(-event.deltaY * 0.001), 0.78, 4);
      state.zoom = nextZoom;
      setView((current) => ({ ...current, zoom: nextZoom }));
      state.onZoomChange?.(nextZoom);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  const drawnSizeRef = useRef<{ width: number; height: number } | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const bounds = wrapper.getBoundingClientRect();
    const width = Math.max(1, Math.floor(bounds.width));
    const height = Math.max(1, Math.floor(bounds.height));
    const frame = fitMapFrame(plane, width, height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    drawnSizeRef.current = { width, height };
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = mapBackgroundColor(plane, ownership);
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(width / 2 + view.panX, height / 2 + view.panY);
    context.scale(view.zoom, view.zoom);
    context.translate(-frame.width / 2, -frame.height / 2);
    context.fillStyle = mapBackgroundColor(plane, ownership);
    context.fillRect(0, 0, frame.width, frame.height);
    if (backgroundImage) paintRealmBackground(context, backgroundImage, frame.width, frame.height, plane);
    paintPlane(context, plane, cells, topology, ownership, previewCondition, frame.width, frame.height, { selectedId, labels: view.zoom >= 1.35, detail: view.zoom >= 0.92, materialImages, markerAnnotations, analysisProvinceIds, screenScale: view.zoom });
    context.restore();
    drawVignette(context, width, height);
  }, [analysisProvinceIds, backgroundImage, cells, markerAnnotations, materialImages, ownership, plane, previewCondition, selectedId, topology, view]);

  // Repaint once per change. Bursts of pan/zoom/hover updates coalesce into one
  // paint per animation frame, always with the newest `draw`. A per-draw
  // ResizeObserver used to repaint again on its initial notification, so every
  // pan, zoom, edit and selection drew twice; one long-lived observer now
  // repaints only when the wrapper's drawn size actually changes.
  const drawRef = useRef(draw);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const drawNow = () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
      drawRef.current();
    };
    // Resizes paint synchronously (before the browser presents the frame) so
    // the canvas never shows a stale size.
    const observer = new ResizeObserver(() => {
      if (!wrapper) return;
      const bounds = wrapper.getBoundingClientRect();
      const drawn = drawnSizeRef.current;
      if (drawn && drawn.width === Math.max(1, Math.floor(bounds.width)) && drawn.height === Math.max(1, Math.floor(bounds.height))) return;
      drawNow();
    });
    if (wrapper) observer.observe(wrapper);
    return () => {
      observer.disconnect();
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    };
  }, []);
  useEffect(() => {
    drawRef.current = draw;
    if (frameRef.current !== undefined) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined;
      drawRef.current();
    });
  }, [draw]);

  const screenToWorld = (clientX: number, clientY: number) => {
    const bounds = canvasRef.current!.getBoundingClientRect();
    const sx = clientX - bounds.left;
    const sy = clientY - bounds.top;
    return screenToMapPoint(plane, bounds.width, bounds.height, view, sx, sy);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
    wrapperRef.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY, moved: false };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      const point = screenToWorld(event.clientX, event.clientY);
      setHoveredId(provinceAtOwnershipPoint(plane, ownership, point.x, point.y)?.id);
      return;
    }
    if (drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) setView((current) => ({ ...current, panX: drag.panX + dx, panY: drag.panY + dy }));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const moved = drag.moved || Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 4;
    if (event.isPrimary && event.button === 0 && !moved) {
      const point = screenToWorld(event.clientX, event.clientY);
      const province = provinceAtOwnershipPoint(plane, ownership, point.x, point.y);
      if (province) {
        setKeyboardAction(undefined);
        onActivate(province.id);
      }
    }
  };

  const cancelPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
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
          onPointerLeave={() => setHoveredId(undefined)}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancelPointer}
          onLostPointerCapture={cancelPointer}
          title={readableProvince ? `${readableProvince.index}. ${readableProvince.name}${readableBadges.length ? ` — ${readableBadges.map(badge => badge.label).join("; ")}` : ""}` : undefined}
        />
        {readableProvince && <div className="map-province-summary" aria-hidden="true">
          <strong>{readableProvince.index}. {readableProvince.name}</strong>
          {readableBadges.length > 0 && <span>{readableBadges.map(badge => badge.label).join(" · ")}</span>}
        </div>}
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
  // Procedural realm painting is opaque and self-contained; loading raster assets
  // underneath it only delays export and adds redundant network requests.
  const procedural = usesProceduralArtwork(plane);
  const backgroundImage = await loadPlaneBackground(procedural ? undefined : planeBackgroundAsset(plane, ownership));
  if (backgroundImage) paintRealmBackground(context, backgroundImage, canvas.width, canvas.height, plane);
  const materialImages = await loadArtworkImages(procedural ? [] : planeMaterialAssets(plane, condition));
  const topology = computeProvinceTopology(plane);
  const cells = ownership.mode === "solid" ? topology.cells : [];
  paintPlane(context, plane, cells, topology, ownership, condition, canvas.width, canvas.height, { labels: true, detail: true, materialImages, markerAnnotations, transientMasks: true });
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
  return provinceTerrainVisuals(province, condition);
}

function terrainGradient(context: CanvasRenderingContext2D, plane: Plane, province: Province, layers: readonly TerrainKey[], condition: PreviewCondition, width: number, height: number, periodic: boolean) {
  const gradient = context.createLinearGradient(province.x * width - width * 0.05, province.y * height - height * 0.05, province.x * width + width * 0.05, province.y * height + height * 0.05);
  const base = layers[0]!;
  const colors = layers.flatMap((terrain) => {
    let palette = TERRAIN_COLORS[terrain];
    // Mountain relief in a sea is still submerged; a mixed wall stays blocked.
    const tint = base === "cavewall" ? 0.8 : isWaterTerrain(base) && !isWaterTerrain(terrain) ? 0.64 : 0;
    if (tint) palette = [mix(palette[0], TERRAIN_COLORS[base][0], tint), mix(palette[1], TERRAIN_COLORS[base][1], tint)];
    return colorsForCondition(palette, condition === "winter" ? winterPreviewStrength(plane, province) : 0);
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
  plane: Pick<Plane, "kind" | "wrapX" | "wrapY">,
) {
  const { wrapX, wrapY } = plane;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return;
  if (wrapX || wrapY) {
    context.save();
    context.globalAlpha = realmBackgroundOpacity(plane.kind);
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
  context.globalAlpha = realmBackgroundOpacity(plane.kind);
  context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
  context.globalAlpha = 1;
  context.fillStyle = "rgba(4, 8, 10, .34)";
  context.fillRect(0, 0, width, height);
  context.restore();
}

/** Keep underground negative space subordinate to the playable floor. */
export function realmBackgroundOpacity(kind: Plane["kind"]): number {
  if (kind === "cave" || kind === "cavern") return 0.32;
  if (kind === "underworld" || kind === "hell" || kind === "abyss") return 0.36;
  return 0.58;
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
  options: { selectedId?: string; labels?: boolean; detail?: boolean; materialImages?: Map<string, HTMLImageElement>; markerAnnotations?: ReadonlyMap<string, ProvinceMarkerAnnotations>; analysisProvinceIds?: ReadonlySet<string>; screenScale?: number; transientMasks?: boolean },
) {
  if (usesProceduralArtwork(plane)
    && paintProceduralPlane(context, plane, topology, ownership, condition, width, height, options)) return;
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
    context.fillStyle = terrainGradient(context, plane, province, visuals.layers, condition, width, height, plane.wrapX || plane.wrapY);
    context.fill();
    const metrics = measurePolygonProvinceArtwork(cell.polygons, province, plane, width, height);
    paintProvinceMaterial(context, plane, province, visuals.layers, cell.polygons, undefined, width, height, options.materialImages, materialLayouts);
    if (options.analysisProvinceIds?.has(province.id)) {
      drawCellPath(context, cell.polygons, width, height);
      context.fillStyle = "rgba(80, 205, 189, .28)";
      context.fill();
    }
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
    for (const style of borderStyles(edge)) {
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
  }
  context.setLineDash([]);
  context.restore();

  drawProvinceMarkers(context, plane, width, height, options);
}

interface SparsePaintMask {
  ownerPaths: Path2D[];
  combinedPath: Path2D;
}

// Keep only the current procedural preview: zooming and selection must not repeatedly
// allocate native-size rasters or retain an atlas worth of large canvases.
let proceduralPreviewCache: { key: string; ownership: ProvinceOwnershipModel; width: number; height: number; canvas: HTMLCanvasElement } | undefined;

/** Invalid/unfinished drafts retain the existing canvas renderer instead of throwing. */
export function proceduralPreviewSize(plane: Pick<Plane, "width" | "height">, width: number, height: number): { width: number; height: number } | undefined {
  if (!canRenderPlanePreview(plane) || plane.width < 256 || plane.height < 256 || plane.width > 3840 || plane.height > 3840
    || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  const scale = Math.min(1, Math.max(256 / Math.min(plane.width, plane.height), width / plane.width, height / plane.height));
  return { width: Math.max(256, Math.round(plane.width * scale)), height: Math.max(256, Math.round(plane.height * scale)) };
}

/** Compatibility name for callers of the original sky-only sizing helper. */
export const skyPreviewSize = proceduralPreviewSize;

function usesProceduralArtwork(plane: Plane): boolean {
  return (plane.kind === "cloud" || plane.kind === "air" || isRealmArtworkKind(plane.kind))
    && !!proceduralPreviewSize(plane, plane.width, plane.height);
}

function proceduralPreviewKey(plane: Plane, condition: PreviewCondition): string {
  // Do not rely on object identity: imported drafts and library callers may edit
  // in place. Names and markers are drawn separately and need no raster rebuild.
  return JSON.stringify([planeGenerationKey(plane), plane.kind, plane.variant, plane.wrapX, plane.wrapY, condition,
    plane.provinces.map(province => [province.id, [...effectiveProvinceTerrainFlags(province)].sort(), province.warmer, province.colder])]);
}

function paintProceduralPlane(
  context: CanvasRenderingContext2D, plane: Plane, topology: ProvinceTopology,
  ownership: ProvinceOwnershipModel, condition: PreviewCondition, width: number, height: number,
  options: { selectedId?: string; labels?: boolean; markerAnnotations?: ReadonlyMap<string, ProvinceMarkerAnnotations>; analysisProvinceIds?: ReadonlySet<string>; screenScale?: number; transientMasks?: boolean },
): boolean {
  // Raster at display density for interactive use and full density for PNGs.
  const size = proceduralPreviewSize(plane, width, height);
  if (!size) return false;
  const { width: rasterWidth, height: rasterHeight } = size;
  const key = proceduralPreviewKey(plane, condition);
  let rasterOwners: Int16Array | undefined;
  if (!proceduralPreviewCache || proceduralPreviewCache.key !== key || proceduralPreviewCache.ownership !== ownership
    || proceduralPreviewCache.width !== rasterWidth || proceduralPreviewCache.height !== rasterHeight) {
    const canvas = document.createElement("canvas");
    canvas.width = rasterWidth; canvas.height = rasterHeight;
    const rasterContext = canvas.getContext("2d");
    if (!rasterContext) return false;
    const displayed: Plane = { ...plane, width: rasterWidth, height: rasterHeight,
      provinces: plane.provinces.map(province => ({ ...province, ...previewProvinceTerrain(province, condition) })) };
    const owners = samplePlaneOwnership(plane, rasterWidth, rasterHeight, ownership);
    rasterOwners = owners;
    const rgb = plane.kind === "cloud" || plane.kind === "air"
      ? renderSkyRgb(displayed, owners, skyVariantForPreview(condition), `${planeGenerationKey(plane)}:sky-art`)
      : renderRealmRgb(displayed, owners, `${planeGenerationKey(plane)}:realm-art`);
    const pixels = rasterContext.createImageData(rasterWidth, rasterHeight);
    for (let i = 0; i < owners.length; i += 1) {
      pixels.data[i * 4] = rgb[i * 3]!;
      pixels.data[i * 4 + 1] = rgb[i * 3 + 1]!;
      pixels.data[i * 4 + 2] = rgb[i * 3 + 2]!;
      pixels.data[i * 4 + 3] = 255;
    }
    rasterContext.putImageData(pixels, 0, 0);
    proceduralPreviewCache = { key, ownership, width: rasterWidth, height: rasterHeight, canvas };
  }
  context.drawImage(proceduralPreviewCache.canvas, 0, 0, width, height);
  const maskWidth = Math.max(1, Math.round(width));
  const maskHeight = Math.max(1, Math.round(height));
  // Same integer size means the raster already sampled these exact pixel centres.
  const mask = sparsePaintMask(plane, ownership, maskWidth, maskHeight, options.transientMasks,
    rasterWidth === maskWidth && rasterHeight === maskHeight ? rasterOwners : undefined);
  context.save();
  context.scale(width / maskWidth, height / maskHeight);
  plane.provinces.forEach((province, index) => {
    const path = mask.ownerPaths[index];
    if (!path) return;
    if (options.analysisProvinceIds?.has(province.id)) { context.fillStyle = "rgba(80, 205, 189, .28)"; context.fill(path); }
    if (options.selectedId === province.id) { context.fillStyle = "rgba(245, 214, 124, .22)"; context.fill(path); }
  });
  // The clip and overlays must share the same integer-raster-to-display scale.
  // Restore display coordinates only after establishing the transformed clip.
  context.clip(mask.combinedPath);
  context.scale(maskWidth / width, maskHeight / height);
  drawSparseTopologyBorders(context, plane, topology, width, height);
  context.restore();
  drawProvinceMarkers(context, plane, width, height, options);
  return true;
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
  options: { selectedId?: string; labels?: boolean; detail?: boolean; materialImages?: Map<string, HTMLImageElement>; markerAnnotations?: ReadonlyMap<string, ProvinceMarkerAnnotations>; analysisProvinceIds?: ReadonlySet<string>; screenScale?: number; transientMasks?: boolean },
) {
  const displayWidth = width;
  const displayHeight = height;
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const layerContext = layer.getContext("2d");
  if (!layerContext) return;
  const mask = sparsePaintMask(plane, ownership, width, height, options.transientMasks);
  const materialLayouts = new Map<string, SeamlessTileLayout>();

  plane.provinces.forEach((province, owner) => {
    const path = mask.ownerPaths[owner];
    if (!path) return;
    const visuals = visualsForCondition(province, condition);
    layerContext.save();
    layerContext.clip(path);
    layerContext.fillStyle = terrainGradient(layerContext, plane, province, visuals.layers, condition, width, height, plane.wrapX || plane.wrapY);
    layerContext.fillRect(0, 0, width, height);
    paintProvinceMaterial(layerContext, plane, province, visuals.layers, undefined, path, width, height, options.materialImages, materialLayouts);
    const metrics = measureSparseProvinceArtwork(owner, province, ownership, width, height);
    drawTerrainMarks(layerContext, plane, province, visuals.marks, metrics, undefined, width, height, condition, options.detail);
    if (options.analysisProvinceIds?.has(province.id)) {
      layerContext.fillStyle = "rgba(80, 205, 189, .28)";
      layerContext.fillRect(0, 0, width, height);
    }
    if (options.selectedId === province.id) {
      layerContext.fillStyle = "rgba(245, 214, 124, .2)";
      layerContext.fillRect(0, 0, width, height);
    }
    layerContext.restore();
  });

  drawSparseTopologyBorders(layerContext, plane, topology, width, height);
  // Only geographic artwork is clipped. Semantic labels/markers are painted
  // afterward, so narrow chambers cannot crop names or gateway badges.
  layerContext.save();
  layerContext.globalCompositeOperation = "destination-in";
  layerContext.fillStyle = "#fff";
  layerContext.fill(mask.combinedPath);
  layerContext.restore();
  context.drawImage(layer, 0, 0, displayWidth, displayHeight);
  drawProvinceMarkers(context, plane, displayWidth, displayHeight, options);
}

/**
 * Interactive masks are always cached: a 2560-pixel-wide window already exceeds
 * 1.5 MP, and resampling on every pan/zoom repaint dominated sparse planes. At
 * most two sizes per ownership model bound the memory. One-off PNG exports
 * (`transient`) keep the former rule so native-size masks are not pinned.
 * `owners` may supply an existing samplePlaneOwnership(plane, width, height) raster.
 */
function sparsePaintMask(
  plane: Plane,
  ownership: ProvinceOwnershipModel,
  width: number,
  height: number,
  transient = false,
  owners?: Int16Array,
): SparsePaintMask {
  const key = `${width}x${height}:${plane.provinces.length}`;
  const cacheable = !transient || width * height <= 1_500_000;
  const cached = sparsePaintMaskCache.get(ownership)?.get(key);
  if (cached) return cached;
  const mask = buildSparsePaintMask(owners ?? samplePlaneOwnership(plane, width, height, ownership), plane.provinces.length, width, height);
  if (cacheable) {
    const masks = sparsePaintMaskCache.get(ownership) ?? new Map<string, SparsePaintMask>();
    if (masks.size >= 2) masks.delete(masks.keys().next().value!);
    masks.set(key, mask);
    sparsePaintMaskCache.set(ownership, masks);
  }
  return mask;
}

/** Scanline runs of a width×height owner raster as per-owner and combined clip paths. */
function buildSparsePaintMask(owners: Int16Array, ownerCount: number, width: number, height: number): SparsePaintMask {
  const ownerPaths = Array.from({ length: ownerCount }, () => new Path2D());
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
  return { ownerPaths, combinedPath };
}

function drawSparseTopologyBorders(
  context: CanvasRenderingContext2D,
  plane: Plane,
  topology: ProvinceTopology,
  width: number,
  height: number,
) {
  const edges = new Map(plane.edges.map((edge) => [connectionKey(edge.a, edge.b), edge]));
  context.save();
  context.lineCap = "round";
  for (const pair of topology.pairs) {
    const segments = topology.sharedBorders.get(pair.key);
    if (!segments?.length) continue;
    for (const style of borderStyles(edges.get(pair.key))) {
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
  }
  context.setLineDash([]);
  context.restore();
}

function drawProvinceMarkers(
  context: CanvasRenderingContext2D,
  plane: Plane,
  width: number,
  height: number,
  options: { labels?: boolean; selectedId?: string; markerAnnotations?: ReadonlyMap<string, ProvinceMarkerAnnotations>; screenScale?: number },
) {
  const occupied: LabelBox[] = [];
  const badgeRadius = provinceBadgeRadius(width, options.screenScale);
  const markerRadius = clamp(Math.min(width, height) / 270, 2.4, 7);
  plane.provinces.forEach((province) => {
    const x = province.x * width;
    const y = province.y * height;
    const badges = provinceMarkerBadges(province, options.markerAnnotations?.get(province.id));
    context.beginPath();
    context.arc(x, y, markerRadius, 0, TAU);
    context.fillStyle = badges[0]?.color ?? "rgba(245, 238, 209, .88)";
    context.fill();
    context.lineWidth = Math.max(1, width / 3200);
    context.strokeStyle = "rgba(18, 22, 23, .86)";
    context.stroke();
    drawProvinceMarkerBadges(context, badges, x, y, badgeRadius, width);
    const w = badges.length ? Math.min(4, badges.length) * (badgeRadius * 2 + 1) : markerRadius * 2;
    const h = badges.length ? Math.ceil(badges.length / 4) * (badgeRadius * 2 + 1) : markerRadius * 2;
    occupied.push({ x: x - w / 2, y: y - h / 2, width: w, height: h });
  });
  if (!options.labels) return;
  const screenScale = options.screenScale ?? 1;
  const fontSize = clamp(width * screenScale / 230, 11, 18) / screenScale;
  context.font = `600 ${fontSize}px ui-sans-serif, system-ui`;
  context.textAlign = "left";
  context.textBaseline = "top";
  context.lineWidth = Math.max(2, width / 1400);
  context.strokeStyle = "rgba(16, 19, 20, .92)";
  context.fillStyle = "rgba(250, 245, 225, .98)";
  const ordered = [...plane.provinces].sort((a, b) => Number(b.id === options.selectedId) - Number(a.id === options.selectedId));
  for (const province of ordered) {
    const textWidth = context.measureText?.(province.name).width ?? province.name.length * fontSize * 0.6;
    const box = placeMapLabel(province.x * width, province.y * height, textWidth, fontSize + 2, badgeRadius * 2 + 3, width, height, occupied);
    if (!box) continue; // Full names and all badges remain in hover/selection text.
    occupied.push(box);
    context.strokeText(province.name, box.x, box.y);
    context.fillText(province.name, box.x, box.y);
  }
}

export function provinceMarkerBadges(province: Province, annotations?: ProvinceMarkerAnnotations): ProvinceMarkerBadge[] {
  const badges: ProvinceMarkerBadge[] = [];
  if (province.start) badges.push({ kind: "generic-start", glyph: "S", label: "generic start", color: "#f5d67c" });
  if (province.teamStart !== undefined) badges.push({ kind: "team-start", glyph: "#", label: `team start group ${province.teamStart}`, color: "#f0bd65" });
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
  radius: number,
  width: number,
) {
  if (!badges.length) return;
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
    context.font = `800 ${radius * 1.65}px ui-sans-serif, system-ui`;
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
  const winter = condition === "winter" ? winterPreviewStrength(plane, province) : 0;
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
      context.strokeStyle = mix("#c2c49b", "#f4f7ef", winter);
      context.fillStyle = mix("#193d29", "#b7c8bb", winter);
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
        context.strokeStyle = mix(mark === "freshwater" ? "#7be6f4" : "#9dccd9", "#f4f7ef", winter);
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
        context.fillStyle = mix("#dab568", "#d8dfc5", winter);
        context.strokeStyle = mix("#674d24", "#778577", winter);
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
        context.strokeStyle = mix("#a4c885", "#d6e6bc", winter);
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

function colorsForCondition(colors: [string, string], winter: number): [string, string] {
  if (winter) return [mix(colors[0], "#e8eee8", 0.58 * winter), mix(colors[1], "#cdd9d5", 0.46 * winter)];
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
