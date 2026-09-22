"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  BIOME_LABELS,
  MAGIC_PATH_LABELS,
  MAX_PLANES,
  RESOLUTION_PRESETS,
  TERRAIN_FLAGS,
  TERRAIN_LABELS,
  cloneProject,
  effectiveProvinceTerrainFlags,
  prepareProvinceForPlayerStart,
  sanitizeMapName,
  setNationSpecificStart,
  type BiomeKey,
  type ComputerPlayer,
  type EdgeKind,
  type EconomyBalanceMode,
  type GateLink,
  type GateLayout,
  type GenerationSettings,
  type MagicPath,
  type MapProject,
  type OceanLayout,
  type OverlandTopologyMode,
  type Plane,
  type PlaneConnectionRule,
  type PlaneKind,
  type PlaneVariant,
  type PreviewCondition,
  type Province,
  type StartDistribution,
  type StartType,
  type TerrainKey,
  type TerrainFlag,
  type ValidationIssue,
} from "./domain";
import {
  addPlane,
  applyResolution,
  calculateFairness,
  createDefaultPlaneConnections,
  createDefaultProject,
  defaultPlaneName,
  gateCompatibility,
  hashString,
  ISLAND_CHAIN_MIN_WATER_PERCENT,
  normalizeEconomyBalanceMode,
  normalizeOverlandTopologyMode,
  preflightAuthoredStartNotices,
  preflightStartPlan,
  removeGeneratedCaveSpecificStarts,
  synchronizePlaneEdges,
} from "./generator";
import { ADVANCED_COMMANDS, terrainMask, validateProject } from "./dom6";
import { setBorderKind } from "./edgeVisuals";
import { auditPlaneTopology, canAuthorPlaneEdge, connectionKey, resolvePlaneOwnershipMode, usesConnectedRegions } from "./geometry";
import { regenerateAllProvinceNames, regenerateGeneratedProvinceNames } from "./naming";
import { createFreshProject, createProjectImportGuard, prepareProjectForOpening, randomSeed } from "./projectSession";
import { createCatalogImportSession } from "./catalog/importSession";
import { assertProjectLocks, pruneAuthoringRegions } from "./authoringLocks";
import { connectedRegionLayoutNotice } from "./connectedRegions";
import { illustratedExportError, type ExportArtwork } from "./illustratedMap";
import {
  downloadPackage,
  downloadProject,
  estimatedPackageBytes,
  installPackage,
  MAX_PROJECT_IMPORT_BYTES,
  MAX_IMPORTED_STRING_LENGTH,
  MAX_IMPORTED_DIRECTIVE_LENGTH,
  parseProject,
  serializeProject,
  zipPackageSafety,
  type ExportProgress,
} from "./export";
import {
  isGenerationAbort,
  startProjectGeneration,
  type GenerationWorkerProgress,
  type ProjectGenerationTask,
} from "./generationWorker";
import { MapCanvas, canRenderPlanePreview, renderPlanePng, type ProvinceMarkerAnnotations } from "./MapCanvas";
import { GenerationPlanSummary, ProvinceExplorer, StartBalancePanel } from "./WorkbenchPanels";
import { IterationPanel } from "./IterationPanel";
import { PlanePreferencesPanel } from "./PlanePreferencesPanel";
import { PopulationDefensePanel, PopulationDefenseProvinceStatus } from "./PopulationDefensePanel";
import { buildInitialDefensePlan } from "./populationDefenders";
import { VERIFIED_POPULATION_DEFENSE_PROFILES } from "./populationDefenseProfiles";
import { recordGenerationInputs, type AnalysisMode, type ProvinceReference } from "./workbench";
import { CatalogCombobox } from "./catalog/CatalogCombobox";
import { BoundedNumberInput, ItemListInput } from "./EditorInputs";
import {
  BUILTIN_DOM6_CATALOG,
  commanderUnitEntries,
  createCatalogTemplate,
  findCatalogEntry,
  formatCatalogEntry,
  mergeCatalogBundles,
  parseCatalogBundle,
  provinceSiteEntries,
  selectableUnitEntries,
  siteCompatibility,
  troopUnitEntries,
  type CatalogEntry,
  type Dom6CatalogBundle,
} from "./catalog";
import {
  gateEndpointIsUsed,
  gateNumberIsAvailable,
  gatesTouchingPlane,
  provinceAtLocalIndex,
  withoutPlaneGateEndpoints,
} from "./gatewayEditor";
import { loadProjectAutosave, saveProjectAutosave, type AutosaveRevision, type AutosaveState } from "./autosave";
import {
  appendHistorySnapshot,
  applyAdditionalTerrainFlag,
  applyPrimaryTerrain,
  armedEndpointCopy,
  atlasReplacementImpact,
  atlasReplacementNeedsConfirmation,
  planeRemovalImpact,
  textEditHistoryStep,
  type AtlasReplacementImpact,
  type PlaneRemovalImpact,
} from "./uiWorkflow";

type Tool = "select" | "link" | "gate" | "start" | "throne" | "site";
type InspectorTab = "terrain" | "gameplay" | "sites" | "advanced";
type LeftTab = "generate" | "planes" | "scenario" | "iterate";
type DestructiveConfirmation =
  | { kind: "new-atlas" }
  | { kind: "generate"; impact: AtlasReplacementImpact }
  | { kind: "remove-plane"; planeId: string; impact: PlaneRemovalImpact };
export type ActionErrorKind = "catalog-import" | "project-import" | "project-edit" | "package-export" | "preview-export" | "device-save";
export interface ActionErrorNotice {
  kind: ActionErrorKind;
  message: string;
  sequence: number;
  title: string;
}
const INSPECTOR_TABS: readonly InspectorTab[] = ["terrain", "gameplay", "sites", "advanced"];
const LEFT_TABS: readonly LeftTab[] = ["generate", "planes", "scenario", "iterate"];

const ACTION_ERROR_TITLES: Record<ActionErrorKind, string> = {
  "catalog-import": "Catalog could not be imported",
  "project-import": "Project could not be opened",
  "project-edit": "This edit could not be applied",
  "package-export": "Map package could not be exported",
  "preview-export": "Preview could not be exported",
  "device-save": "Project could not be saved",
};

const CATALOG_STORAGE_KEY = "pantokrator-atlas-user-catalog-v1";
export const MAX_CUSTOM_CATALOG_IMPORT_BYTES = 8 * 1024 * 1024;

type BrowserTextImport = Pick<File, "size" | "text">;

export function createActionErrorNotice(
  kind: ActionErrorKind,
  sequence: number,
  error: unknown,
  fallbackMessage: string,
): ActionErrorNotice {
  const candidate = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
        ? error.message
        : "";
  return {
    kind,
    message: candidate.trim() || fallbackMessage,
    sequence,
    title: ACTION_ERROR_TITLES[kind],
  };
}

export function ActionErrorAlert({ error, onDismiss }: { error: ActionErrorNotice; onDismiss: () => void }) {
  const titleId = `action-error-${error.sequence}-title`;
  const messageId = `action-error-${error.sequence}-message`;
  return <section
    className="action-error-alert"
    role="alert"
    aria-live="assertive"
    aria-atomic="true"
    aria-labelledby={titleId}
    aria-describedby={messageId}
  >
    <span className="action-error-icon" aria-hidden="true">!</span>
    <div>
      <strong id={titleId}>{error.title}</strong>
      <p id={messageId}>{error.message}</p>
    </div>
    <button type="button" onClick={onDismiss} aria-label={`Dismiss: ${error.title}`}>Dismiss</button>
  </section>;
}

/** Reject oversized browser imports before File.text() allocates another full copy. */
export async function parseProjectImportFile(file: BrowserTextImport): Promise<MapProject> {
  assertBrowserImportSize(file.size, MAX_PROJECT_IMPORT_BYTES, "Project");
  return parseProject(await file.text());
}

/** Custom catalogs are intentionally capped independently from editable projects. */
export async function parseCatalogImportFile(file: BrowserTextImport): Promise<Dom6CatalogBundle> {
  assertBrowserImportSize(file.size, MAX_CUSTOM_CATALOG_IMPORT_BYTES, "Custom catalog");
  return parseCatalogBundle(await file.text());
}

function assertBrowserImportSize(size: number, maximum: number, label: string): void {
  if (size <= maximum) return;
  throw new Error(`${label} file is ${formatBytes(size)}; the browser import limit is ${formatBytes(maximum)}. The file was not read.`);
}

/** Browser storage can reject both reads and removals in private/sandboxed contexts. */
export function removeStoredCustomCatalog(storage?: Pick<Storage, "removeItem">): boolean {
  try {
    const target = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    if (!target) return false;
    target.removeItem(CATALOG_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
const START_ALLOCATION_STATUS_ID = "start-allocation-status";
const TERRAIN_KEYS = (Object.keys(TERRAIN_LABELS) as TerrainKey[]).filter((key) => key !== "freshwater");
const BIOME_KEYS = Object.keys(BIOME_LABELS) as BiomeKey[];
const MAGIC_PATHS = Object.keys(MAGIC_PATH_LABELS) as MagicPath[];
const TERRAIN_FLAG_LABELS: Record<TerrainFlag, string> = {
  sea: "Sea",
  freshwater: "Fresh water",
  highland: "Highland",
  swamp: "Swamp",
  waste: "Wasteland",
  forest: "Forest",
  farm: "Farm",
  deep: "Deep sea",
  cave: "Cave",
  mountains: "Mountains",
  cavewall: "Impassable cave wall",
};
const ADDITIVE_TERRAIN_FLAGS = TERRAIN_FLAGS.filter((flag) => flag !== "freshwater");
const CAVE_FAMILY_KINDS = new Set<PlaneKind>(["cave", "cavern", "underworld", "hell", "abyss"]);
const CONDITIONS: Array<{ value: PreviewCondition; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "winter", label: "Frozen / winter" },
  { value: "forested", label: "Forested" },
  { value: "flooded", label: "Submerged" },
  { value: "wasted", label: "Wasted" },
  { value: "farmland", label: "Farmland" },
];
const CONDITION_PREVIEW_NOTE = "Illustrative preview, not a temperature simulation. Winter skips water and caves; Cloud/Air dry islands are included, while other special realms keep their normal palette. Warmer/Colder affect eligible dry land.";
/** Matches the single-column CSS layout, where panels stack below the map. */
const NARROW_LAYOUT_QUERY = "(max-width: 979px)";
/** Below this width the map column is too narrow for the full legend to stay open by default. */
const COMPACT_MAP_QUERY = "(max-width: 1220px)";

const TOOL_ITEMS: Array<{ id: Tool; mark: string; label: string; hint: string }> = [
  { id: "select", mark: "⌖", label: "Select", hint: "Inspect and edit provinces" },
  { id: "link", mark: "⌁", label: "Link", hint: "Check a shared-border connection" },
  { id: "gate", mark: "◎", label: "Gate", hint: "Link provinces across planes" },
  { id: "start", mark: "S", label: "Start", hint: "Toggle a player start" },
  { id: "throne", mark: "♜", label: "Throne", hint: "Cycle throne preference" },
  { id: "site", mark: "✦", label: "Site", hint: "Toggle many-sites terrain" },
];

const PLANE_KINDS: Array<{ value: PlaneKind; label: string; description: string }> = [
  { value: "surface", label: "Surface", description: "Temperate land and water biomes." },
  { value: "cave", label: "Cave", description: "Tighter cave terrain with native underground populations." },
  { value: "cavern", label: "Great cavern", description: "Broader subterranean regions and crystal deeps." },
  { value: "cloud", label: "Cloud realm", description: "Floating-island groups with broad aerial causeways." },
  { value: "air", label: "Air plane", description: "Aerial and storm-biased other plane." },
  { value: "underworld", label: "Underworld", description: "Fungal death-realms bisected by the connected River Styx." },
  { value: "hell", label: "Infernal realm", description: "Volcanic and infernal terrain." },
  { value: "abyss", label: "Abyss", description: "Void-biased hostile plane." },
  { value: "dream", label: "Dream realm", description: "Wild glamour and astral terrain." },
  { value: "elemental", label: "Elemental", description: "Fire, air, water, and earth extremes." },
  { value: "custom", label: "Custom", description: "Neutral profile for manual tuning." },
];

const PLANE_VARIANTS: Array<{ value: PlaneVariant; label: string }> = [
  { value: "temperate", label: "Temperate" },
  { value: "wild", label: "Wild" },
  { value: "frozen", label: "Frozen" },
  { value: "arid", label: "Arid" },
  { value: "oceanic", label: "Oceanic" },
  { value: "fungal", label: "Fungal" },
  { value: "crystal", label: "Crystal" },
  { value: "volcanic", label: "Volcanic" },
  { value: "storm", label: "Storm" },
  { value: "infernal", label: "Infernal" },
  { value: "void", label: "Void" },
];

const START_TYPES: Array<{ value: StartType; label: string; hint: string }> = [
  { value: "land", label: "Land", hint: "Non-coastal surface land" },
  { value: "coastal", label: "Coastal", hint: "Land bordering a water province" },
  { value: "water", label: "Water", hint: "Sea, deep-sea, or kelp starts" },
  { value: "cave", label: "Cave", hint: "Cave-family starts" },
  { value: "other", label: "Other", hint: "Any remaining compatible plane" },
];

const GATE_LAYOUTS: Array<{ value: GateLayout; label: string; description: string }> = [
  { value: "hub", label: "Main-plane hub", description: "Every added plane connects to plane 1." },
  { value: "chain", label: "Plane chain", description: "Each plane connects to the next one." },
  { value: "ring", label: "Closed ring", description: "A chain with the last plane linked back to plane 1." },
  { value: "compatible", label: "Compatibility graph", description: "Prefer links between mechanically compatible plane archetypes." },
];

const OCEAN_LAYOUTS: Array<{ value: OceanLayout; label: string }> = [
  { value: "natural", label: "Natural / varied" },
  { value: "single_continent", label: "Single continent" },
  { value: "multiple_continents", label: "Multiple continents" },
  { value: "island_chains", label: "Island chains" },
  { value: "inland_sea", label: "Central inland sea" },
];

const ECONOMY_BALANCE_MODES: Array<{ value: EconomyBalanceMode; label: string; description: string }> = [
  { value: "none", label: "None / natural", description: "Keep natural generated populations; starts may have unequal early economies." },
  { value: "soft", label: "Soft correction", description: "Lightly nudge start economies toward parity, with corrections capped at 12%." },
  { value: "hard", label: "Hard competitive balance", description: "Strongly equalize early start economies for competitive multiplayer. Default." },
];

const OVERLAND_TOPOLOGY_MODES: Array<{ value: OverlandTopologyMode; label: string; description: string }> = [
  { value: "open", label: "Open movement", description: "Turn generated rivers into bridges and other blocking or seasonal overland borders into normal links." },
  { value: "competitive", label: "Competitive mix", description: "Use a terrain-shaped mix of open routes, rivers, passes, and borders. Default." },
  { value: "strategic", label: "Strategic regions", description: "Add deterministic regional chokepoints away from capitals while keeping the movement graph connected." },
];

const EDGE_KINDS: Array<{ value: EdgeKind; label: string }> = [
  { value: "standard", label: "Standard" },
  { value: "road", label: "Road" },
  { value: "river", label: "River" },
  { value: "bridge", label: "Bridge" },
  { value: "mountain_pass", label: "Mountain pass" },
  { value: "mountain_border", label: "Mountain border" },
  { value: "impassable", label: "Impassable" },
  { value: "custom", label: "Custom value" },
];

/** Restore every editable value shown on Generate without replacing authored map data. */
export function resetGeneratorDefaults(draft: MapProject, activePlaneId: string): void {
  const defaults = createDefaultProject();
  removeGeneratedCaveSpecificStarts(draft);
  draft.seed = defaults.seed;
  draft.settings.players = defaults.settings.players;
  draft.settings.provincesPerPlayer = defaults.settings.provincesPerPlayer;
  draft.settings.waterPercent = defaults.settings.waterPercent;
  draft.settings.oceanLayout = defaults.settings.oceanLayout;
  draft.settings.continentCount = defaults.settings.continentCount;
  draft.settings.specialPlaneSizePercent = defaults.settings.specialPlaneSizePercent;
  draft.settings.provinceNameSeed = defaults.settings.provinceNameSeed;
  draft.settings.randomizeNamesOnLoad = defaults.settings.randomizeNamesOnLoad;
  draft.settings.biomeCohesion = defaults.settings.biomeCohesion;
  draft.settings.economyBalance = defaults.settings.economyBalance;
  draft.settings.overlandTopology = defaults.settings.overlandTopology;
  draft.settings.throneCount = defaults.settings.throneCount;
  draft.settings.startDistribution = defaults.settings.startDistribution ? { ...defaults.settings.startDistribution } : undefined;
  draft.settings.startDegreeTarget = defaults.settings.startDegreeTarget;
  draft.settings.caveStartNations = defaults.settings.caveStartNations ? [...defaults.settings.caveStartNations] : undefined;
  draft.settings.resolution = defaults.settings.resolution;

  if (defaults.settings.resolution !== "custom") {
    const preset = RESOLUTION_PRESETS[defaults.settings.resolution];
    for (const plane of draft.planes) {
      plane.width = preset.width;
      plane.height = preset.height;
    }
  }
  const activePlane = draft.planes.find((plane) => plane.id === activePlaneId) ?? draft.planes[0];
  if (activePlane) {
    const wrapsByDefault = activePlane.kind !== "underworld";
    const wrapChanged = activePlane.wrapX !== wrapsByDefault || activePlane.wrapY !== wrapsByDefault;
    activePlane.wrapX = wrapsByDefault;
    activePlane.wrapY = wrapsByDefault;
    if (wrapChanged) activePlane.edges = synchronizePlaneEdges(activePlane, `${draft.seed}:reset-wrap`).edges;
  }
}

/** Update current ownership and borders without regenerating province content. */
export function updatePlaneArchetype(draft: MapProject, planeId: string, nextKind: PlaneKind): void {
  const planeIndex = draft.planes.findIndex((item) => item.id === planeId);
  const plane = draft.planes[planeIndex];
  if (!plane || plane.kind === nextKind) return;
  if (isGeneratedPlaneName(plane.name)) {
    plane.name = uniquePlaneName(draft.planes.filter((item) => item.id !== plane.id), defaultPlaneName(nextKind, planeIndex));
  }
  plane.kind = nextKind;
  plane.variant = defaultVariantForKind(nextKind);
  plane.edges = synchronizePlaneEdges(plane, `${draft.seed}:plane:${planeIndex}:archetype-sync`).edges;
}

export function updateCaveStartNations(draft: MapProject, nations: number[]): void {
  draft.settings.caveStartNations = nations.length ? [...nations] : undefined;
  removeGeneratedCaveSpecificStarts(draft);
}

/** Keep constrained-generation balance fallbacks visible without promoting them to export blockers. */
export function generationBalanceWarnings(issues: ValidationIssue[]): ValidationIssue[] {
  const spacing = issues.find((issue) => issue.severity === "warning"
    && issue.message.startsWith("Scale-aware start spacing"));
  const degree = issues.find((issue) => issue.severity === "warning"
    && issue.message.startsWith("Start connection counts across the atlas vary"))
    ?? issues.find((issue) => issue.severity === "warning"
      && issue.message.includes(" start connection counts vary from "));
  return [spacing, degree].filter((issue): issue is ValidationIssue => issue !== undefined);
}

export function GenerationBalanceNotice({ issues, generationWarnings = [] }: { issues: ValidationIssue[]; generationWarnings?: string[] }) {
  const warnings = generationBalanceWarnings(issues);
  if (!warnings.length && !generationWarnings.length) return null;
  return <p className="warning-copy generation-balance-warning" role="status" aria-live="polite" aria-atomic="true">
    <strong>Generation used a best-effort balance fallback.</strong>{" "}
    {[...generationWarnings, ...warnings.map((issue) => issue.message)].join(" ")}{" "}
    These multiplayer-balance warnings do not block export. Adjust the map size, start mix, or connection target and Generate again if you want stricter parity.
  </p>;
}

export function MapMakerApp() {
  // Keep the server and first client render identical. Randomize after autosave resolves.
  const [project, setProject] = useState<MapProject>(() => recordGenerationInputs(createDefaultProject()));
  const [activePlaneId, setActivePlaneId] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [tool, setTool] = useState<Tool>("select");
  const [preview, setPreview] = useState<PreviewCondition>("normal");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("terrain");
  const [leftTab, setLeftTab] = useState<LeftTab>("generate");
  const [linkSource, setLinkSource] = useState<{ planeId: string; provinceId: string }>();
  const [gateSource, setGateSource] = useState<{ planeId: string; provinceId: string }>();
  const [undoStack, setUndoStack] = useState<MapProject[]>([]);
  const [redoStack, setRedoStack] = useState<MapProject[]>([]);
  const [validationOpen, setValidationOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [analysisSelection, setAnalysisSelection] = useState<{ project: MapProject; keys: string[]; label: string; mode: AnalysisMode; kind?: "iteration" }>();
  const [exportOpen, setExportOpen] = useState(false);
  const [exportArtwork, setExportArtwork] = useState<ExportArtwork>("native");
  const [replaceAllNamesOpen, setReplaceAllNamesOpen] = useState(false);
  const [destructiveConfirmation, setDestructiveConfirmation] = useState<DestructiveConfirmation>();
  const [exportProgress, setExportProgress] = useState<ExportProgress>();
  const [exportBusy, setExportBusy] = useState(false);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationWorkerProgress>();
  const [toast, setToast] = useState<string>();
  const [actionError, setActionError] = useState<ActionErrorNotice>();
  const [zoom, setZoom] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>({ backend: "none", errors: [], migrated: false });
  const [autosaveSaving, setAutosaveSaving] = useState(false);
  const [userCatalog, setUserCatalog] = useState<Dom6CatalogBundle>();
  const [openSetupSections, setOpenSetupSections] = useState<Partial<Record<string, boolean>>>({});
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLDivElement>(null);
  const compactMap = useMediaQuery(COMPACT_MAP_QUERY);
  // The legend starts folded where it would cover much of a narrow map; an explicit toggle wins.
  const [legendPreference, setLegendPreference] = useState<boolean>();
  const legendOpen = legendPreference ?? !compactMap;
  const leftPanelRef = useRef<HTMLElement>(null);
  const canvasColumnRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const catalogImportRef = useRef<HTMLInputElement>(null);
  const generationTaskRef = useRef<ProjectGenerationTask | undefined>(undefined);
  const currentProjectRef = useRef(project);
  const importGuardRef = useRef(createProjectImportGuard());
  const catalogImportSessionRef = useRef(createCatalogImportSession());
  const rangeEditStartRef = useRef<MapProject | undefined>(undefined);
  const playersEditBaseRef = useRef<{ players: number; distribution: StartDistribution } | undefined>(undefined);
  // Typing in one field is one Undo step. The field whose change event is being
  // dispatched joins the session its first change started, until it blurs;
  // other commits (Generate, imports, buttons) always record their own step.
  const textChangeTargetRef = useRef<EventTarget | undefined>(undefined);
  const textEditSessionRef = useRef<EventTarget | undefined>(undefined);
  const autosaveRevisionRef = useRef<AutosaveRevision | null>(null);
  const autosaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const actionErrorSequenceRef = useRef(0);

  const showActionError = useCallback((kind: ActionErrorKind, error: unknown, fallbackMessage: string) => {
    actionErrorSequenceRef.current += 1;
    setActionError(createActionErrorNotice(kind, actionErrorSequenceRef.current, error, fallbackMessage));
  }, []);

  const clearActionError = useCallback((kind: ActionErrorKind) => {
    setActionError((current) => current?.kind === kind ? undefined : current);
  }, []);

  const activePlane = project.planes.find((plane) => plane.id === activePlaneId) ?? project.planes[0];
  const selected = activePlane?.provinces.find((province) => province.id === selectedId);
  const catalog = useMemo(() => mergeCatalogBundles(BUILTIN_DOM6_CATALOG, ...(userCatalog ? [userCatalog] : [])), [userCatalog]);
  const playableNations = useMemo(() => playerNationEntries(catalog.nations), [catalog.nations]);
  const startDistribution = project.settings.startDistribution ?? defaultStartDistribution(project.settings.players);
  const caveStartNations = project.settings.caveStartNations ?? [];
  const allocatedStarts = Object.values(startDistribution).reduce((sum, value) => sum + value, 0);
  const startPlanErrors = useMemo(() => preflightStartPlan(project), [project]);
  const authoredStartNotices = useMemo(() => preflightAuthoredStartNotices(project), [project]);
  const planeConnectionRules = useMemo(() => resolvePlaneConnectionRules(project), [project]);
  const selectedPlaneConnectionRules = planeConnectionRules.filter((rule) => rule.a === activePlane.id || rule.b === activePlane.id);
  const activePlaneGates = gatesTouchingPlane(project.gates, activePlane.id);
  const activePlaneMarkerAnnotations = useMemo(
    () => markerAnnotationsForPlane({ gates: project.gates, specificStarts: project.specificStarts }, activePlane.id),
    [activePlane.id, project.gates, project.specificStarts],
  );
  const fairness = useMemo(() => calculateFairness(project), [project]);
  const issues = useMemo(() => validateProject(project, catalog), [catalog, project]);
  // Only the Scenario summary needs this count, and only while the policy is on.
  const populationDefenderCount = useMemo(() => leftTab === "scenario" && project.populationDefense?.enabled
    ? buildInitialDefensePlan(project, catalog, project.populationDefense, VERIFIED_POPULATION_DEFENSE_PROFILES).counts.derived
    : undefined, [catalog, leftTab, project]);
  const topologyAudits = useMemo(() => project.planes.map((plane) => ({
    planeId: plane.id,
    audit: auditPlaneTopology(plane),
    // Border edits look edges up by ID; synchronizing repairs repeated IDs.
    duplicateEdgeIds: plane.edges.length - new Set(plane.edges.map((edge) => edge.id)).size,
  })), [project.planes]);
  const projectTopologyIssueCount = topologyAudits.reduce((sum, item) =>
    sum + item.audit.missing.length + item.audit.extra.length + item.duplicateEdgeIds, 0);
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const currentAnalysis = analysisSelection?.project === project ? analysisSelection : undefined;
  const analysisProvinceIds = useMemo(() => currentAnalysis
    ? new Set(currentAnalysis.keys.filter(key => key.startsWith(`${activePlane.id}:`)).map(key => key.slice(activePlane.id.length + 1)))
    : undefined, [activePlane.id, currentAnalysis]);
  const inspectProvince = (ref: ProvinceReference) => {
    setActivePlaneId(ref.planeId);
    setSelectedId(ref.provinceId);
    setTool("select");
    setLinkSource(undefined);
    setGateSource(undefined);
  };
  const totalProvinces = project.planes.reduce((sum, plane) => sum + plane.provinces.length, 0);
  const autosaveLabel = autosaveState.conflict
    ? "Autosave conflict"
    : autosaveSaving
      ? "Saving changes"
      : autosaveState.backend === "indexeddb"
        ? "Device autosave saved"
        : autosaveState.backend === "localstorage"
          ? "Limited autosave saved"
          : hydrated ? "Autosave unavailable" : "Loading autosave";
  const autosaveError = autosaveState.errors[0]?.message;
  const armedStatus = linkSource
    ? armedEndpointCopy(project, "link", linkSource, activePlane?.id ?? "")
    : gateSource
      ? armedEndpointCopy(project, "gate", gateSource, activePlane?.id ?? "")
      : undefined;

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void loadProjectAutosave().then((result) => {
        if (cancelled) return;
        autosaveRevisionRef.current = result.revision ?? null;
        setAutosaveState(result);
        let next = result.project ?? createFreshProject();
        if (result.project) {
          try {
            next = prepareProjectForOpening(result.project, Boolean(result.conflict));
          } catch {
            setToast("Your saved atlas was restored with its existing names; automatic name shuffling was unavailable.");
          }
        }
        currentProjectRef.current = next;
        setProject(next);
        setActivePlaneId(next.planes[0]?.id ?? "");
        if (result.project && next !== result.project) {
          setUndoStack([result.project]);
          setToast("Fresh generated names applied on open. Manual names and the map are unchanged; Undo restores the saved names.");
        } else if (!result.project && result.errors.length) {
          setToast("The autosave could not be restored; a fresh atlas was opened.");
        }
      }).catch(() => {
        if (cancelled) return;
        const next = createFreshProject();
        currentProjectRef.current = next;
        setProject(next);
        setActivePlaneId(next.planes[0]?.id ?? "");
        setToast("The autosave could not be restored; a fresh atlas was opened.");
      }).finally(() => {
        if (!cancelled) setHydrated(true);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    currentProjectRef.current = project;
  }, [project]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(CATALOG_STORAGE_KEY);
        if (saved) {
          const parsed = parseCatalogBundle(saved);
          mergeCatalogBundles(BUILTIN_DOM6_CATALOG, parsed);
          catalogImportSessionRef.current.reset(parsed);
          setUserCatalog(parsed);
        }
      } catch {
        const cleared = removeStoredCustomCatalog();
        setToast(cleared
          ? "A saved custom catalog was invalid and has been ignored."
          : "Custom catalog storage is unavailable. Bundled Dominions data remains available for this session.");
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!hydrated || autosaveState.conflict) return;
    const timeout = window.setTimeout(() => {
      setAutosaveSaving(true);
      autosaveQueueRef.current = autosaveQueueRef.current.catch(() => undefined).then(async () => {
        if (currentProjectRef.current !== project) return;
        const state = await saveProjectAutosave(project, undefined, { expectedRevision: autosaveRevisionRef.current });
        setAutosaveState(state);
        if (state.conflict) {
          setToast("Autosave paused because another tab saved a newer copy. Choose which copy to keep.");
        } else {
          autosaveRevisionRef.current = state.revision ?? autosaveRevisionRef.current;
          if (state.backend === "none") showActionError("device-save", state.errors[0]?.message, "Autosave is unavailable. The previous saved copy is unchanged.");
          else clearActionError("device-save");
        }
      }).catch((error) => {
        setAutosaveState({ backend: "none", errors: [], migrated: false });
        showActionError("device-save", error, "Autosave is unavailable. The previous saved copy is unchanged.");
      }).finally(() => {
        if (currentProjectRef.current === project) setAutosaveSaving(false);
      });
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [autosaveState.conflict, clearActionError, hydrated, project, showActionError]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(undefined), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const findElement = findRef.current;
    const findDetails = () => findElement?.querySelector("details") ?? undefined;
    const focusFindInput = () => window.requestAnimationFrame(() => {
      const input = findDetails()?.querySelector<HTMLInputElement>('input[type="search"]');
      input?.focus();
      input?.select();
    });
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!fileMenuRef.current?.contains(target)) setFileMenuOpen(false);
      const details = findDetails();
      if (details?.open && !findElement?.contains(target)) details.open = false;
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        const details = findDetails();
        if (details?.open && findElement?.contains(document.activeElement)) {
          event.preventDefault();
          details.open = false;
          details.querySelector("summary")?.focus();
        }
        if (fileMenuRef.current?.contains(document.activeElement)) {
          setFileMenuOpen(false);
          fileMenuRef.current.querySelector<HTMLButtonElement>(".file-menu-trigger")?.focus();
        }
        return;
      }
      // "/" jumps to province search unless the user is typing or a dialog owns the keyboard.
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (isShortcutBlockedTarget(event.target) || document.querySelector('[aria-modal="true"]')) return;
      const details = findDetails();
      if (!details) return;
      event.preventDefault();
      details.open = true;
      if (window.matchMedia?.(NARROW_LAYOUT_QUERY)?.matches) findElement?.scrollIntoView({ block: "nearest" });
      focusFindInput();
    };
    const handleToggle = (event: Event) => {
      const details = findDetails();
      if (event.target === details && details.open) focusFindInput();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    findElement?.addEventListener("toggle", handleToggle, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      findElement?.removeEventListener("toggle", handleToggle, true);
    };
  }, []);

  useEffect(() => () => {
    importGuardRef.current.cancel();
    catalogImportSessionRef.current.reset();
    const task = generationTaskRef.current;
    generationTaskRef.current = undefined;
    task?.cancel();
  }, []);

  const commit = useCallback((next: MapProject, remember = true, respectLocks = true) => {
    try {
      if (respectLocks) {
        assertProjectLocks(currentProjectRef.current, next);
        pruneAuthoringRegions(next);
      }
      serializeProject(next);
    } catch (error) {
      showActionError("project-edit", error, "The previous project is unchanged.");
      return false;
    }
    clearActionError("project-edit");
    const previous = currentProjectRef.current;
    const historyStep = textEditHistoryStep(textEditSessionRef.current, textChangeTargetRef.current);
    textEditSessionRef.current = historyStep.session;
    if (remember && historyStep.record) {
      setUndoStack((stack) => appendHistorySnapshot(stack, previous));
    }
    // A new edit branches away from Redo, including coalesced range edits.
    setRedoStack([]);
    importGuardRef.current.changed();
    currentProjectRef.current = next;
    setAutosaveSaving(true);
    setProject(next);
    return true;
  }, [clearActionError, showActionError]);

  const mutate = useCallback((recipe: (draft: MapProject) => void, remember = true) => {
    const draft = cloneProject(currentProjectRef.current);
    recipe(draft);
    draft.updatedAt = new Date().toISOString();
    return commit(draft, remember);
  }, [commit]);

  const beginRangeEdit = useCallback(() => {
    if (!rangeEditStartRef.current) rangeEditStartRef.current = currentProjectRef.current;
  }, []);

  const finishRangeEdit = useCallback(() => {
    const startingProject = rangeEditStartRef.current;
    rangeEditStartRef.current = undefined;
    if (!startingProject || startingProject === currentProjectRef.current) return;
    setUndoStack((stack) => appendHistorySnapshot(stack, startingProject));
  }, []);

  const updateSelected = useCallback((recipe: (province: Province) => void) => {
    if (!activePlane || !selectedId) return;
    mutate((draft) => {
      const plane = draft.planes.find((item) => item.id === activePlane.id);
      const province = plane?.provinces.find((item) => item.id === selectedId);
      if (province) recipe(province);
    });
  }, [activePlane, mutate, selectedId]);

  const handleUndo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    const current = currentProjectRef.current;
    rangeEditStartRef.current = undefined;
    textEditSessionRef.current = undefined;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => appendHistorySnapshot(stack, current));
    importGuardRef.current.changed();
    currentProjectRef.current = previous;
    setProject(previous);
    setAutosaveSaving(true);
    setSelectedId(undefined);
    setLinkSource(undefined);
    setGateSource(undefined);
  };

  const handleRedo = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    const current = currentProjectRef.current;
    rangeEditStartRef.current = undefined;
    textEditSessionRef.current = undefined;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => appendHistorySnapshot(stack, current));
    importGuardRef.current.changed();
    currentProjectRef.current = next;
    setProject(next);
    setAutosaveSaving(true);
    setSelectedId(undefined);
    setLinkSource(undefined);
    setGateSource(undefined);
  };

  const launchGeneration = () => {
    if (generationTaskRef.current) return;
    const source = cloneProject(project);
    source.settings.gateDirection = "bidirectional";
    const launchProject = project;
    setGenerationBusy(true);
    setGenerationProgress({
      phase: "queued",
      message: `Preparing ${source.planes.length} planned plane${source.planes.length === 1 ? "" : "s"} for background generation…`,
    });
    const task = startProjectGeneration(source, { onProgress: setGenerationProgress });
    generationTaskRef.current = task;
    void task.promise.then((next) => {
      if (currentProjectRef.current !== launchProject) {
        setToast("Generation finished, but the project changed while it was running, so the result was safely discarded. Generate again to use the latest settings.");
        return;
      }
      if (!commit(recordGenerationInputs(next))) return;
      setActivePlaneId(next.planes[0]?.id ?? "");
      setSelectedId(undefined);
      setLinkSource(undefined);
      setGateSource(undefined);
      const notes: string[] = [];
      if (source.settings.oceanLayout === "island_chains"
        && source.settings.waterPercent < ISLAND_CHAIN_MIN_WATER_PERCENT) {
        notes.push(`Island chains used the ${ISLAND_CHAIN_MIN_WATER_PERCENT}% effective water minimum.`);
      }
    const nextIssues = validateProject(next, catalog);
      const continentNote = nextIssues.find((issue) => issue.severity === "warning"
        && issue.message.startsWith("Requested ") && issue.message.includes("major continents"));
      if (continentNote) notes.push(continentNote.message);
      if (generationBalanceWarnings(nextIssues).length) {
        notes.push("Balance warning: start spacing or connection parity used a best-effort fallback; review the non-blocking details on the Generate tab.");
      }
      if (next.generationWarnings?.length) {
        notes.push(`${next.generationWarnings.length} constrained-generation warning${next.generationWarnings.length === 1 ? "" : "s"} recorded on the Generate tab.`);
      }
      setToast(`Generated ${next.planes.reduce((sum, plane) => sum + plane.provinces.length, 0)} provinces from seed “${next.seed}”.${notes.length ? ` ${notes.join(" ")}` : ""}`);
    }).catch((error: unknown) => {
      if (!isGenerationAbort(error)) {
        setToast(error instanceof Error ? error.message : "Background map generation failed.");
      }
    }).finally(() => {
      if (generationTaskRef.current !== task) return;
      generationTaskRef.current = undefined;
      setGenerationBusy(false);
      setGenerationProgress(undefined);
    });
  };

  const handleGenerate = () => {
    if (allocatedStarts !== project.settings.players) {
      setLeftTab("generate");
      setToast(`Start allocation totals ${allocatedStarts}; it must equal ${project.settings.players} players.`);
      return;
    }
    if (startPlanErrors.length) {
      setLeftTab("generate");
      setToast(`Generation cannot start: ${startPlanErrors[0]}`);
      return;
    }
    if (generationTaskRef.current) return;
    const impact = atlasReplacementImpact(project);
    if (atlasReplacementNeedsConfirmation(impact)) {
      setDestructiveConfirmation({ kind: "generate", impact });
      return;
    }
    launchGeneration();
  };

  const handleCancelGeneration = () => {
    const task = generationTaskRef.current;
    if (!task) return;
    generationTaskRef.current = undefined;
    task.cancel();
    setGenerationBusy(false);
    setGenerationProgress(undefined);
    setToast("Generation cancelled. The current atlas was not changed.");
  };

  const startNewAtlas = () => {
    const task = generationTaskRef.current;
    generationTaskRef.current = undefined;
    task?.cancel();
    const next = createFreshProject();
    importGuardRef.current.changed();
    currentProjectRef.current = next;
    rangeEditStartRef.current = undefined;
    setProject(next);
    setAutosaveSaving(true);
    setActivePlaneId(next.planes[0]?.id ?? "");
    setSelectedId(undefined);
    setLinkSource(undefined);
    setGateSource(undefined);
    setUndoStack([]);
    setRedoStack([]);
    setTool("select");
    setPreview("normal");
    setInspectorTab("terrain");
    setLeftTab("generate");
    setValidationOpen(false);
    setBalanceOpen(false);
    setAnalysisSelection(undefined);
    setExportOpen(false);
    setReplaceAllNamesOpen(false);
    setGenerationBusy(false);
    setGenerationProgress(undefined);
    setToast("Started a new atlas with a fresh random seed and generator defaults. The previous atlas is not in Undo; use its downloaded backup to restore it.");
  };

  const removePlane = (planeId: string) => {
    const source = currentProjectRef.current;
    if (source.planes.length <= 1) return;
    const index = source.planes.findIndex((plane) => plane.id === planeId);
    if (index < 0) return;
    const nextId = source.planes[index === 0 ? 1 : index - 1]?.id;
    const removed = mutate((draft) => {
      draft.planes = draft.planes.filter((plane) => plane.id !== planeId);
      draft.gates = withoutPlaneGateEndpoints(draft.gates, planeId);
      draft.specificStarts = draft.specificStarts.filter((start) => start.planeId !== planeId);
      draft.settings.planeConnections = draft.settings.planeConnections?.filter((rule) => rule.a !== planeId && rule.b !== planeId);
    });
    if (!removed) return;
    setActivePlaneId(nextId ?? "");
    setSelectedId(undefined);
    setLinkSource(undefined);
    setGateSource(undefined);
  };

  const requestRemovePlane = (planeId: string) => {
    const impact = planeRemovalImpact(project, planeId);
    if (impact) setDestructiveConfirmation({ kind: "remove-plane", planeId, impact });
  };

  const confirmDestructiveAction = () => {
    const action = destructiveConfirmation;
    if (!action) return;
    setDestructiveConfirmation(undefined);
    if (action.kind === "new-atlas") startNewAtlas();
    else if (action.kind === "generate") launchGeneration();
    else removePlane(action.planeId);
  };

  const handleRegenerateProvinceNames = () => {
    let renamed = 0;
    let preserved = 0;
    mutate((draft) => {
      draft.settings.provinceNameSeed = (draft.settings.provinceNameSeed ?? 0) + 1;
      const report = regenerateGeneratedProvinceNames(draft.planes, draft.seed, draft.settings.provinceNameSeed);
      renamed = report.generated;
      preserved = report.authoredPreserved;
    });
    setToast(`Regenerated ${renamed.toLocaleString()} contextual province names; preserved ${preserved.toLocaleString()} manual names.`);
  };

  const handleRegenerateAllProvinceNames = () => {
    let renamed = 0;
    mutate((draft) => {
      draft.settings.provinceNameSeed = (draft.settings.provinceNameSeed ?? 0) + 1;
      renamed = regenerateAllProvinceNames(draft.planes, draft.seed, draft.settings.provinceNameSeed).generated;
    });
    setReplaceAllNamesOpen(false);
    setToast(`Replaced all ${renamed.toLocaleString()} province names with unique contextual names. Undo restores the previous names.`);
  };

  const stagePlane = () => {
    const next = addPlane(project, "underworld", {
      generate: false,
      autoSize: true,
      name: uniquePlaneName(project.planes, "The Underworld"),
    });
    next.settings.planeConnections = resolvePlaneConnectionRules(next);
    if (!commit(next)) return;
    setActivePlaneId(next.planes.at(-1)?.id ?? activePlaneId);
    setSelectedId(undefined);
    setLeftTab("planes");
    setToast("Plane added to the generation plan. Configure it, then generate the atlas.");
  };

  /** Stacked narrow layouts scroll to the section a command opened; wide layouts already show every panel. */
  const revealSection = (element: HTMLElement | null, always = false) => {
    if (!element || (!always && !window.matchMedia?.(NARROW_LAYOUT_QUERY)?.matches)) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    element.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  const openSetupTab = (tab: LeftTab) => {
    setLeftTab(tab);
    revealSection(leftPanelRef.current);
  };

  const goToGenerate = () => {
    setLeftTab("generate");
    window.requestAnimationFrame(() => {
      const button = leftPanelRef.current?.querySelector<HTMLButtonElement>(".generate-button");
      button?.scrollIntoView({ block: "center" });
      button?.focus({ preventScroll: true });
    });
  };

  const closeFind = () => {
    const details = findRef.current?.querySelector("details");
    if (details) details.open = false;
  };

  const importCatalog = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = await catalogImportSessionRef.current.import(() => parseCatalogImportFile(file), (merged) => {
        window.localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(merged));
        setUserCatalog(merged);
      });
      if (!imported) return;
      const count = imported.poptypes.length + imported.sites.length + imported.units.length + imported.nations.length + imported.forts.length + imported.planes.length + imported.siteTerrainTypes.length;
      clearActionError("catalog-import");
      setToast(`Loaded ${count.toLocaleString()} verified catalog entries from ${imported.catalogVersion}.`);
    } catch (error) {
      showActionError("catalog-import", error, "Catalog import failed; the previous catalog is unchanged.");
    }
  };

  const resetCatalog = () => {
    catalogImportSessionRef.current.reset();
    setUserCatalog(undefined);
    const cleared = removeStoredCustomCatalog();
    setToast(cleared
      ? `Custom catalog entries removed; bundled Dominions ${BUILTIN_DOM6_CATALOG.gameVersion} data remains available.`
      : "Custom catalog entries were removed for this session, but browser storage could not be cleared; they may return after reload.");
  };

  const downloadCatalogTemplate = () => {
    const blob = new Blob([JSON.stringify(createCatalogTemplate(BUILTIN_DOM6_CATALOG.gameVersion), null, 2)], { type: "application/json" });
    downloadBrowserBlob(blob, "pantokrator-dom6-catalog-template.json");
    setToast("Catalog template downloaded.");
  };

  const handleSynchronizeBorders = () => {
    if (!projectTopologyIssueCount) return;
    const removed = topologyAudits.reduce((sum, item) => sum + item.audit.extra.length, 0);
    const added = topologyAudits.reduce((sum, item) => sum + item.audit.missing.length, 0);
    const synchronized = mutate((draft) => {
      draft.planes = draft.planes.map((plane, planeIndex) => synchronizePlaneEdges(
        plane,
        `${draft.seed}:plane:${planeIndex}:border-sync`,
      ));
    });
    if (!synchronized) return;
    setLinkSource(undefined);
    setToast(`Visible borders synchronized: added ${added}, removed ${removed}.`);
  };

  const updateWrap = (axis: "wrapX" | "wrapY", value: boolean) => {
    if (!activePlane) return;
    mutate((draft) => {
      const planeIndex = draft.planes.findIndex((plane) => plane.id === activePlane.id);
      if (planeIndex < 0) return;
      const plane = draft.planes[planeIndex]!;
      plane[axis] = value;
      draft.planes[planeIndex] = synchronizePlaneEdges(
        plane,
        `${draft.seed}:plane:${planeIndex}:wrap-sync`,
      );
    });
  };

  const handleProvinceClick = (provinceId: string) => {
    if (!activePlane) return;
    setSelectedId(provinceId);
    if (tool === "select") return;
    if (tool === "start") {
      updateProvinceById(activePlane.id, provinceId, (province) => {
        province.start = !province.start;
        if (province.start) prepareProvinceForPlayerStart(province);
      });
      return;
    }
    if (tool === "throne") {
      updateProvinceById(activePlane.id, provinceId, (province) => {
        province.throne = province.throne === "none" ? "preferred" : province.throne === "preferred" ? "avoid" : "none";
        province.fixedThrone = undefined;
      });
      return;
    }
    if (tool === "site") {
      updateProvinceById(activePlane.id, provinceId, (province) => { province.manySites = !province.manySites; });
      return;
    }
    if (tool === "link") {
      if (!linkSource || linkSource.planeId !== activePlane.id) {
        setLinkSource({ planeId: activePlane.id, provinceId });
        setToast("Choose a second province on this plane.");
        return;
      }
      if (!activePlane.provinces.some((province) => province.id === linkSource.provinceId)) {
        setLinkSource(undefined);
        setToast("The first link endpoint no longer exists. Choose it again.");
        return;
      }
      if (linkSource.provinceId === provinceId) {
        setLinkSource(undefined);
        return;
      }
      const existing = activePlane.edges.find((edge) =>
        (edge.a === linkSource.provinceId && edge.b === provinceId)
        || (edge.b === linkSource.provinceId && edge.a === provinceId));
      if (existing) {
        setLinkSource(undefined);
        setToast("Those provinces already share a connection. Change its border type in the province inspector.");
        return;
      }
      if (!canAuthorPlaneEdge(activePlane, linkSource.provinceId, provinceId)) {
        setToast("Those provinces do not share a visible border. Use a gate for remote or cross-plane travel.");
        return;
      }
      mutate((draft) => {
        const plane = draft.planes.find((item) => item.id === activePlane.id)!;
        plane.edges.push({
          id: `edge-manual-${hashString(`${draft.seed}:${linkSource.provinceId}:${provinceId}:${Date.now()}`).toString(36)}`,
          a: linkSource.provinceId,
          b: provinceId,
          kind: "standard",
        });
      });
      setLinkSource(undefined);
      return;
    }
    if (tool === "gate") {
      if (!gateSource) {
        setGateSource({ planeId: activePlane.id, provinceId });
        setToast("Gate source armed. Choose any other province on this plane or another plane.");
        return;
      }
      const sourcePlane = project.planes.find((plane) => plane.id === gateSource.planeId);
      if (!sourcePlane?.provinces.some((province) => province.id === gateSource.provinceId)) {
        setGateSource(undefined);
        setToast("The first gate endpoint no longer exists. Choose it again.");
        return;
      }
      if (gateSource.planeId === activePlane.id && gateSource.provinceId === provinceId) {
        setGateSource(undefined);
        return;
      }
      const linked = mutate((draft) => {
        const nextNumber = Math.max(0, ...draft.gates.map((gate) => gate.gateNumber)) + 1;
        // Gate numbers can be edited, so the number alone may repeat an
        // existing gate's ID; suffix until the ID is unused.
        const usedIds = new Set(draft.gates.map((gate) => gate.id));
        const baseId = `gate-manual-${nextNumber}-${hashString(draft.seed).toString(36)}`;
        let id = baseId;
        for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${baseId}-${suffix}`;
        draft.gates.push({
          id,
          gateNumber: nextNumber,
          endpoints: [gateSource, { planeId: activePlane.id, provinceId }],
        });
      });
      if (!linked) return;
      const samePlane = gateSource.planeId === activePlane.id;
      setGateSource(undefined);
      setToast(samePlane ? "Same-plane gateway linked." : "Cross-plane gateway linked.");
    }
  };

  const updateProvinceById = (planeId: string, provinceId: string, recipe: (province: Province) => void) => {
    mutate((draft) => {
      const province = draft.planes.find((plane) => plane.id === planeId)?.provinces.find((item) => item.id === provinceId);
      if (province) recipe(province);
    });
  };

  const runExport = async (kind: "install" | "zip" | "player") => {
    if (errorCount) {
      setValidationOpen(true);
      return;
    }
    setExportBusy(true);
    setExportProgress({ stage: "preparing", plane: 0, planeCount: project.planes.length, percent: 0, message: "Preparing the atlas…" });
    try {
      if (kind === "install") {
        const result = await installPackage(project, setExportProgress, catalog, exportArtwork);
        if (result === "unsupported") {
          setToast("Direct folder access or safe cross-tab locking is unavailable here. Use the ready-to-install ZIP instead.");
        } else if (result === "installed") {
          clearActionError("package-export");
          setToast("Installed into your selected Dominions 6 maps folder.");
        }
      } else {
        await downloadPackage(project, setExportProgress, catalog, kind === "player" ? "player" : "host", exportArtwork);
        clearActionError("package-export");
        setToast("Ready-to-install map package downloaded.");
      }
    } catch (error) {
      showActionError("package-export", error, "Export failed.");
    } finally {
      setExportBusy(false);
    }
  };

  const exportPreview = async () => {
    if (!activePlane) return;
    setExportBusy(true);
    setExportProgress(undefined);
    try {
      const blob = await renderPlanePng(activePlane, preview, activePlaneMarkerAnnotations);
      downloadBrowserBlob(blob, `${sanitizeMapName(project.name)}-${sanitizeMapName(activePlane.name)}-${preview}.png`);
      clearActionError("preview-export");
      setToast("High-resolution preview exported.");
    } catch (error) {
      showActionError("preview-export", error, "Preview export failed.");
    } finally {
      setExportBusy(false);
    }
  };

  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const importStatus = importGuardRef.current.begin();
    try {
      const opened = await parseProjectImportFile(file);
      if (importStatus() !== "current") {
        if (importStatus() === "changed") setToast("Project not opened because the current atlas changed while the file was being read. Open the file again when ready.");
        return;
      }
      const next = prepareProjectForOpening(opened);
      // Opening a file replaces the atlas rather than editing it, so the
      // current atlas's locks must not be compared against the new project.
      pruneAuthoringRegions(next);
      if (!commit(next, true, false)) return;
      setActivePlaneId(next.planes[0]?.id ?? "");
      setSelectedId(undefined);
      setLinkSource(undefined);
      setGateSource(undefined);
      clearActionError("project-import");
      setToast(`Opened ${next.name}.${next !== opened ? " Fresh generated names applied; manual names and the map are unchanged." : ""}`);
    } catch (error) {
      if (importStatus() !== "current") return;
      showActionError("project-import", error, "Project import failed.");
    }
  };

  const saveAutosaveNow = async (replaceNewer = false) => {
    importGuardRef.current.cancel();
    setAutosaveSaving(true);
    const save = autosaveQueueRef.current.catch(() => undefined).then(async () => {
      if (currentProjectRef.current !== project) return;
      const conflictRevisions = autosaveState.conflict?.backendRevisions;
      if (replaceNewer && autosaveState.recoveryCopies?.length) downloadAutosaveRecovery();
      if (replaceNewer && !conflictRevisions) {
        showActionError("device-save", undefined, "This conflict cannot be replaced safely because the reviewed device revisions are unavailable. Load a saved copy or download this project before retrying.");
        return;
      }
      const state = await saveProjectAutosave(project, undefined, replaceNewer
        ? { expectedBackendRevisions: conflictRevisions }
        : { expectedRevision: autosaveRevisionRef.current });
      setAutosaveState(state);
      if (state.conflict) {
        setToast(state.conflict.reason === "divergent-copies"
          ? "The two preserved device copies still differ. Inspect either copy, then explicitly choose which one to keep."
          : "Another tab changed the autosave. Reload that copy or explicitly keep this one.");
        return;
      }
      autosaveRevisionRef.current = state.revision ?? autosaveRevisionRef.current;
      if (state.backend === "none") {
        const persistenceDetail = state.errors[0]?.message;
        showActionError("device-save", undefined, `${persistenceDetail ? `${persistenceDetail} ` : ""}Download Editable project JSON to keep these changes.`);
      } else {
        clearActionError("device-save");
        setToast("Project saved on this device.");
      }
    }).catch((error) => {
      showActionError("device-save", error, "The project could not be saved.");
    }).finally(() => {
      if (currentProjectRef.current === project) setAutosaveSaving(false);
    });
    autosaveQueueRef.current = save;
    await save;
  };

  const downloadAutosaveRecovery = () => {
    downloadBrowserBlob(new Blob([JSON.stringify(autosaveState.recoveryCopies ?? [], null, 2)], { type: "application/json" }), "Pantokrator-Atlas-autosave-recovery.json");
  };

  const reloadAutosaveAfterConflict = async () => {
    const recoveryStatus = importGuardRef.current.begin();
    const divergent = autosaveState.conflict?.reason === "divergent-copies";
    const preferredBackend = divergent ? autosaveState.conflict?.alternateBackend : undefined;
    try {
      // Finish pending local saves before reading their durable successor.
      await autosaveQueueRef.current.catch(() => undefined);
      if (recoveryStatus() !== "current") return;
      const result = await loadProjectAutosave(undefined, preferredBackend ? { preferredBackend } : undefined);
      if (recoveryStatus() !== "current") {
        if (recoveryStatus() === "changed") setToast("Recovery copy not loaded because the current atlas changed. Your edits and Undo history were kept.");
        return;
      }
      if (!result.project) {
        setToast(`${divergent ? "The other preserved copy" : "The newer autosave"} is no longer available; the current atlas was kept.`);
        return;
      }
      // Recovery inspection is lossless: no name reroll, and Undo retains the
      // displaced local project rather than erasing its only recovery path.
      if (!commit(result.project, true, false)) return;
      rangeEditStartRef.current = undefined;
      autosaveRevisionRef.current = result.revision ?? null;
      setAutosaveState(result);
      setAutosaveSaving(false);
      setActivePlaneId(result.project.planes[0]?.id ?? "");
      setSelectedId(undefined);
      setLinkSource(undefined);
      setGateSource(undefined);
      clearActionError("device-save");
      setToast(`${divergent ? "Loaded the other preserved device copy for inspection." : "Loaded the newer device autosave."} Undo restores your previous local atlas.`);
    } catch (error) {
      if (recoveryStatus() === "current") showActionError("device-save", error, "Recovery could not be loaded; the current atlas and Undo history were kept.");
    }
  };

  if (!activePlane) return <main className="empty-state">No plane is available.</main>;

  const setupSection = (id: string, defaultOpen: boolean): SetupSectionState => ({
    open: openSetupSections[id] ?? defaultOpen,
    onToggle: (open) => setOpenSetupSections((current) => current[id] === open ? current : { ...current, [id]: open }),
  });
  const oceanLayoutLabel = OCEAN_LAYOUTS.find((item) => item.value === (project.settings.oceanLayout ?? "natural"))?.label ?? "Natural / varied";
  const economyBalance = ECONOMY_BALANCE_MODES.find((item) => item.value === normalizeEconomyBalanceMode(project.settings.economyBalance))!;
  const overlandTopology = OVERLAND_TOPOLOGY_MODES.find((item) => item.value === normalizeOverlandTopologyMode(project.settings.overlandTopology))!;
  const resolutionLabel = project.settings.resolution === "custom" ? "Custom per plane" : RESOLUTION_PRESETS[project.settings.resolution].label;
  const wrapSummary = activePlane.wrapX && activePlane.wrapY ? "wraps east/west and north/south"
    : activePlane.wrapX ? "wraps east/west only" : activePlane.wrapY ? "wraps north/south only" : "does not wrap";
  const activePlaneAutoSized = activePlane.autoSize ?? project.planes[0]?.id === activePlane.id;
  const planeDisplayOverrides = [activePlane.mapNoHide !== undefined, activePlane.noDeepCaves !== undefined, !!activePlane.mapTextColor, !!activePlane.mapDominionColor, !!activePlane.rawDirectives.trim()].filter(Boolean).length;
  const scenarioFlagCount = [project.mapNoHide, project.noDeepCaves, project.noDeepChoice, project.noHomelandNames, project.noNameFilter].filter(Boolean).length;
  const mapDirectiveLines = project.rawDirectives.split("\n").filter((line) => line.trim()).length;

  return (
    <main
      className="atlas-shell"
      aria-busy={!hydrated}
      inert={!hydrated}
      onChangeCapture={(event) => { textChangeTargetRef.current = isTextEntryTarget(event.target) ? event.target : undefined; }}
      onChange={() => { textChangeTargetRef.current = undefined; }}
      onBlur={(event) => { if (event.target === textEditSessionRef.current) textEditSessionRef.current = undefined; }}
    >
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-sigil" aria-hidden="true">P</div>
          <div>
            <p className="eyebrow">DOMINIONS 6 MAP FORGE</p>
            <h1>Pantokrator Atlas</h1>
          </div>
        </div>
        <div className="project-title-wrap">
          <label htmlFor="project-name">Project</label>
          <input
            id="project-name"
            maxLength={MAX_IMPORTED_STRING_LENGTH}
            value={project.name}
            onChange={(event) => mutate((draft) => { draft.name = event.target.value; })}
            aria-label="Project name"
          />
          <span className={`autosave ${(autosaveState.backend === "none" && hydrated) || autosaveState.conflict ? "failed" : ""}`} role="status" aria-live="polite" aria-atomic="true" title={autosaveError}>
            <i aria-hidden="true" /> {autosaveLabel}
            {autosaveError && <span className="sr-only">. {autosaveError}</span>}
          </span>
        </div>
        <div className="top-actions">
          <div className="file-menu" ref={fileMenuRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileMenuOpen(false); }}>
            <button className="button quiet file-menu-trigger" type="button" aria-expanded={fileMenuOpen} aria-controls="file-menu-actions" title="New atlas, Open project, Save now, Download project JSON" onClick={() => setFileMenuOpen((open) => !open)}>File <span aria-hidden="true">▾</span></button>
            {fileMenuOpen && <div id="file-menu-actions" className="file-menu-panel" role="group" aria-label="Project file actions">
              <button className="menu-item" type="button" aria-haspopup="dialog" title="Replace this atlas with a fresh default project (asks first)" onClick={() => { setFileMenuOpen(false); setDestructiveConfirmation({ kind: "new-atlas" }); }}>New atlas</button>
              <button className="menu-item" type="button" title="Open an Atlas project" onClick={() => { setFileMenuOpen(false); importRef.current?.click(); }}>Open project…</button>
              <button className="menu-item" type="button" title="Save this atlas to device autosave now" disabled={!hydrated || autosaveSaving} onClick={() => { setFileMenuOpen(false); void saveAutosaveNow(false); }}>Save now</button>
              <button className="menu-item" type="button" title="Download an editable backup you can reopen with Open project" onClick={() => { setFileMenuOpen(false); downloadProject(project); setToast("Editable project downloaded."); }}>Download project JSON</button>
            </div>}
          </div>
          <button className="icon-button" type="button" onClick={handleUndo} disabled={!undoStack.length} title="Undo" aria-label="Undo">↶</button>
          <button className="icon-button" type="button" onClick={handleRedo} disabled={!redoStack.length} title="Redo" aria-label="Redo">↷</button>
          <button className="button quiet" type="button" onClick={() => setValidationOpen(true)}>
            Validate <span className={errorCount ? "count error" : warningCount ? "count warning" : "count ok"}>{errorCount || warningCount || "✓"}</span>
          </button>
          <button className="button primary" type="button" onClick={() => setExportOpen(true)}>Install / export</button>
        </div>
      </header>

      <nav className="narrow-nav" aria-label="Workbench sections">
        <button type="button" onClick={() => revealSection(canvasColumnRef.current, true)}>Map</button>
        <button type="button" onClick={() => revealSection(rightPanelRef.current, true)}>{selected ? `Province ${selected.index}` : "Province"}</button>
        <button type="button" onClick={() => revealSection(leftPanelRef.current, true)}>Setup</button>
      </nav>

      {autosaveState.conflict && <section className="autosave-conflict" role="alert" aria-live="assertive">
        <div>{autosaveState.conflict.reason === "unreadable-copy"
          ? <><strong>A saved project could not be opened.</strong><span>The original saved data is preserved and automatic saving is paused. Download it for recovery. Keeping this copy also downloads a backup before replacing the saved data.</span></>
          : autosaveState.conflict.reason === "divergent-copies"
          ? <><strong>Two preserved device copies differ.</strong><span>IndexedDB and local storage contain different valid atlases. Automatic saving is paused; inspect the other copy, then explicitly keep the version you want.</span></>
          : <><strong>A newer device autosave exists.</strong><span>Another Atlas tab changed the shared copy. Automatic saving is paused so neither version is silently overwritten.</span></>}</div>
        {autosaveState.conflict.reason === "unreadable-copy"
          ? <button className="button quiet" type="button" onClick={downloadAutosaveRecovery}>Download recovery data</button>
          : <button className="button quiet" type="button" onClick={() => { void reloadAutosaveAfterConflict(); }}>{autosaveState.conflict.reason === "divergent-copies" ? "Inspect other copy" : "Load newer copy"}</button>}
        <button className="button primary" type="button" onClick={() => { void saveAutosaveNow(true); }}>Keep this copy</button>
      </section>}

      <div className="workbench">
        <aside className="left-panel panel" ref={leftPanelRef} aria-label="Setup panel">
          <div className="tab-row compact-tabs" role="tablist" aria-label="Map setup">
            {LEFT_TABS.map((tab) => (
              <button key={tab} id={`setup-tab-${tab}`} type="button" role="tab" tabIndex={leftTab === tab ? 0 : -1} aria-selected={leftTab === tab} aria-controls="setup-active-panel" className={leftTab === tab ? "active" : ""} onClick={() => setLeftTab(tab)} onKeyDown={(event) => handleTabKey(event, LEFT_TABS, leftTab, setLeftTab)}>
                {tab === "generate" ? "Generate" : tab === "planes" ? "Planes" : tab === "scenario" ? "Scenario" : "Iterate"}
              </button>
            ))}
          </div>

          {leftTab === "generate" && (
            <div id="setup-active-panel" className="panel-scroll setup-stack setup-form" role="tabpanel" aria-labelledby="setup-tab-generate">
              <SetupSection title="Basics" scope="Next generation" note={`${project.settings.players} players × ${project.settings.provincesPerPlayer} provinces · seed ${project.seed}`} {...setupSection("generate-basics", true)}>
                <div className="field">
                  <span><label htmlFor="generator-seed">Seed</label></span>
                  <div className="input-with-button">
                    <input id="generator-seed" maxLength={MAX_IMPORTED_STRING_LENGTH} value={project.seed} aria-describedby="generator-seed-help" onChange={(event) => mutate((draft) => { draft.seed = event.target.value; })} />
                    <button type="button" onClick={() => mutate((draft) => { draft.seed = randomSeed(); })} aria-label="Randomize seed" title="Choose a fresh seed for the next Generate">✣</button>
                  </div>
                </div>
                <Hint id="generator-seed-help" topic="the seed" more={<p>Saved projects keep theirs. Changing this seed takes effect when you Generate; use a name reroll to keep the current map.</p>}>New atlases start with a random seed.</Hint>
                <div className="field-grid two">
                  <NumberField label="Players" value={project.settings.players} min={2} max={32}
                    onEditStart={() => {
                      const { settings } = currentProjectRef.current;
                      playersEditBaseRef.current = { players: settings.players, distribution: settings.startDistribution ?? defaultStartDistribution(settings.players) };
                    }}
                    onEditEnd={() => { playersEditBaseRef.current = undefined; }}
                    onChange={(value) => mutate((draft) => {
                      // Resize from the allocation present when typing began, so an
                      // intermediate keystroke ("2" while typing "20") cannot
                      // permanently shrink coastal, water, or cave starts.
                      const base = playersEditBaseRef.current ?? {
                        players: draft.settings.players,
                        distribution: draft.settings.startDistribution ?? defaultStartDistribution(draft.settings.players),
                      };
                      draft.settings.startDistribution = resizeStartDistribution(base.distribution, base.players, value);
                      draft.settings.players = value;
                    })} />
                  <NumberField label="Provinces / player" value={project.settings.provincesPerPlayer} min={8} max={30} onChange={(value) => mutate((draft) => { draft.settings.provincesPerPlayer = value; })} />
                </div>
                <GenerationPlanSummary project={project} onReview={() => setBalanceOpen(true)} />
              </SetupSection>
              <SetupSection title="Starts" scope="Next generation" note={`${allocatedStarts} of ${project.settings.players} allocated · ${project.settings.startDegreeTarget ?? 4} useful connections`} {...setupSection("generate-starts", true)}>
                <div className="start-allocation-grid" role="group" aria-label="Start allocation">
                  {START_TYPES.map((item) => <NumberField
                    key={item.value}
                    label={`${item.label} starts`}
                    value={startDistribution[item.value]}
                    min={0}
                    max={32}
                    describedBy={START_ALLOCATION_STATUS_ID}
                    onChange={(value) => mutate((draft) => {
                      const distribution = draft.settings.startDistribution ?? defaultStartDistribution(draft.settings.players);
                      draft.settings.startDistribution = { ...distribution, [item.value]: value };
                    })}
                  />)}
                </div>
                <NumberField label="Target useful connections at starts" value={project.settings.startDegreeTarget ?? 4} min={1} max={8} onChange={(value) => mutate((draft) => { draft.settings.startDegreeTarget = value; })} />
                <Hint topic="start counts and connections" more={<p>Land, coast, water, cave, and other counts must total the player count. Four useful connections is the recommended multiplayer baseline; targets from five to eight use the closest feasible common degree when the province geometry cannot give every start the requested value.</p>}>Four is the recommended baseline; higher targets are best-effort.</Hint>
                <SetupSection className="setup-subsection" title="Deterministic cave-start nations" note={caveStartNations.length ? `${caveStartNations.length} selected` : "None · native preference"} {...setupSection("generate-cave-nations", caveStartNations.length > 0)}>
                  <CaveStartNationField
                    values={caveStartNations}
                    caveStartCount={startDistribution.cave}
                    hasCaveFamilyPlane={project.planes.some((plane) => CAVE_FAMILY_KINDS.has(plane.kind))}
                    entries={playableNations}
                    onChange={(values) => mutate((draft) => updateCaveStartNations(draft, values))}
                  />
                </SetupSection>
              </SetupSection>
              {authoredStartNotices.length > 0 && (
                <div id="authored-start-notices" className="warning-copy authored-start-notices" role="status" aria-live="polite" aria-atomic="true">
                  <strong>Nation-specific starts need spacing.</strong>
                  <ul>{authoredStartNotices.map((notice) => <li key={`${notice.planeId}:${notice.provinceId}`}>
                    {notice.message}{" "}
                    <button className="text-button danger-text" type="button" onClick={() => mutate((draft) => {
                      setNationSpecificStart(draft, notice.planeId, notice.provinceId, undefined);
                    })}>Remove nation {notice.nation} start</button>
                  </li>)}</ul>
                </div>
              )}
              <GenerationBalanceNotice issues={issues} generationWarnings={project.generationWarnings} />
              <SetupSection title="World shape" scope="Next generation" note={`${project.settings.waterPercent}% water · ${oceanLayoutLabel} · ${project.settings.biomeCohesion}% cohesion`} {...setupSection("generate-world", true)}>
                <RangeField label="Water provinces" value={project.settings.waterPercent} suffix="%" min={0} max={60} onInteractionStart={beginRangeEdit} onInteractionEnd={finishRangeEdit} onChange={(value) => mutate((draft) => { draft.settings.waterPercent = value; }, false)} />
                <Field label="Overland ocean layout">
                  <select value={project.settings.oceanLayout ?? "natural"} onChange={(event) => mutate((draft) => { draft.settings.oceanLayout = event.target.value as OceanLayout; })}>
                    {OCEAN_LAYOUTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                <Hint topic="ocean layouts" more={<p>Continent and island styles shape larger seas; Central inland sea creates an enclosed basin. Saved maps keep their outlines until Generate.</p>}>New maps use irregular shared coastlines.</Hint>
                {(project.settings.oceanLayout ?? "natural") === "island_chains" && <Hint topic="island chains" more={<p>Narrow islands may not fit enough inland Land starts with safe exits and spacing. Allocate more Coastal starts, increase provinces per player, or choose a continental layout if generation reports missing starts.</p>}>Island chains use at least {ISLAND_CHAIN_MIN_WATER_PERCENT}% water so land is genuinely separated; Generate records that effective value when the slider is lower.</Hint>}
                {(project.settings.oceanLayout ?? "natural") === "multiple_continents" && <>
                  <NumberField
                    label="Major continents"
                    value={project.settings.continentCount ?? 3}
                    min={2}
                    max={6}
                    onChange={(value) => mutate((draft) => { draft.settings.continentCount = value; })}
                  />
                  <Hint topic="continent targets" more={<p>If the water quota and wrapping cannot sustain every requested landmass, Generate and validation report the achieved count.</p>}>This is a topology target.</Hint>
                </>}
                <RangeField label="Biome cohesion" value={project.settings.biomeCohesion} suffix="%" min={0} max={100} onInteractionStart={beginRangeEdit} onInteractionEnd={finishRangeEdit} onChange={(value) => mutate((draft) => { draft.settings.biomeCohesion = value; }, false)} />
                <Hint topic="biome cohesion" more={<p>Lower cohesion creates more local variation and patchwork; higher cohesion creates larger contiguous biome regions. Minimum terrain variety remains enforced.</p>}>Lower values make smaller, more varied terrain patches.</Hint>
              </SetupSection>
              <SetupSection title="Balance & routes" scope="Next generation" note={`${economyBalance.label} · ${overlandTopology.label} · ${project.settings.throneCount} thrones`} {...setupSection("generate-balance", true)}>
                <Field label="Economy balance">
                  <select value={economyBalance.value} onChange={(event) => mutate((draft) => { draft.settings.economyBalance = event.target.value as EconomyBalanceMode; })}>
                    {ECONOMY_BALANCE_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                <Hint>{economyBalance.description}</Hint>
                <Field label="Overland topology">
                  <select value={overlandTopology.value} onChange={(event) => mutate((draft) => { draft.settings.overlandTopology = event.target.value as OverlandTopologyMode; })}>
                    {OVERLAND_TOPOLOGY_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                <Hint topic="overland topology" more={<><p>This affects only solid Surface and surface-like Custom planes; sparse and cave realms keep their authored route profiles.</p><p>Every shared border is a Dominions connection. Rivers, passes, roads, and impassable borders are drawn directly on that boundary.</p></>}>{overlandTopology.description}</Hint>
                <NumberField label="Recommended throne locations" value={project.settings.throneCount} min={0} max={64} onChange={(value) => mutate((draft) => { draft.settings.throneCount = value; })} />
              </SetupSection>
              <SetupSection title="Plane size & output" scope="Next generation" note={`${project.settings.specialPlaneSizePercent ?? 30}% bonus planes · ${resolutionLabel}`} {...setupSection("generate-output", false)}>
                <NumberField label="Each bonus plane size (% of core)" value={project.settings.specialPlaneSizePercent ?? 30} min={1} max={500} onChange={(value) => mutate((draft) => { draft.settings.specialPlaneSizePercent = value; })} />
                <Hint topic="bonus plane size" more={<p>Players x provinces per player sizes only Surface, Cave, Cavern, and surface-like Custom core realms. Every auto-sized special plane independently uses this percentage of the combined core total; values over 100% are allowed, up to the 800-province per-plane cap.</p>}>Each auto-sized bonus plane gets this share of the core total.</Hint>
                <Field scope="Current Map + next generation" label="Output resolution">
                  <select value={project.settings.resolution} onChange={(event) => commit(applyResolution(project, event.target.value as GenerationSettings["resolution"]))}>
                    {Object.entries(RESOLUTION_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}
                    <option value="custom">Custom per plane</option>
                  </select>
                </Field>
                <div className="resolution-card">
                  <span>{activePlane.width.toLocaleString("en-US")} × {activePlane.height.toLocaleString("en-US")}</span>
                  <small>Native or illustrated game export</small>
                </div>
                <Hint>Selected plane ({activePlane.name}) {wrapSummary}. Wrapping is set per plane.</Hint>
                <button className="button quiet wide" type="button" onClick={() => setLeftTab("planes")}>Configure plane archetypes &amp; selected links</button>
              </SetupSection>
              <SetupSection title="Province names" scope="Current Map" note={`Fresh names on open: ${project.settings.randomizeNamesOnLoad ? "on" : "off"}`} {...setupSection("generate-names", false)}>
                <button className="button quiet wide" type="button" onClick={handleRegenerateProvinceNames}>Reroll generated names (preserve manual)</button>
                <Hint topic="province names" more={<p>Names follow each plane and its effective terrain, including coasts, flooded caves, and the River Styx. Names edited in the province inspector are marked manual and survive map generation and name rerolls.</p>}>Name rerolls apply immediately; manual names are kept.</Hint>
                <Toggle scope="On project open" label="Fresh generated names on open" checked={project.settings.randomizeNamesOnLoad ?? false} describedBy="fresh-names-help" onChange={(value) => mutate((draft) => { draft.settings.randomizeNamesOnLoad = value; })} />
                <Hint id="fresh-names-help" topic="fresh names on open" more={<p>Off by default. When enabled, reopening this project or restoring it on page load shuffles generated names only. Manual and legacy names, the world seed, terrain, and starts stay unchanged. Turn off before sharing a map with fixed names. Autosave conflict/recovery copies are never renamed.</p>}>Off by default. Reopening shuffles generated names only.</Hint>
                <button
                  className="text-button danger-text"
                  type="button"
                  aria-expanded={replaceAllNamesOpen}
                  aria-controls="replace-all-names-confirmation"
                  onClick={() => setReplaceAllNamesOpen((open) => !open)}
                >Replace every province name…</button>
                {replaceAllNamesOpen && (
                  <div id="replace-all-names-confirmation" className="warning-copy" role="group" aria-label="Confirm replacing every province name">
                    <p>This also replaces manual and legacy names. Use it to repair duplicate names in projects created before name provenance existed. The change is Undoable.</p>
                    <div className="catalog-actions">
                      <button className="button quiet" type="button" onClick={() => setReplaceAllNamesOpen(false)}>Cancel</button>
                      <button className="button quiet danger-text" type="button" onClick={handleRegenerateAllProvinceNames}>Replace every province name</button>
                    </div>
                  </div>
                )}
              </SetupSection>
              <div className="setup-reset">
                <button
                  className="text-button"
                  type="button"
                  aria-label="Reset generator defaults"
                  title="Restore Generate-tab defaults without replacing the current map"
                  onClick={() => mutate((draft) => resetGeneratorDefaults(draft, activePlane.id))}
                >Reset generator defaults</button>
                <Hint topic="resetting generator defaults" more={<p>Restores generator controls, current output dimensions, and the selected plane’s default wrap. Provinces, scenario setup, gate plans, and manual content stay in place; Undo restores the prior values.</p>}>Keeps the current map and is Undoable.</Hint>
              </div>
            </div>
          )}

          {leftTab === "planes" && (
            <div id="setup-active-panel" className="panel-scroll setup-stack setup-form" role="tabpanel" aria-labelledby="setup-tab-planes">
              <SectionHeading kicker="MULTI-REALM" title={`${project.planes.length} of ${MAX_PLANES} planes`} />
              <div className="plane-list" role="group" aria-label="Generation plan planes">
                {project.planes.map((plane, index) => (
                  <button
                    className={`plane-list-item ${plane.id === activePlane.id ? "active" : ""}`}
                    key={plane.id}
                    type="button"
                    aria-pressed={plane.id === activePlane.id}
                    onClick={() => { setActivePlaneId(plane.id); setSelectedId(undefined); }}
                  >
                    <span className={`plane-gem kind-${plane.kind}`}>{index + 1}</span>
                    <span><strong>{plane.name}</strong><small>{plane.provinces.length ? `${plane.provinces.length} provinces` : "Draft — not generated"} · {plane.kind}</small></span>
                    <i className={issues.some((issue) => issue.severity === "error" && issue.planeId === plane.id) ? "bad" : "good"} />
                  </button>
                ))}
              </div>
              <button
                className="button quiet wide"
                type="button"
                disabled={project.planes.length >= MAX_PLANES}
                onClick={stagePlane}
              >+ Add plane to plan</button>
              <SetupSection title="Selected plane" scope="Current Map + next generation" note={planeDisplayLabel(project, activePlane)} {...setupSection("planes-selected", true)}>
                <Field scope="Current Map" label="Plane name"><input maxLength={MAX_IMPORTED_STRING_LENGTH} value={activePlane.name} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.name = event.target.value; })} /></Field>
                <Field label="Plane archetype"><select value={activePlane.kind} onChange={(event) => mutate((draft) => {
                  updatePlaneArchetype(draft, activePlane.id, event.target.value as PlaneKind);
                })}>{PLANE_KINDS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>
                <Hint topic="realm scenery" more={activePlane.kind !== "surface" && activePlane.kind !== "custom" && <p>{activePlane.kind === "cloud" || activePlane.kind === "air"
                  ? "Procedural floating islands and cloud banks respond to terrain conditions and winter. Choose Illustrated realms in Install / export to include this artwork in the game; Native scenery keeps the game’s own renderer. PNG previews remain available separately."
                  : "Procedural realm scenery, rock edges and terrain details follow the current province shapes and flags. Water remains aquatic, including flooded caves and the Styx. Choose Illustrated realms in Install / export to include the artwork in-game; Native scenery keeps the game’s own renderer."}</p>}>{PLANE_KINDS.find((item) => item.value === activePlane.kind)?.description}</Hint>
                <Field label="Terrain variant"><select value={activePlane.variant ?? defaultVariantForKind(activePlane.kind)} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.variant = event.target.value as PlaneVariant; })}>{PLANE_VARIANTS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>
                <PlaneLayoutInfo plane={activePlane} />
                <Toggle label="Wrap east / west" checked={activePlane.wrapX} onChange={(value) => updateWrap("wrapX", value)} />
                <Toggle label="Wrap north / south" checked={activePlane.wrapY} onChange={(value) => updateWrap("wrapY", value)} />
                {project.settings.resolution === "custom" && (
                  <>
                    <div className="field-grid two">
                      <NumberField label="Width" value={activePlane.width} min={256} max={3840} onChange={(value) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.width = value; })} />
                      <NumberField label="Height" value={activePlane.height} min={256} max={3840} onChange={(value) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.height = value; })} />
                    </div>
                    <Hint>Each axis is capped at 3,840 pixels; width × height must remain at or below 8.29 megapixels.</Hint>
                  </>
                )}
                {project.planes.length > 1 && (
                  <button className="text-button danger-text" type="button" aria-haspopup="dialog" disabled={generationBusy} title={generationBusy ? "Cancel generation before removing a plane." : undefined} onClick={() => requestRemovePlane(activePlane.id)}>Remove this plane…</button>
                )}
              </SetupSection>
              <SetupSection title="Generation preferences" scope="Next generation" note={activePlaneAutoSized ? "Auto-sized" : `${activePlane.provinceTarget} provinces`} {...setupSection("planes-generation", true)}>
                <Toggle label="Auto-size from player count" checked={activePlaneAutoSized} onChange={(value) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.autoSize = value; })} />
                {activePlaneAutoSized
                  ? <div className="plane-info-card"><span>Automatic province count</span><small>{planeAutoSizeDescription(project, activePlane)}</small></div>
                  : <NumberField label="Province target" value={activePlane.provinceTarget} min={8} max={800} onChange={(value) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.provinceTarget = value; })} />}
                <PlaneStartPolicyControl plane={activePlane} onChange={(value) => mutate((draft) => {
                  draft.planes.find((plane) => plane.id === activePlane.id)!.noGeneratedStarts = value || undefined;
                })} />
                <PlanePreferencesPanel key={activePlane.id} plane={activePlane} onChange={value=>mutate(draft=>{
                  const plane=draft.planes.find(p=>p.id===activePlane.id)!;
                  if(value===undefined)delete plane.generationOverrides;else plane.generationOverrides=value;
                })} />
              </SetupSection>
              <SetupSection title="Display, flags & plane directives" scope="Host / export" note={planeDisplayOverrides ? `${planeDisplayOverrides} custom setting${planeDisplayOverrides === 1 ? "" : "s"}` : "All inherited"} {...setupSection("planes-display", false)}>
                <Field label="Reveal this plane's map image"><select value={optionalBooleanValue(activePlane.mapNoHide)} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.mapNoHide = parseOptionalBoolean(event.target.value); })}><option value="inherit">Inherit scenario setting</option><option value="on">On</option><option value="off">Off</option></select></Field>
                <Field label="Disable random deep caves from this plane"><select value={optionalBooleanValue(activePlane.noDeepCaves)} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.noDeepCaves = parseOptionalBoolean(event.target.value); })}><option value="inherit">Inherit scenario setting</option><option value="on">On</option><option value="off">Off</option></select></Field>
                <Field label="Province-name color (#maptextcol)"><input placeholder="0.93 0.88 0.70 1.0" value={activePlane.mapTextColor ?? ""} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.mapTextColor = event.target.value || undefined; })} /></Field>
                <Field label="Dominion-overlay color (#mapdomcol)"><input placeholder="238 205 112 42" value={activePlane.mapDominionColor ?? ""} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.mapDominionColor = event.target.value || undefined; })} /></Field>
                <Field label="Plane directives"><textarea maxLength={MAX_IMPORTED_DIRECTIVE_LENGTH} className="code-input" rows={5} placeholder={"-- Notes, then plane-level #commands\n-- one per line"} value={activePlane.rawDirectives} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.rawDirectives = event.target.value; })} /></Field>
                <Hint topic="plane directives" more={<p>Only lines beginning with <code>#</code> or <code>--</code> are exported; other text is discarded. Raw commands are not syntax-checked, and any active <code>#</code> command blocks Illustrated realms export.</p>}>Appended at the end of this plane’s map file.</Hint>
              </SetupSection>
              <SetupSection title="Planned links" scope="Next generation" note={project.planes.length > 1 ? `${selectedPlaneConnectionRules.filter((rule) => rule.enabled !== false).length} enabled from ${activePlane.name}` : "Add a plane to plan links"} {...setupSection("planes-links", project.planes.length > 1)}>
                <Field label="All-plane preset (quick seed)"><select value={project.settings.gateLayout ?? "hub"} onChange={(event) => mutate((draft) => {
                   const layout = event.target.value as GateLayout;
                   draft.settings.gateLayout = layout;
                   draft.settings.gateDirection = "bidirectional";
                   draft.settings.planeConnections = createDefaultPlaneConnections(draft.planes, layout, draft.settings.gatePairsPerConnection ?? 1);
                 })}>{GATE_LAYOUTS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>
                <Hint topic="link presets" more={<p>Presets seed every plane; the rows below customize only {activePlane.name}. These rules are used on the next generation and do not change existing gateways. Every enabled link is bidirectional.</p>}>{GATE_LAYOUTS.find((item) => item.value === (project.settings.gateLayout ?? "hub"))?.description}</Hint>
                <NumberField label="Default pairs for all enabled links" value={project.settings.gatePairsPerConnection ?? 1} min={1} max={3} onChange={(value) => mutate((draft) => {
                   draft.settings.gatePairsPerConnection = value;
                   draft.settings.gateDirection = "bidirectional";
                   draft.settings.planeConnections = resolvePlaneConnectionRules(draft).map((rule) => ({ ...rule, pairs: value }));
                 })} />
                <div className="plane-connection-list" aria-label={`Connections from ${activePlane.name}`}>
                  {selectedPlaneConnectionRules.map((rule) => {
                     const source = project.planes.find((plane) => plane.id === rule.a);
                     const destination = project.planes.find((plane) => plane.id === rule.b);
                     if (!source || !destination) return null;
                    const otherPlane = source.id === activePlane.id ? destination : source;
                    const activeLabel = planeDisplayLabel(project, activePlane);
                    const otherLabel = planeDisplayLabel(project, otherPlane);
                    const compatible = gateCompatibility(activePlane.kind, otherPlane.kind);
                     return <div className={`plane-connection-row ${rule.enabled === false ? "disabled" : ""}`} key={`${rule.a}:${rule.b}`}>
                      <label className="plane-connection-toggle" aria-label={`Connect ${activeLabel} and ${otherLabel}`}><input type="checkbox" checked={rule.enabled !== false} onChange={(event) => mutate((draft) => {
                         draft.settings.gateDirection = "bidirectional";
                         draft.settings.planeConnections = resolvePlaneConnectionRules(draft).map((item) => item.a === rule.a && item.b === rule.b ? { ...item, enabled: event.target.checked } : item);
                      })} /><span><strong>{otherLabel}</strong><small>Bidirectional with {activeLabel} · {compatible}% archetype compatibility</small></span></label>
                      <label className="plane-pair-count"><span>Pairs</span><input type="number" min={1} max={3} value={rule.pairs} disabled={rule.enabled === false} aria-label={`Gate pairs between ${activeLabel} and ${otherLabel}`} onChange={(event) => mutate((draft) => {
                        const pairs = numberValue(event.target.value, 1);
                        draft.settings.planeConnections = resolvePlaneConnectionRules(draft).map((item) => item.a === rule.a && item.b === rule.b ? { ...item, pairs: Math.max(1, Math.min(3, pairs)) } : item);
                      })} /></label>
                     </div>;
                   })}
                  {!selectedPlaneConnectionRules.length && <p>Add another plane to configure a connection from {activePlane.name}.</p>}
                 </div>
              </SetupSection>
              <SetupSection title={`Existing gateways (${activePlaneGates.length})`} scope="Current Map" note={`Touching ${activePlane.name}`} {...setupSection("planes-gateways", false)}>
                <Hint topic="existing gateways" more={<p>These are saved <code>#gate</code> records in the current project—whether generated or placed manually—and are separate from the next-generation rules above. Every endpoint sharing a number is connected bidirectionally in Dominions 6.</p>}>Actual <code>#gate</code> groups saved in this map.</Hint>
                <ExistingGatewaysEditor project={project} activePlane={activePlane} gates={activePlaneGates} mutateProject={mutate} onNotice={setToast} />
              </SetupSection>
            </div>
          )}

          {(leftTab === "generate" || leftTab === "planes") && <section className="setup-action-bar" aria-label="Generate atlas">
            <div id={START_ALLOCATION_STATUS_ID} className={`allocation-summary ${allocatedStarts === project.settings.players ? "valid" : "invalid"}`} role="status" aria-live="polite" aria-atomic="true">
              <span>{allocatedStarts} of {project.settings.players} starts allocated. {allocatedStarts === project.settings.players ? "Allocation complete." : "Counts must equal the player total."}</span>
              {allocatedStarts < project.settings.players && <button type="button" onClick={() => mutate((draft) => {
                const distribution = draft.settings.startDistribution ?? defaultStartDistribution(draft.settings.players);
                const nonLand = distribution.coastal + distribution.water + distribution.cave + distribution.other;
                draft.settings.startDistribution = { ...distribution, land: Math.max(0, draft.settings.players - nonLand) };
              })}>Put remainder on land</button>}
            </div>
            {startPlanErrors.length > 0 && (
              <div id="start-plan-errors" className="warning-copy start-plan-errors" role="alert" aria-live="polite" aria-atomic="true">
                <strong>Generation plan cannot place all starts.</strong>
                <ul>{startPlanErrors.map((message) => <li key={message}>{message}</li>)}</ul>
              </div>
            )}
            <button
              className="button generate-button"
              type="button"
              disabled={allocatedStarts !== project.settings.players || startPlanErrors.length > 0 || generationBusy}
              aria-describedby={`${START_ALLOCATION_STATUS_ID}${startPlanErrors.length ? " start-plan-errors" : ""}${authoredStartNotices.length && leftTab === "generate" ? " authored-start-notices" : ""}${generationBusy && generationProgress ? " generation-progress" : ""}`}
              onClick={handleGenerate}
            ><span aria-hidden="true">✦</span> {generationBusy ? "Generating atlas…" : `Generate balanced atlas (${project.planes.length} plane${project.planes.length === 1 ? "" : "s"})`}</button>
            {generationBusy && generationProgress && (
              <div id="generation-progress" className="generation-progress" role="status" aria-live="polite" aria-atomic="true" aria-busy="true">
                <progress aria-label="Atlas generation in progress" />
                <strong>{generationProgress.message}</strong>
                <small>The existing atlas remains available and is replaced only after a complete result.</small>
                <button className="button quiet danger-text" type="button" onClick={handleCancelGeneration}>Cancel generation</button>
              </div>
            )}
            <div className="setup-action-foot">
              {projectTopologyIssueCount
                ? <button className="text-button" type="button" onClick={handleSynchronizeBorders}>Synchronize {projectTopologyIssueCount} project border issue{projectTopologyIssueCount === 1 ? "" : "s"}</button>
                : <span>Visible borders synchronized</span>}
            </div>
          </section>}

          {leftTab === "iterate" && <div id="setup-active-panel" className="panel-scroll setup-stack" role="tabpanel" aria-labelledby="setup-tab-iterate">
            <IterationPanel key={activePlane.id} project={project} planeId={activePlane.id} selectedId={selectedId} catalog={catalog} busy={generationBusy || exportBusy}
              onCommit={(next, expectedSource) => {
                if (currentProjectRef.current !== expectedSource) { setToast("The project changed after this preview. Preview the operation again; the current atlas was kept."); return false; }
                next.updatedAt = new Date().toISOString();
                if (!commit(next)) return false;
                if (!next.planes.find(p => p.id === activePlane.id)?.provinces.some(p => p.id === selectedId)) setSelectedId(undefined);
                setLinkSource(undefined); setGateSource(undefined);
                setToast("Applied the previewed change. Undo restores the previous atlas.");
                return true;
              }}
              onHighlight={(ids, label) => { setAnalysisSelection({project,keys:ids.map(id=>`${activePlane.id}:${id}`),label,mode:"structural",kind:"iteration"});setTool("select");setLinkSource(undefined);setGateSource(undefined); }} />
          </div>}
          {leftTab === "scenario" && (
            <div id="setup-active-panel" className="panel-scroll setup-stack setup-form" role="tabpanel" aria-labelledby="setup-tab-scenario">
              <SetupSection title="Game info" scope="Host / export" note={`#domversion ${project.targetVersion}`} {...setupSection("scenario-game", true)}>
                <Field label="Description"><textarea maxLength={MAX_IMPORTED_STRING_LENGTH} rows={3} value={project.description} onChange={(event) => mutate((draft) => { draft.description = event.target.value; })} /></Field>
                <NumberField label="Minimum Dominions version (#domversion)" value={project.targetVersion} min={600} max={999} onChange={(value) => mutate((draft) => { draft.targetVersion = value; })} />
                <Hint topic="the minimum version" more={<p>The bundled selector catalog is pinned to Dominions {BUILTIN_DOM6_CATALOG.gameVersion}; population-matched defenders use the separate host-patch declaration.</p>}>This declares the minimum game version, not the host’s actual patch.</Hint>
              </SetupSection>
              <SetupSection title="Victory & rules" scope="Host / export" note={`Sail ${project.sailDistance} · sites ${project.settings.siteFrequency ?? 50} · ${project.victoryPoints === undefined ? "no ascension target" : `${project.victoryPoints} ascension points`}`} {...setupSection("scenario-rules", false)}>
                <div className="field-grid two">
                  <NumberField label="Sail distance" value={project.sailDistance} min={1} max={10} onChange={(value) => mutate((draft) => { draft.sailDistance = value; })} />
                  <NumberField label="Site frequency" value={project.settings.siteFrequency ?? 50} min={0} max={100} onChange={(value) => mutate((draft) => { draft.settings.siteFrequency = value; })} />
                </div>
                <OptionalNumberField label="Ascension points" value={project.victoryPoints} min={1} max={999} onChange={(value) => mutate((draft) => { draft.victoryPoints = value; })} />
              </SetupSection>
              <SetupSection title="Nations & AI" scope="Host / export" note={`${project.allowedPlayers.length ? `${project.allowedPlayers.length} allowed` : "All nations allowed"} · ${project.computerPlayers.length} AI · ${project.cannotWin.length} cannot win`} {...setupSection("scenario-nations", false)}>
                <CatalogIdSetField label="Allowed nations" values={project.allowedPlayers} entries={playableNations} onChange={(values) => mutate((draft) => { draft.allowedPlayers = values; })} />
                <ComputerPlayersField values={project.computerPlayers} entries={playableNations} onChange={(values) => mutate((draft) => { draft.computerPlayers = values; })} />
                <CatalogIdSetField label="Cannot-win nations" values={project.cannotWin} entries={playableNations} onChange={(values) => mutate((draft) => { draft.cannotWin = values; })} />
              </SetupSection>
              <SetupSection title="Visibility & naming" scope="Host / export" note={`${scenarioFlagCount} of 5 on`} {...setupSection("scenario-visibility", false)}>
                <Toggle label="Reveal map image" checked={project.mapNoHide} onChange={(value) => mutate((draft) => { draft.mapNoHide = value; })} />
                <Toggle label="Disable random deep-cave planes" checked={project.noDeepCaves} onChange={(value) => mutate((draft) => { draft.noDeepCaves = value; })} />
                <Toggle label="Hide deep-plane choice" checked={project.noDeepChoice} onChange={(value) => mutate((draft) => { draft.noDeepChoice = value; })} />
                <Toggle label="Disable homeland names" checked={project.noHomelandNames} onChange={(value) => mutate((draft) => { draft.noHomelandNames = value; })} />
                <Toggle label="Disable name filter" checked={project.noNameFilter} onChange={(value) => mutate((draft) => { draft.noNameFilter = value; })} />
              </SetupSection>
              <SetupSection title="Population-matched defenders" note={project.populationDefense?.enabled ? `On${populationDefenderCount === undefined ? "" : ` · ${populationDefenderCount} province${populationDefenderCount === 1 ? "" : "s"}`}` : "Off"} {...setupSection("scenario-defenders", project.populationDefense?.enabled ?? false)}>
                <PopulationDefensePanel project={project} catalog={catalog} busy={generationBusy || exportBusy}
                  onPolicyChange={policy => mutate(draft => { draft.populationDefense = policy; })}
                  onContextChange={context => mutate(draft => { draft.analysisContext = context; })}
                  onOpenAssumptions={() => setBalanceOpen(true)} />
              </SetupSection>
              <SetupSection title="Advanced: map-level directives" scope="Host / export" note={mapDirectiveLines ? `${mapDirectiveLines} line${mapDirectiveLines === 1 ? "" : "s"}` : "None"} {...setupSection("scenario-directives", false)}>
                <Field label="Map-level directives"><textarea maxLength={MAX_IMPORTED_DIRECTIVE_LENGTH} className="code-input" rows={7} placeholder={"#god 5 120\n#dominionstr 5 7"} value={project.rawDirectives} onChange={(event) => mutate((draft) => { draft.rawDirectives = event.target.value; })} /></Field>
                <Hint>Raw directives preserve advanced Dominions 6 scenario commands that do not need a dedicated control.</Hint>
              </SetupSection>
              <SetupSection title="Catalog data" note={userCatalog ? "Custom entries active" : `Bundled Dominions ${BUILTIN_DOM6_CATALOG.gameVersion}`} {...setupSection("scenario-catalog", false)}>
                <CatalogManager catalog={catalog} hasUserCatalog={!!userCatalog} onImport={() => catalogImportRef.current?.click()} onReset={resetCatalog} onTemplate={downloadCatalogTemplate} />
              </SetupSection>
            </div>
          )}
        </aside>

        <section className="canvas-column" ref={canvasColumnRef} aria-label="Map">
          <div className="canvas-toolbar">
            <div className="tool-group" role="toolbar" aria-label="Map tools">
              {TOOL_ITEMS.map((item) => (
                <button
                  key={item.id}
                  className={tool === item.id ? "active" : ""}
                  type="button"
                  onClick={() => { setTool(item.id); setLinkSource(undefined); setGateSource(undefined); }}
                  title={item.hint}
                  aria-label={item.label}
                  aria-pressed={tool === item.id}
                ><span>{item.mark}</span><small>{item.label}</small></button>
              ))}
            </div>
            <div className="canvas-controls">
              <div className="map-find" ref={findRef}>
                <ProvinceExplorer project={project} onSelect={(reference) => { inspectProvince(reference); closeFind(); revealSection(rightPanelRef.current); }} />
                <kbd className="map-find-key" aria-hidden="true" title="Press / to find a province">/</kbd>
              </div>
              <label title={CONDITION_PREVIEW_NOTE}>Condition preview <ScopeBadge scope="Preview only" />
                <select value={preview} onChange={(event) => setPreview(event.target.value as PreviewCondition)}>
                  {CONDITIONS.map((condition) => <option value={condition.value} key={condition.value}>{condition.label}</option>)}
                </select>
              </label>
              <details className="toolbar-popover">
                <summary aria-label="About condition previews" title="About condition previews">?</summary>
                <p className="condition-preview-note">{CONDITION_PREVIEW_NOTE}</p>
              </details>
            </div>
          </div>
          <div className="map-stage">
            <MapCanvas key={activePlane.id} plane={activePlane} selectedId={selectedId} previewCondition={preview} markerAnnotations={activePlaneMarkerAnnotations} analysisProvinceIds={analysisProvinceIds} onNavigate={setSelectedId} onActivate={(provinceId) => {
              handleProvinceClick(provinceId);
              if (tool === "select") revealSection(rightPanelRef.current);
            }} onZoomChange={setZoom} tool={tool} />
            {(armedStatus || currentAnalysis) && <div className="map-banners">
              {armedStatus && <div className="pending-link">
                <span role="status" aria-live="polite" aria-atomic="true">{armedStatus}</span>
                <button type="button" onClick={() => { setLinkSource(undefined); setGateSource(undefined); }}>Cancel endpoint</button>
              </div>}
              {currentAnalysis && <div className="analysis-region-banner" role="status"><span>Teal: {currentAnalysis.kind === "iteration" ? `${currentAnalysis.label} · selected provinces` : `${currentAnalysis.label}, 2-step region · ${currentAnalysis.mode === "structural" ? "potential" : "conservative"} routes`} · preview only</span><button type="button" onClick={() => setAnalysisSelection(undefined)}>Clear highlight</button></div>}
            </div>}
            {!currentAnalysis && !armedStatus && activePlane.provinces.length > 0 && <div className="map-title-card">
              <span>{activePlane.kind}</span>
              <strong>{activePlane.name}</strong>
              <small>{activePlane.provinces.length} provinces · {activePlane.width}×{activePlane.height}</small>
              {preview !== "normal" && <em>{CONDITIONS.find((condition) => condition.value === preview)?.label} preview · illustrative only</em>}
            </div>}
            {!activePlane.provinces.length && <div className="draft-plane-overlay">
              <section className="draft-plane-card" aria-labelledby="draft-plane-title">
                <p className="eyebrow">DRAFT PLANE · {(PLANE_KINDS.find((item) => item.value === activePlane.kind)?.label ?? activePlane.kind).toLocaleUpperCase()}</p>
                <h2 id="draft-plane-title">Draft plane — Generate to create provinces</h2>
                <p>{activePlane.name} is in the generation plan but has no provinces yet. Generate builds every planned plane together; review its archetype, size and links on the Planes tab first if needed.</p>
                <div className="draft-plane-actions">
                  <button className="button primary" type="button" onClick={goToGenerate}>Go to Generate</button>
                  <button className="button quiet" type="button" onClick={() => openSetupTab("planes")}>Configure on Planes tab</button>
                </div>
              </section>
            </div>}
            <div className="map-legend">
              <button className="map-legend-toggle" type="button" aria-expanded={legendOpen} onClick={() => setLegendPreference(!legendOpen)}>Legend <span aria-hidden="true">{legendOpen ? "▾" : "▸"}</span></button>
              {legendOpen && <>
                <span><i className="legend-border" />Shared border = connected</span>
                <span><b>S/#/N</b> Generic/team/nation start</span>
                <span><b>♜/♛/×</b> Preferred/fixed/avoid throne</span>
                <span><b>✦/M</b> Placed/many sites</span>
                <span><b>G</b> Guardians</span>
                <span><b>◎</b> Gateway</span>
              </>}
            </div>
          </div>
          <div className="plane-strip" role="group" aria-label="Plane selector">
            {project.planes.map((plane, index) => (
              <button key={plane.id} type="button" className={plane.id === activePlane.id ? "active" : ""} aria-pressed={plane.id === activePlane.id} title={`${PLANE_KINDS.find((item) => item.value === plane.kind)?.label ?? plane.kind} · ${plane.provinces.length ? `${plane.provinces.length} provinces` : "draft, not generated"} · ${plane.width}×${plane.height}`} onClick={() => { setActivePlaneId(plane.id); setSelectedId(undefined); }}>
                <span>{index + 1}</span><strong>{plane.name}</strong><small>{plane.provinces.length || "Draft"}</small>
              </button>
            ))}
            {project.planes.length < MAX_PLANES && <button className="add-plane-mini" type="button" title="Add a draft plane to the generation plan, then configure it on the Planes tab" onClick={stagePlane}>+ Add plane</button>}
          </div>
        </section>

        <aside className="right-panel panel" ref={rightPanelRef} aria-label="Province inspector">
          {selected ? (
            <>
              <div className="province-header">
                <div>
                  <p className="eyebrow">PROVINCE {selected.index}</p>
                  <input maxLength={MAX_IMPORTED_STRING_LENGTH} value={selected.name} onChange={(event) => updateSelected((province) => { province.name = event.target.value; province.nameSource = "authored"; })} aria-label="Province name" />
                  <p className="inspector-scope"><ScopeBadge scope="Current Map" /><span>Edits apply immediately; Undo reverts.</span></p>
                </div>
              </div>
              <div className="tab-row inspector-tabs" role="tablist" aria-label="Province inspector">
                {INSPECTOR_TABS.map((tab) => (
                  <button key={tab} id={`inspector-tab-${tab}`} type="button" role="tab" tabIndex={inspectorTab === tab ? 0 : -1} aria-selected={inspectorTab === tab} aria-controls="inspector-active-panel" className={inspectorTab === tab ? "active" : ""} onClick={() => setInspectorTab(tab)} onKeyDown={(event) => handleTabKey(event, INSPECTOR_TABS, inspectorTab, setInspectorTab)}>
                    {tab === "sites" ? "Sites & guardians" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
              <div id="inspector-active-panel" className="panel-scroll inspector-scroll" role="tabpanel" aria-labelledby={`inspector-tab-${inspectorTab}`}>
                {inspectorTab === "terrain" && <TerrainInspector catalog={catalog} planeId={activePlane.id} province={selected} update={updateSelected} mutateProject={mutate} />}
                {inspectorTab === "gameplay" && <GameplayInspector catalog={catalog} project={project} planeId={activePlane.id} province={selected} update={updateSelected} mutateProject={mutate} />}
                {inspectorTab === "sites" && <SitesDefenseInspector
                  catalog={catalog}
                  plane={activePlane}
                  province={selected}
                  protectedStart={selected.start || selected.teamStart !== undefined || project.specificStarts.some((start) => start.planeId === activePlane.id && start.provinceId === selected.id)}
                  update={updateSelected}
                  populationDefenseStatus={<PopulationDefenseProvinceStatus project={project} catalog={catalog} planeId={activePlane.id} provinceId={selected.id} onConfigure={() => openSetupTab("scenario")} />}
                />}
                {inspectorTab === "advanced" && <AdvancedInspector project={project} planeId={activePlane.id} province={selected} update={updateSelected} mutateProject={mutate} onOpenPlanes={() => openSetupTab("planes")} />}
              </div>
            </>
          ) : (
            <div className="empty-inspector">
              <span className="empty-sigil" aria-hidden="true">⌖</span>
              <p className="eyebrow">PROVINCE INSPECTOR</p>
              <h2>Select a province</h2>
              <p>Click a province on the map to inspect terrain, starts, thrones, magic sites, unique guardians, battle scenery, and raw map commands.</p>
              <div className="selection-hints">
                <span><kbd>Scroll</kbd> zoom</span><span><kbd>Drag</kbd> pan</span><span><kbd>Arrows</kbd> next province</span><span><kbd>/</kbd> find a province</span>
              </div>
              <section className="getting-started" aria-labelledby="getting-started-title">
                <h3 id="getting-started-title">Getting started</h3>
                <ol>
                  {([
                    ["generate", "Generate", "Seed, players, provinces per player and start allocation"],
                    ["planes", "Planes", "Add and configure every plane and its planned links"],
                    ["scenario", "Scenario", "Hosting restrictions; then Generate balanced atlas"],
                    ["validate", "Validate", errorCount ? `${errorCount} export blocker${errorCount === 1 ? "" : "s"} to resolve` : "No export blockers; review any warnings"],
                    ["install", "Install", "Install directly or download a ready ZIP"],
                  ] as Array<[LeftTab | "validate" | "install", string, string]>).map(([step, label, detail], index) => <li key={step}>
                    <button type="button" aria-haspopup={step === "validate" || step === "install" ? "dialog" : undefined} onClick={() => {
                      if (step === "validate") setValidationOpen(true);
                      else if (step === "install") setExportOpen(true);
                      else openSetupTab(step);
                    }}><b aria-hidden="true">{index + 1}</b><span><strong>{label}</strong><small>{detail}</small></span></button>
                  </li>)}
                </ol>
              </section>
            </div>
          )}
        </aside>
      </div>

      <footer className="statusbar">
        <span><i className={errorCount ? "status-dot bad" : "status-dot good"} />{errorCount ? `${errorCount} export blocker${errorCount === 1 ? "" : "s"}` : "Dominions checks ready"}</span>
        <span>{project.planes.length} plane{project.planes.length === 1 ? "" : "s"} · {totalProvinces} provinces · {project.settings.players} starts target</span>
        <button className="status-review" type="button" aria-haspopup="dialog" onClick={() => setBalanceOpen(true)}>Fairness (structural) <strong className={scoreClass(fairness.overall)}>{fairness.overall}</strong> · Inspect starts</button>
        <span>{Math.round(zoom * 100)}%</span>
        <span>{formatBytes(estimatedPackageBytes(project, catalog))} package</span>
      </footer>

      {destructiveConfirmation && <DestructiveConfirmationDialog
        action={destructiveConfirmation}
        project={project}
        onClose={() => setDestructiveConfirmation(undefined)}
        onBackup={() => { downloadProject(project); setToast("Editable backup downloaded. Keep it until you are satisfied with the replacement."); }}
        onConfirm={confirmDestructiveAction}
      />}

      {balanceOpen && <BalanceDialog project={project} fairness={fairness} errors={errorCount} catalogVersion={catalog.gameVersion}
        onClose={() => setBalanceOpen(false)} onContextChange={context => mutate(draft => { draft.analysisContext = context; })}
        onInspect={(ref, keys, mode) => {
          inspectProvince(ref);
          setAnalysisSelection({ project, keys, label: ref.province.name, mode });
          setBalanceOpen(false);
        }} />}

      {validationOpen && <ValidationDrawer issues={issues} fairness={fairness} onReview={() => { setValidationOpen(false); setBalanceOpen(true); }} onClose={() => setValidationOpen(false)} onSelectIssue={(issue) => {
        if (issue.planeId) setActivePlaneId(issue.planeId);
        if (issue.provinceId) setSelectedId(issue.provinceId);
        setValidationOpen(false);
        // Closing the drawer restores header focus first; reveal the inspector afterwards on narrow layouts.
        if (issue.provinceId) window.requestAnimationFrame(() => revealSection(rightPanelRef.current));
      }} />}

      {exportOpen && <ExportDialog
        project={project}
        catalog={catalog}
        activePlane={activePlane}
        issues={issues}
        progress={exportProgress}
        busy={exportBusy}
        artwork={exportArtwork}
        onArtworkChange={setExportArtwork}
        onClose={() => !exportBusy && setExportOpen(false)}
        onInstall={() => runExport("install")}
        onZip={() => runExport("zip")}
        onPlayerZip={() => runExport("player")}
        onProject={() => { downloadProject(project); setToast("Editable project downloaded."); }}
        onPreview={exportPreview}
        onValidate={() => { setExportOpen(false); setValidationOpen(true); }}
      />}

      <input ref={importRef} className="sr-only" type="file" tabIndex={-1} aria-hidden="true" accept=".json,.atlas.json,application/json" onChange={importProject} />
      <input ref={catalogImportRef} className="sr-only" type="file" tabIndex={-1} aria-hidden="true" accept=".json,application/json" onChange={importCatalog} />
      {actionError && <ActionErrorAlert key={actionError.sequence} error={actionError} onDismiss={() => setActionError(undefined)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function TerrainInspector({ catalog, planeId, province, update, mutateProject }: { catalog: Dom6CatalogBundle; planeId: string; province: Province; update: (recipe: (province: Province) => void) => void; mutateProject: (recipe: (project: MapProject) => void) => void }) {
  const inherentFlags = effectiveProvinceTerrainFlags({ terrain: province.terrain, terrainFlags: undefined, freshwater: false });
  const effectiveFlags = effectiveProvinceTerrainFlags(province);
  const additionalFlags = ADDITIVE_TERRAIN_FLAGS.filter((flag) => !inherentFlags.has(flag));
  return (
    <div className="inspector-stack">
      <SectionHeading kicker="TERRAIN & ARTWORK" title="Biome & terrain" />
      <Field label="Primary terrain preset"><select value={province.terrain} onChange={(event) => {
        const terrain = event.target.value as TerrainKey;
        mutateProject((draft) => { applyPrimaryTerrain(draft, planeId, province.id, terrain, catalog); });
      }}>{TERRAIN_KEYS.map((key) => <option value={key} key={key}>{TERRAIN_LABELS[key]}</option>)}</select></Field>
      <Field scope="Saved note only" label="Biome (descriptive only)"><select value={province.biome} onChange={(event) => update((item) => { item.biome = event.target.value as BiomeKey; })}>{BIOME_KEYS.map((key) => <option value={key} key={key}>{BIOME_LABELS[key]}</option>)}</select></Field>
      <div className="field-grid two">
        {/* Small/Large and Warmer/Colder are mutually exclusive terrain bits. */}
        <Field label="Province size"><select value={province.large ? "large" : province.small ? "small" : "normal"} onChange={(event) => update((item) => { item.small = event.target.value === "small"; item.large = event.target.value === "large"; })}>
          <option value="normal">Normal</option><option value="small">Small province</option><option value="large">Large province</option>
        </select></Field>
        <Field label="Climate"><select value={province.warmer ? "warmer" : province.colder ? "colder" : "normal"} onChange={(event) => update((item) => { item.warmer = event.target.value === "warmer"; item.colder = event.target.value === "colder"; })}>
          <option value="normal">Normal</option><option value="warmer">Warmer</option><option value="colder">Colder</option>
        </select></Field>
      </div>
      <div className="choice-grid three">
        <CheckCard label="No random start" checked={province.noStart} onChange={(value) => update((item) => { item.noStart = value; if (value) item.start = false; })} />
        <CheckCard label="Many sites" checked={province.manySites} onChange={(value) => update((item) => { item.manySites = value; })} />
        <CheckCard label="Fresh-water marker" checked={effectiveFlags.has("freshwater")} onChange={(value) => update((item) => {
          item.freshwater = value || undefined;
          item.terrainFlags = item.terrainFlags?.filter((flag) => flag !== "freshwater");
          if (!item.terrainFlags?.length) item.terrainFlags = undefined;
        })} />
      </div>
      <Divider />
      <SectionHeading kicker="ADDITIVE BITMASK" title="Additional terrain flags" />
      <p className="microcopy">Primary terrain contributes {([...inherentFlags].map((flag) => TERRAIN_FLAG_LABELS[flag]).join(" + ") || "plain land")}.</p>
      <div className="choice-grid">
        {additionalFlags.map((flag) => <CheckCard
          key={flag}
          compact
          label={TERRAIN_FLAG_LABELS[flag]}
          checked={province.terrainFlags?.includes(flag) ?? false}
          onChange={(value) => mutateProject((draft) => {
            applyAdditionalTerrainFlag(draft, planeId, province.id, flag, value, catalog);
          })}
        />)}
      </div>
      <p className="field-note">Effective mask: {[...effectiveFlags].map((flag) => TERRAIN_FLAG_LABELS[flag]).join(" + ") || "plain land"}.</p>
      <details className="inspector-about">
        <summary>About terrain flags</summary>
        <div className="details-body">
          <p className="microcopy">Add any legal Dominions combination; the manual recommends no more than two adverse types. Sea + Mountains enables underwater-mountain sites; Sea + Forest is kelp/underwater forest. Fresh water remains a land marker unless Sea is also set.</p>
          <p className="microcopy">Cave Wall blocks the province and clears all starts, throne setup, catalogued throne sites, and guardian groups. Undo restores the previous contents. Raw province commands are preserved; recognized guardian and throne-site commands block export.</p>
          <div className="info-card"><strong>Terrain changes update the artwork</strong><p>Combined flags appear together: fields for Farm, trees, kelp or cavern growth for Forest, and cave details for Cave. The map and PNG update immediately; zoom in for small details. Export again for a new Dominions game. Native scenery uses the game’s renderer; Illustrated realms packages Atlas’s procedural realm artwork with terrain and winter image sheets.</p></div>
        </div>
      </details>
      <Divider />
      <SectionHeading kicker="SITE AFFINITY" title="Magic path bias" />
      <div className="path-grid">
        {MAGIC_PATHS.map((path) => <CheckCard key={path} compact label={MAGIC_PATH_LABELS[path]} checked={province.siteBias.includes(path)} onChange={(value) => update((item) => { item.siteBias = value ? [...new Set([...item.siteBias, path])] : item.siteBias.filter((entry) => entry !== path); })} />)}
      </div>
    </div>
  );
}

function GameplayInspector({ catalog, project, planeId, province, update, mutateProject }: { catalog: Dom6CatalogBundle; project: MapProject; planeId: string; province: Province; update: (recipe: (province: Province) => void) => void; mutateProject: (recipe: (project: MapProject) => void) => void }) {
  const specific = project.specificStarts.find((start) => start.planeId === planeId && start.provinceId === province.id);
  const plane = project.planes.find((item) => item.id === planeId)!;
  const playableNations = playerNationEntries(catalog.nations);
  const ownershipOverrides = [province.owner, province.poptype, province.fort, province.population, province.unrest, province.provinceDefense]
    .filter((value) => value !== undefined).length + Number(province.temple) + Number(province.lab);
  return (
    <div className="inspector-stack">
      <SectionHeading kicker="MULTIPLAYER" title="Starts & thrones" />
      <Toggle label="Generic player start" checked={province.start} onChange={(value) => update((item) => {
        item.start = value;
        if (value) prepareProvinceForPlayerStart(item);
      })} />
      <OptionalNumberField label="Team-start group" value={province.teamStart} min={0} onChange={(value) => update((item) => {
        item.teamStart = value;
        if (value !== undefined) prepareProvinceForPlayerStart(item);
      })} />
      <CatalogCombobox numericOnly label="Specific-start nation" value={specific?.nation} entries={playableNations} placeholder="Search playable nation name or ID" isValueAllowed={(value) => isPlayerNationId(Number(value))} rejectedMessage="A player nation requires an ID of 5 or greater. The previous assignment was kept." onCommit={(value) => {
        const nation = optionalNumber(value);
        mutateProject((draft) => {
          setNationSpecificStart(draft, planeId, province.id, nation !== undefined && isPlayerNationId(nation) ? nation : undefined);
        });
      }} />
      <p className="microcopy">Assigning a nation-specific start clears independent guardians, placed sites, throne setup, ownership, economy/PD overrides, forts, labs, temples, battle overrides, and raw province directives. Terrain, geography, climate, province name, and any generic-start marker remain intact.</p>
      <Field label="Throne treatment"><select value={province.throne} onChange={(event) => update((item) => { item.throne = event.target.value as Province["throne"]; if (item.throne !== "fixed") item.fixedThrone = undefined; })}>
        <option value="none">Neutral</option><option value="preferred">Preferred location</option><option value="avoid">Avoid location</option><option value="fixed">Fixed throne site (advanced)</option>
      </select></Field>
      {province.throne === "fixed" && <CatalogCombobox label="Fixed throne site" value={province.fixedThrone} entries={catalog.sites.filter((entry) => entry.tags?.includes("throne"))} getEntryStatus={(entry) => siteCompatibility(entry, province, plane)} onCommit={(value) => update((item) => { item.fixedThrone = value || undefined; })} placeholder="Search throne name or ID" />}
      {province.throne === "fixed" && <p className="warning-copy">Fixed thrones use a magic-site feature and can conflict with a unique site selected randomly. Preferred locations are the reliable multiplayer default.</p>}
      <Divider />
      {/* Collapsed until the province has an override; the key restores that default per province. */}
      <InspectorSection key={province.id} kicker="PROVINCE SETUP" title="Ownership & economy" status={ownershipOverrides ? `${ownershipOverrides} override${ownershipOverrides === 1 ? "" : "s"} set` : "Game defaults · no overrides"} defaultOpen={ownershipOverrides > 0}>
        <div className="catalog-field-grid">
          <CatalogCombobox numericOnly label="Owner nation" value={province.owner} entries={catalog.nations} placeholder="Search nation name or ID" onCommit={(value) => update((item) => { item.owner = optionalNumber(value); if (item.owner !== undefined && [0, 2, 4].includes(item.owner)) item.provinceDefense = undefined; })} />
          <CatalogCombobox numericOnly label="Population type" value={province.poptype} entries={catalog.poptypes} placeholder="Search poptype name or ID" onCommit={(value) => update((item) => { item.poptype = optionalNumber(value); })} />
          <CatalogCombobox numericOnly label="Fortification" value={province.fort} entries={catalog.forts} placeholder="Search fort name or ID" onCommit={(value) => update((item) => { item.fort = optionalNumber(value); })} />
        </div>
        <div className="field-grid two">
          <OptionalNumberField label="Population" value={province.population} min={0} max={50000} onChange={(value) => update((item) => { item.population = value; })} />
          <OptionalNumberField label="Unrest" value={province.unrest} min={0} max={500} onChange={(value) => update((item) => { item.unrest = value; })} />
          <OptionalNumberField label="Owned PD level" value={province.provinceDefense} min={0} max={125} disabled={province.owner !== undefined && [0, 2, 4].includes(province.owner)} onChange={(value) => update((item) => { item.provinceDefense = value; })} />
        </div>
        <p className="microcopy">The map manual guarantees that poptype changes local recruitment, not the initial independent army. It does not define separate PD-roster IDs. Owned PD level only applies when a playable owner nation is set.</p>
        <Toggle label="Temple" checked={province.temple} onChange={(value) => update((item) => { item.temple = value; })} />
        <Toggle label="Laboratory" checked={province.lab} onChange={(value) => update((item) => { item.lab = value; })} />
      </InspectorSection>
    </div>
  );
}

export function SitesDefenseInspector({ catalog, plane, province, protectedStart = false, update, populationDefenseStatus }: { catalog: Dom6CatalogBundle; plane: Plane; province: Province; protectedStart?: boolean; update: (recipe: (province: Province) => void) => void; populationDefenseStatus?: ReactNode }) {
  const [showTerrainMismatches, setShowTerrainMismatches] = useState(false);
  const [showSpecialSites, setShowSpecialSites] = useState(false);
  const [showAllGuardianUnits, setShowAllGuardianUnits] = useState(true);
  const siteStatus = (entry: CatalogEntry) => siteCompatibility(entry, province, plane);
  const placeableSites = provinceSiteEntries(catalog.sites);
  const placeableSiteIds = new Set(placeableSites.map((entry) => entry.id));
  // Older exported catalog overlays retain their original source IDs after an upgrade.
  const bundledSiteSources = new Set(["dom6inspector-6.35-cfac4311", ...BUILTIN_DOM6_CATALOG.sites.map(entry => entry.provenanceId)]);
  const ordinarySites = placeableSites.filter((entry) => !entry.tags?.includes("non-random-site")
    && (!bundledSiteSources.has(entry.provenanceId) || entry.tags?.includes("ordinary-site")));
  const sitePool = showSpecialSites ? placeableSites : ordinarySites;
  const siteChoices = showTerrainMismatches ? sitePool : sitePool.filter((entry) => siteStatus(entry).compatible);
  const selectableUnits = selectableUnitEntries(catalog.units);
  const internalUnitCount = catalog.units.length - selectableUnits.length;
  const roleCommanders = commanderUnitEntries(selectableUnits);
  const roleTroops = troopUnitEntries(selectableUnits);
  const commanderChoices = showAllGuardianUnits ? selectableUnits : roleCommanders;
  const troopChoices = showAllGuardianUnits ? selectableUnits : roleTroops;
  return (
    <div className="inspector-stack">
      <SectionHeading kicker="MAGIC SITES" title="Placed sites" />
      <Toggle label="Remove randomly generated sites" checked={province.killRandomSites} onChange={(value) => update((item) => { item.killRandomSites = value; })} />
      <div className="filter-chip-row" role="group" aria-label="Site picker filters">
        <span>{showTerrainMismatches ? `Showing all ${siteChoices.length.toLocaleString()}` : `${siteChoices.length.toLocaleString()} terrain-compatible`} of {sitePool.length.toLocaleString()} {showSpecialSites ? "non-capital" : "ordinary"} province sites</span>
        <button type="button" className="filter-chip" aria-pressed={showTerrainMismatches} onClick={() => setShowTerrainMismatches((value) => !value)}>Show terrain mismatches</button>
        <button type="button" className="filter-chip" aria-pressed={showSpecialSites} onClick={() => setShowSpecialSites((value) => !value)}>{`Include all ${placeableSites.length.toLocaleString()} non-capital sites`}</button>
      </div>
      <div className="site-list">
        {province.sites.map((site, index) => (
          <div className="site-row" key={site.id}>
            <CatalogCombobox compact label={`Site ${index + 1}`} value={site.value} entries={includeSelectedEntry(siteChoices, catalog.sites, site.value)} getEntryStatus={siteStatus} placeholder={`Search ${sitePool.length.toLocaleString()} ${showSpecialSites ? "non-capital" : "ordinary"} sites by name or ID`} isValueAllowed={(value) => {
              const known = findCatalogEntry(catalog.sites, value);
              return !known || placeableSiteIds.has(known.id);
            }} rejectedMessage="Nation home sites and Thrones of Ascension cannot be placed with this picker." onCommit={(value) => update((item) => { item.sites[index]!.value = value; })} />
            <label title="Known at game start"><input type="checkbox" checked={site.known} onChange={(event) => update((item) => { item.sites[index]!.known = event.target.checked; })} />Known</label>
            <button type="button" onClick={() => update((item) => { item.sites.splice(index, 1); })} aria-label={`Remove site ${index + 1}`}>×</button>
          </div>
        ))}
      </div>
      <button className="button quiet wide" type="button" onClick={() => update((item) => { item.sites.push({ id: `site-${Date.now().toString(36)}`, value: "", known: false }); })}>+ Place magic site</button>
      <details className="inspector-about">
        <summary>About these lists</summary>
        <div className="details-body">
          <p className="microcopy">{ordinarySites.length.toLocaleString()} ordinary + {(placeableSites.length - ordinarySites.length).toLocaleString()} non-random non-home sites available.</p>
          <p className="microcopy">The default picker includes the complete {ordinarySites.length.toLocaleString()}-site ordinary pool (rarity 0-4); the expanded {placeableSites.length.toLocaleString()}-site pool also includes verified non-random sites that are not nation homes. Nation home/capital sites and Thrones of Ascension stay excluded; fixed thrones are selected under Gameplay. Hidden sites use <code>#feature</code>; known sites use <code>#knownfeature</code>.</p>
        </div>
      </details>
      <Divider />
      <SectionHeading kicker="UNIQUE INITIAL DEFENSE" title="Guardian groups" />
      {populationDefenseStatus}
      <div className="filter-chip-row" role="group" aria-label="Guardian unit filters">
        <span>{showAllGuardianUnits ? `All ${selectableUnits.length.toLocaleString()} gameplay records available; role filters cover ${roleCommanders.length.toLocaleString()} commanders / ${roleTroops.length.toLocaleString()} troops` : `${roleCommanders.length.toLocaleString()} known commanders / ${roleTroops.length.toLocaleString()} known troops`}</span>
        <button type="button" className="filter-chip" aria-pressed={!showAllGuardianUnits} title={showAllGuardianUnits ? undefined : `Turn off to search all ${selectableUnits.length.toLocaleString()} units`} onClick={() => setShowAllGuardianUnits((value) => !value)}>Use role-focused lists</button>
      </div>
      <details className="inspector-about">
        <summary>About these lists</summary>
        <div className="details-body">
          <div className="info-card amber"><strong>Map-only boundary</strong><p>These commanders and squads are unique initial independents. Persistent purchasable PD composition is defined by a vanilla poptype or nation; a wholly new PD roster requires enabling a separate mod.</p></div>
          <p className="microcopy">Role-focused lists combine the pinned Inspector nation and magic-site recruitment tables, not unit-name guesses. {internalUnitCount.toLocaleString()} Test, Debug, XXX, or Unused data records are hidden from normal browsing. Dominions map commands can still instantiate any verified raw numeric ID, and an already selected hidden record remains visible.</p>
        </div>
      </details>
      {province.defenders.map((defense, defenseIndex) => (
        <div className="defense-card" key={`${defense.commander}-${defenseIndex}`}>
          <div className="card-heading"><strong>Guardian group {defenseIndex + 1}</strong><button type="button" aria-label={`Remove guardian group ${defenseIndex + 1}`} onClick={() => update((item) => { item.defenders.splice(defenseIndex, 1); })}>Remove</button></div>
          <CatalogCombobox label="Commander" value={defense.commander} entries={includeSelectedEntry(commanderChoices, catalog.units, defense.commander)} placeholder={`Search ${commanderChoices.length.toLocaleString()} ${showAllGuardianUnits ? "gameplay units" : "known commanders"} by name or ID`} onCommit={(value) => update((item) => { item.defenders[defenseIndex]!.commander = value; })} />
          <Field label="Commander display name"><input maxLength={MAX_IMPORTED_STRING_LENGTH} value={defense.commanderName ?? ""} onChange={(event) => update((item) => { item.defenders[defenseIndex]!.commanderName = event.target.value || undefined; })} /></Field>
          {defense.squads.map((squad, squadIndex) => (
            <div className="squad-row" key={squad.id}>
              <BoundedNumberInput min={1} max={1000} value={squad.count} aria-label={`Guardian group ${defenseIndex + 1}, squad ${squadIndex + 1} count`} onChange={(value) => update((item) => { item.defenders[defenseIndex]!.squads[squadIndex]!.count = value; })} />
              <CatalogCombobox compact label={`Squad ${squadIndex + 1} unit`} value={squad.unit} entries={includeSelectedEntry(troopChoices, catalog.units, squad.unit)} placeholder={`Search ${troopChoices.length.toLocaleString()} ${showAllGuardianUnits ? "gameplay units" : "known troops"} by name or ID`} onCommit={(value) => update((item) => { item.defenders[defenseIndex]!.squads[squadIndex]!.unit = value; })} />
              <button type="button" onClick={() => update((item) => { item.defenders[defenseIndex]!.squads.splice(squadIndex, 1); })} aria-label={`Remove guardian group ${defenseIndex + 1}, squad ${squadIndex + 1}`}>×</button>
            </div>
          ))}
          <button className="text-button" type="button" onClick={() => update((item) => { item.defenders[defenseIndex]!.squads.push({ id: `squad-${Date.now().toString(36)}`, unit: "", count: 10 }); })}>+ Add squad</button>
          <details>
            <summary>Commander details</summary>
            <div className="details-body">
              <div className="field-grid two">
                <OptionalNumberField label="Experience" value={defense.experience} min={0} max={900} onChange={(value) => update((item) => { item.defenders[defenseIndex]!.experience = value; })} />
                <OptionalNumberField label="Random items" value={defense.randomEquipment} min={0} max={4} onChange={(value) => update((item) => { item.defenders[defenseIndex]!.randomEquipment = value; })} />
              </div>
              <Field label="Specific items (one per line)"><ItemListInput value={defense.items} onChange={(value) => update((item) => { item.defenders[defenseIndex]!.items = value; })} /></Field>
              <Toggle label="Clear commander's innate magic first" checked={defense.clearMagic ?? false} onChange={(value) => update((item) => { item.defenders[defenseIndex]!.clearMagic = value || undefined; })} />
              <div className="bodyguard-fields">
                <CatalogCombobox label="Bodyguard unit" value={defense.bodyguard} entries={includeSelectedEntry(troopChoices, catalog.units, defense.bodyguard)} placeholder={`Search ${troopChoices.length.toLocaleString()} ${showAllGuardianUnits ? "gameplay units" : "known troops"} by name or ID`} onCommit={(value) => update((item) => {
                  const group = item.defenders[defenseIndex]!;
                  group.bodyguard = value || undefined;
                  if (!value) group.bodyguardCount = undefined;
                  else group.bodyguardCount ??= 5;
                })} />
                <OptionalNumberField label="Bodyguard count" value={defense.bodyguardCount} min={1} max={1000} disabled={!defense.bodyguard} onChange={(value) => update((item) => { item.defenders[defenseIndex]!.bodyguardCount = value; })} />
              </div>
              <div className="magic-level-grid">{MAGIC_PATHS.map((path) => <OptionalNumberField key={path} label={MAGIC_PATH_LABELS[path]} value={defense.magic?.[path]} min={0} max={10} onChange={(value) => update((item) => { const group = item.defenders[defenseIndex]!; group.magic ??= {}; if (value === undefined) delete group.magic[path]; else group.magic[path] = value; })} />)}</div>
              <p className="microcopy">For command-sensitive setup beyond these controls, use the Advanced tab&apos;s province directives.</p>
            </div>
          </details>
        </div>
      ))}
      <button className="button quiet wide" type="button" disabled={protectedStart} onClick={() => update((item) => { item.defenders.push({ commander: "", squads: [{ id: `squad-${Date.now().toString(36)}`, unit: "", count: 10 }] }); })}>+ Add guardian group</button>
      {protectedStart && <p className="warning-copy">Initial guardians are disabled on generic, team, and nation-specific starts because Dominions’ <code>#land</code> command would erase the starting army and pretender.</p>}
    </div>
  );
}

export function AdvancedInspector({ project, planeId, province, update, mutateProject, onOpenPlanes }: { project: MapProject; planeId: string; province: Province; update: (recipe: (province: Province) => void) => void; mutateProject: (recipe: (project: MapProject) => void) => void; onOpenPlanes?: () => void }) {
  const plane = project.planes.find((item) => item.id === planeId)!;
  const incident = plane.edges.filter((edge) => edge.a === province.id || edge.b === province.id);
  return (
    <div className="inspector-stack">
      <SectionHeading kicker="BORDERS" title={`${incident.length} connections`} />
      <div className="edge-list">{incident.map((edge) => {
        const otherId = edge.a === province.id ? edge.b : edge.a;
        const other = plane.provinces.find((item) => item.id === otherId);
        return <div key={edge.id}>
          <div className="edge-row"><span>{other?.index}. {other?.name}</span><select value={edge.kind} aria-label={`Border type to province ${other?.index ?? "unknown"}, ${other?.name ?? "missing province"}`} onChange={(event) => mutateProject((draft) => {
            const target = draft.planes.find((item) => item.id === planeId)!.edges.find((item) => item.id === edge.id)!;
            setBorderKind(target, event.target.value as EdgeKind);
          })}>{EDGE_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></div>
          {edge.kind === "custom" && <>
            <NumberField label={`Border bitmask to province ${other?.index ?? "unknown"}`} value={edge.special ?? 0} min={0} max={255} onChange={(value) => mutateProject((draft) => {
              const target = draft.planes.find((item) => item.id === planeId)!.edges.find((item) => item.id === edge.id)!;
              target.special = value;
            })} />
            <p className="microcopy">Add flags: pass 1, river 2, impassable 4, road 8, bridge 16, mountain border 32. A mountain pass is 33. Zero is ordinary movement. Other bits require game-specific verification.</p>
          </>}
        </div>;
      })}</div>
      <Divider />
      <SectionHeading kicker="BATTLE SCENE" title="Province battlefield" />
      <Field label="Skybox"><input maxLength={MAX_IMPORTED_STRING_LENGTH} value={province.battle.skybox ?? ""} onChange={(event) => update((item) => { item.battle.skybox = event.target.value || undefined; })} /></Field>
      <Field label="Battle map"><input maxLength={MAX_IMPORTED_STRING_LENGTH} value={province.battle.battleMap ?? ""} onChange={(event) => update((item) => { item.battle.battleMap = event.target.value || undefined; })} /></Field>
      <div className="field-grid three">
        <Field label="Ground RGB"><input placeholder="0.4 0.4 0.3" value={province.battle.groundColor ?? ""} onChange={(event) => update((item) => { item.battle.groundColor = event.target.value || undefined; })} /></Field>
        <Field label="Rock RGB"><input placeholder="0.3 0.3 0.3" value={province.battle.rockColor ?? ""} onChange={(event) => update((item) => { item.battle.rockColor = event.target.value || undefined; })} /></Field>
        <Field label="Fog RGB"><input placeholder="0.6 0.6 0.7" value={province.battle.fogColor ?? ""} onChange={(event) => update((item) => { item.battle.fogColor = event.target.value || undefined; })} /></Field>
      </div>
      <Divider />
      <SectionHeading kicker="RAW DOMINIONS DATA" title="Terrain mask & directives" />
      <div className="terrain-mask-card"><span>Terrain mask</span><code>{terrainMask(province).toString()}</code><small>Decimal Dominions 64-bit value built from the Terrain tab’s primary terrain, flags and climate.</small></div>
      <Field label="Province directives"><textarea maxLength={MAX_IMPORTED_DIRECTIVE_LENGTH} className="code-input" rows={7} placeholder={"#clearmagic\n#mag_fire 2"} value={province.rawDirectives} onChange={(event) => update((item) => { item.rawDirectives = event.target.value; })} /></Field>
      <Field label="Plane directives"><textarea maxLength={MAX_IMPORTED_DIRECTIVE_LENGTH} className="code-input" rows={5} placeholder="#maptextcol …" value={plane.rawDirectives} onChange={(event) => mutateProject((draft) => { draft.planes.find((item) => item.id === planeId)!.rawDirectives = event.target.value; })} /></Field>
      <p className="microcopy">Plane directives apply to the whole {plane.name} plane, not only this province. They are also editable on the Planes tab.{onOpenPlanes && <>{" "}<button className="text-button" type="button" onClick={onOpenPlanes}>Open Planes tab</button></>}</p>
      <details className="coverage-list"><summary>Dominions feature coverage ({ADVANCED_COMMANDS.length} command families)</summary><div>{ADVANCED_COMMANDS.map((item) => <span key={item.command}><code>{item.command}</code><small>{item.description}</small></span>)}</div></details>
    </div>
  );
}

export function ExistingGatewaysEditor({ project, activePlane, gates, mutateProject, onNotice }: {
  project: MapProject;
  activePlane: Plane;
  gates: GateLink[];
  mutateProject: (recipe: (draft: MapProject) => void) => void;
  onNotice: (message: string) => void;
}) {
  if (!gates.length) {
    return <div className="existing-gateway-empty">
      <strong>No existing gateways touch {activePlane.name}.</strong>
      <span>Generate the atlas, or use the Gate tool to choose a source province, switch planes, and choose its destination.</span>
    </div>;
  }

  const activeLabel = planeDisplayLabel(project, activePlane);
  return <div className="existing-gateway-list" aria-label={`Existing gateways touching ${activeLabel}`}>
    {gates.map((gate, gateIndex) => {
      const headingId = `existing-gateway-${gateIndex}-heading`;
      return <article className="existing-gateway-card" aria-labelledby={headingId} key={gate.id}>
        <div className="existing-gateway-heading">
          <div>
            <p className="eyebrow">SHARED DOMINIONS NUMBER</p>
            <h3 id={headingId}>Gateway <code>#gate {gate.gateNumber}</code></h3>
          </div>
          <button className="text-button danger-text" type="button" aria-label={`Delete gateway with shared number ${gate.gateNumber}`} onClick={() => mutateProject((draft) => {
            draft.gates = draft.gates.filter((item) => item.id !== gate.id);
          })}>Delete gateway</button>
        </div>
        <label className="existing-gateway-number">
          <span>Shared gate number</span>
          <input key={`${gate.id}:${gate.gateNumber}`} type="number" min={1} step={1} defaultValue={gate.gateNumber} aria-label={`Shared Dominions gate number for gateway ${gateIndex + 1}`} onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.currentTarget.value = String(gate.gateNumber);
              event.currentTarget.blur();
            }
          }} onBlur={(event) => {
            const gateNumber = Number(event.currentTarget.value);
            if (gateNumber === gate.gateNumber) return;
            if (!gateNumberIsAvailable(project.gates, gate.id, gateNumber)) {
              const duplicate = project.gates.some((item) => item.id !== gate.id && item.gateNumber === gateNumber);
              event.currentTarget.value = String(gate.gateNumber);
              onNotice(duplicate
                ? `Gate number ${gateNumber} is already used by another gateway.`
                : "Gate numbers must be positive whole numbers within JavaScript's safe integer range.");
              return;
            }
            mutateProject((draft) => {
              const item = draft.gates.find((candidate) => candidate.id === gate.id);
              if (item && gateNumberIsAvailable(draft.gates, gate.id, gateNumber)) item.gateNumber = gateNumber;
            });
          }} />
        </label>
        <p className="gateway-card-note">One shared number connects all {gate.endpoints.length} endpoints. Duplicate numbers are reported by validation.</p>
        <div className="gateway-endpoint-list">
          {gate.endpoints.map((endpoint, endpointIndex) => {
            const endpointPlane = project.planes.find((plane) => plane.id === endpoint.planeId);
            const endpointProvince = endpointPlane?.provinces.find((province) => province.id === endpoint.provinceId);
            const provinces = endpointPlane ? [...endpointPlane.provinces].sort((left, right) => left.index - right.index) : [];
            const endpointPlaneLabel = endpointPlane ? planeDisplayLabel(project, endpointPlane) : `Missing plane (${endpoint.planeId})`;
            return <div className={`gateway-endpoint-row ${endpoint.planeId === activePlane.id ? "active-plane" : ""}`} key={`${endpoint.planeId}:${endpointIndex}`}>
              <div className="gateway-endpoint-meta">
                <span>Endpoint {endpointIndex + 1}{endpoint.planeId === activePlane.id ? " · selected plane" : ""}</span>
                <strong>{endpointPlaneLabel}</strong>
                <small title={endpointProvince ? `Stable province ID ${endpointProvince.id}` : undefined}>{endpointProvince ? `Local #${endpointProvince.index} · ${endpointProvince.name}` : `Stored province ID ${endpoint.provinceId} is missing`}</small>
              </div>
              {endpointPlane ? <label className="gateway-endpoint-select">
                <span>Local province index on {endpointPlaneLabel}</span>
                <select value={endpointProvince?.index ?? ""} aria-label={`Endpoint ${endpointIndex + 1} local province index on ${endpointPlaneLabel}`} onChange={(event) => {
                  const province = provinceAtLocalIndex(endpointPlane, numberValue(event.target.value, -1));
                  if (!province) return;
                  if (gateEndpointIsUsed(gate, endpoint.planeId, province.id, endpointIndex)) {
                    onNotice(`${endpointPlane.name} province #${province.index} is already an endpoint of this gateway.`);
                    return;
                  }
                  mutateProject((draft) => {
                    const item = draft.gates.find((candidate) => candidate.id === gate.id);
                    const draftEndpoint = item?.endpoints[endpointIndex];
                    const plane = draft.planes.find((candidate) => candidate.id === endpoint.planeId);
                    if (draftEndpoint && plane?.provinces.some((candidate) => candidate.id === province.id)) {
                      draftEndpoint.provinceId = province.id;
                    }
                  });
                }}>
                  {!endpointProvince && <option value="">Missing province · ID {endpoint.provinceId}</option>}
                  {provinces.map((province) => {
                    const used = gateEndpointIsUsed(gate, endpoint.planeId, province.id, endpointIndex);
                    return <option value={province.index} disabled={used} key={province.id}>#{province.index} — {province.name}{used ? " — already used" : ""}</option>;
                  })}
                </select>
              </label> : <p className="gateway-endpoint-warning">This endpoint cannot be reassigned because its plane is missing. Delete this gateway, or restore the plane through project JSON.</p>}
            </div>;
          })}
        </div>
      </article>;
    })}
  </div>;
}

function DestructiveConfirmationDialog({ action, project, onClose, onBackup, onConfirm }: {
  action: DestructiveConfirmation;
  project: MapProject;
  onClose: () => void;
  onBackup: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  const provinceCount = project.planes.reduce((sum, plane) => sum + plane.provinces.length, 0);
  const content = action.kind === "new-atlas"
    ? {
        kicker: "NEW ATLAS",
        title: "Replace the current atlas?",
        description: "A fresh default project will replace this atlas in the editor and in device autosave. Selection and Undo/Redo history will be cleared, so Undo cannot restore it.",
        details: [`${project.planes.length} plane${project.planes.length === 1 ? "" : "s"}`, `${provinceCount} provinces`, `${project.gates.length} gateways`],
        confirmLabel: "Start new atlas",
      }
    : action.kind === "generate"
      ? {
          kicker: "GENERATE MAP",
          title: "Replace the current map geometry?",
          description: "Generate rebuilds provinces, borders, starts, sites, guardians, and gateways for the planned planes. Manual province names are preserved. Undo can restore this version once, but a downloaded backup is the safest recovery point.",
          details: [`${action.impact.planeCount} planned plane${action.impact.planeCount === 1 ? "" : "s"}`, `${action.impact.provinceCount} current provinces`, `${action.impact.gatewayCount} current gateways`,
            // Proceeding is allowed; cancelling leaves the nation start to move or remove below Generate.
            ...preflightAuthoredStartNotices(project).map((notice) => notice.message)],
          confirmLabel: "Generate and replace",
        }
      : {
          kicker: "REMOVE PLANE",
          title: `Remove ${action.impact.planeName}?`,
          description: "This removes the plane and its start assignments, planned links, and touching gateway endpoints. Undo can restore the edit; download a backup if you need a durable copy.",
          details: [`${action.impact.provinceCount} provinces`, `${action.impact.gatewayCount} touching gateways`, `${action.impact.specificStartCount} nation-specific starts`],
          confirmLabel: "Remove plane",
        };
  return <div className="modal-backdrop"><section ref={dialogRef} className="confirmation-dialog" tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="destructive-confirmation-title" aria-describedby="destructive-confirmation-description">
    <div className="dialog-heading"><div><p className="eyebrow">{content.kicker}</p><h2 id="destructive-confirmation-title">{content.title}</h2></div><button type="button" onClick={onClose} aria-label="Cancel and close">×</button></div>
    <div className="confirmation-body">
      <p id="destructive-confirmation-description">{content.description}</p>
      <ul>{content.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
      <div className="confirmation-backup"><strong>Keep a recovery copy first</strong><p>Download the editable project JSON before continuing. Opening that file restores the atlas, even after autosave changes.</p><button className="button quiet" type="button" onClick={onBackup}>Download backup</button></div>
      <div className="confirmation-actions"><button className="button quiet" type="button" onClick={onClose}>Cancel</button><button className="button primary danger-action" type="button" onClick={onConfirm}>{content.confirmLabel}</button></div>
    </div>
  </section></div>;
}

export function BalanceDialog({ onClose, ...props }: React.ComponentProps<typeof StartBalancePanel> & { onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  return <div className="modal-backdrop"><section ref={dialogRef} className="balance-dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-label="Start-region analysis">
    <div className="dialog-heading"><div><p className="eyebrow">CURRENT MAP · NEUTRAL DIAGNOSTICS</p><h2>Start-region analysis</h2></div><button type="button" onClick={onClose} aria-label="Close start-region analysis">×</button></div>
    <StartBalancePanel {...props} />
  </section></div>;
}

const VALIDATION_GROUPS: Array<{ severity: ValidationIssue["severity"]; label: string; one: string; many: string; mark: string }> = [
  { severity: "error", label: "Export blockers", one: "export blocker", many: "export blockers", mark: "!" },
  { severity: "warning", label: "Warnings", one: "warning", many: "warnings", mark: "△" },
  { severity: "info", label: "Info", one: "note", many: "notes", mark: "✓" },
];

function ValidationDrawer({ issues, fairness, onClose, onReview, onSelectIssue }: { issues: ValidationIssue[]; fairness: ReturnType<typeof calculateFairness>; onClose: () => void; onReview: () => void; onSelectIssue: (issue: ValidationIssue) => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  const groups = VALIDATION_GROUPS.map((group) => ({ ...group, issues: issues.filter((issue) => issue.severity === group.severity) }));
  return <div className="drawer-backdrop"><aside ref={dialogRef} className="validation-drawer" tabIndex={-1} aria-modal="true" role="dialog" aria-label="Map validation">
    <div className="dialog-heading"><div><p className="eyebrow">EXPORT READINESS</p><h2>Compatibility & fairness</h2></div><button type="button" onClick={onClose} aria-label="Close">×</button></div>
    <div className="validation-body">
      <div className="validation-counts" role="status">{groups.map((group) => <span key={group.severity} className={`validation-count ${group.severity}`}><strong>{group.issues.length}</strong> {group.issues.length === 1 ? group.one : group.many}</span>)}</div>
      {groups.filter((group) => group.issues.length).map((group) => <section key={group.severity} className="validation-group" aria-labelledby={`validation-group-${group.severity}`}>
        <h3 id={`validation-group-${group.severity}`}>{group.label} <span>{group.issues.length}</span></h3>
        <div className="validation-list">{group.issues.map((issue) => <button key={issue.id} type="button" className={`issue ${issue.severity}`} onClick={() => onSelectIssue(issue)}><span>{group.mark}</span><p><strong>{issue.severity}</strong>{issue.message}</p></button>)}</div>
      </section>)}
      <details className="validation-fairness">
        <summary>Structural fairness <strong className={scoreClass(fairness.overall)}>{fairness.overall}</strong><small>Heuristic only · never overrides an export error</small></summary>
        <div className="score-hero"><div className={`score-ring ${scoreClass(fairness.overall)}`} style={{ "--score": fairness.overall } as CSSProperties}><strong>{fairness.overall}</strong><small>of 100</small></div><div><h3>Structural heuristics</h3><p>A high average is not proof of nation or combat balance and never overrides an export error.</p><button className="button quiet" type="button" onClick={onReview}>Inspect every start</button></div></div>
        <div className="metric-grid">{([['Start spacing', fairness.startSeparation], ['Expansion proxy', fairness.expansionParity], ['Nearby throne parity', fairness.throneAccess], ['Start exits', fairness.startDegree], ['Terrain variety', fairness.terrainVariety], ['Connectivity', fairness.connectivity], ['Allocation', fairness.startAllocation]] as Array<[string, number]>).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong><i><b style={{ width: `${value}%` }} /></i></div>)}</div>
        <details className="validation-score-notes"><summary>Score assumptions and notes</summary><ul>{fairness.notes.map(note => <li key={note}>{note}</li>)}</ul></details>
      </details>
    </div>
  </aside></div>;
}

export function ExportDialog({ project, catalog = BUILTIN_DOM6_CATALOG, activePlane, issues, progress, busy, artwork = "native", onArtworkChange, onClose, onInstall, onZip, onPlayerZip, onProject, onPreview, onValidate }: { project: MapProject; catalog?: Dom6CatalogBundle; activePlane: Plane; issues: ValidationIssue[]; progress?: ExportProgress; busy: boolean; artwork?: ExportArtwork; onArtworkChange?: (artwork: ExportArtwork) => void; onClose: () => void; onInstall: () => void; onZip: () => void; onPlayerZip?: () => void; onProject: () => void; onPreview: () => void; onValidate: () => void }) {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const artworkError = artwork === "illustrated" ? illustratedExportError(project) : undefined;
  const zipSafety = zipPackageSafety(project, catalog, artwork);
  const zipBlocked = zipSafety.level === "blocked";
  const dialogRef = useDialogFocus<HTMLElement>(onClose, busy);
  const progressPercent = Math.max(0, Math.min(100, progress?.percent ?? 0));
  const progressMessage = progress?.message ?? "Preparing the export";
  const progressPlane = Math.max(1, progress?.plane ?? 1);
  const progressPlaneCount = Math.max(1, progress?.planeCount ?? project.planes.length);
  useEffect(() => {
    if (!busy) return;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [busy, dialogRef]);
  return <div className="modal-backdrop"><section ref={dialogRef} className="export-dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-busy={busy} aria-label="Install or export map">
    <div className="dialog-heading"><div><p className="eyebrow">DOMINIONS 6 PACKAGE</p><h2>Install a playable atlas</h2></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close">×</button></div>
    <Field label="In-game artwork" scope="Host / export"><select value={artwork} disabled={busy || !onArtworkChange} onChange={event => onArtworkChange?.(event.target.value as ExportArtwork)} aria-describedby="artwork-export-help"><option value="native">Native scenery (existing exporter)</option><option value="illustrated">Illustrated realms (custom artwork)</option></select></Field>
    <p id="artwork-export-help" className="hint">Illustrated realms bundles custom sky, cave, Underworld, Hell, Abyss, Dreamlands and Elemental artwork with terrain and winter image sheets. Surface and Custom planes keep native scenery. Image provinces are renumbered on export; the editable project is unchanged. Change artwork modes only for a new game, not an existing save. Larger packages take longer to render.</p>
    <div className="package-summary"><div className="package-glyph">D6</div><div><strong>{sanitizeMapName(project.name)}.map</strong><span>{project.planes.length} plane{project.planes.length === 1 ? "" : "s"} · {project.planes.reduce((sum, plane) => sum + plane.provinces.length, 0)} provinces · up to {formatBytes(estimatedPackageBytes(project, catalog, undefined, artwork))}</span></div><i className={errors || artworkError ? "bad" : "good"}>{errors || artworkError ? "!" : "✓"}</i></div>
    {artworkError && <div className="export-blocked" role="alert">{artworkError}</div>}
    {errors ? <div className="export-blocked"><strong>{errors} compatibility blocker{errors === 1 ? "" : "s"}</strong><p>Resolve export errors before building the package.</p><button className="button quiet" type="button" onClick={onValidate}>Review validation</button></div> : !artworkError && <div className="export-options">
      <button className="export-option primary-option" type="button" onClick={onInstall} disabled={busy}><span className="option-icon" aria-hidden="true">↳</span><span><strong>Install directly</strong><small>Choose the Dominions 6 <code>maps</code> folder once; the ready-to-play folder is written there.</small></span><b>Recommended</b></button>
      <button
        className="export-option"
        type="button"
        onClick={onZip}
        disabled={busy || zipBlocked}
        aria-describedby={zipSafety.message ? "zip-memory-safety" : undefined}
        title={zipBlocked ? zipSafety.message : undefined}
      ><span className="option-icon" aria-hidden="true">↓</span><span><strong>Download ready ZIP</strong><small>{zipBlocked ? "Unavailable at this package size; use direct install or Editable project JSON." : "Extract the included folder into your Dominions 6 user-data maps directory."}</small></span></button>
      {onPlayerZip && <button className="export-option" type="button" onClick={onPlayerZip} disabled={busy || zipBlocked} aria-describedby={zipSafety.message ? "zip-memory-safety" : undefined}><span className="option-icon" aria-hidden="true">↓</span><span><strong>Download player ZIP</strong><small>Same playable files, without editable JSON or host reports. Map files still reveal content if inspected; this is not secrecy protection.</small></span></button>}
    </div>}
    {!errors && zipSafety.message && <div
      id="zip-memory-safety"
      className="warning-copy zip-memory-safety"
      role={zipBlocked ? "alert" : "status"}
    ><strong>{zipBlocked ? "ZIP download blocked for browser memory safety." : "Large ZIP memory warning."}</strong>{" "}{zipSafety.message} Estimated peak working memory: {formatBytes(zipSafety.estimatedPeakBytes)}. Direct install and Editable project JSON remain available.</div>}
    {busy && <div
      className="export-progress"
      role="progressbar"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Export progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progressPercent}
      aria-valuetext={`${progressMessage}. ${progressPercent}%. Plane ${progressPlane} of ${progressPlaneCount}.`}
    ><div><span>{progressMessage}</span><strong>{progressPercent}%</strong></div><i aria-hidden="true"><b style={{ width: `${progressPercent}%` }} /></i><small>Plane {progressPlane} of {progressPlaneCount}</small></div>}
    <div className="secondary-exports"><button type="button" onClick={onProject} disabled={busy}>Editable project JSON</button><button type="button" onClick={onPreview} disabled={busy || !canRenderPlanePreview(activePlane)} title={!canRenderPlanePreview(activePlane) ? "Fix the plane dimensions before exporting a preview." : undefined}>High-res {activePlane.width}×{activePlane.height} preview of {planeDisplayLabel(project, activePlane)}</button></div>
    <p className="export-note"><strong>{artwork === "native" ? "Native export." : "Illustrated export."}</strong> {artwork === "native" ? "Native .d6m files let Dominions render condition changes; this mode does not include Atlas’s custom realm images." : "Custom .tga artwork and province click areas are included for supported realms. Cave and other seasonless realms intentionally keep their appearance in winter. Advanced raw commands require native export because their province references cannot be safely renumbered."} The host package also includes host settings, the editable project, and a balance report. Custom catalog content may require the host’s mods.</p>
  </section></div>;
}

function SectionHeading({ kicker, title, scope }: { kicker: string; title: string; scope?: ControlScope }) { return <div className="section-heading"><p className="eyebrow">{kicker}</p><h2>{title}</h2><ScopeBadge scope={scope} /></div>; }
function Divider() { return <div className="divider" />; }
type ControlScope = "Next generation" | "Current Map" | "Current Map + next generation" | "Host / export" | "Preview only" | "Saved note only" | "On project open";
/** Scope is stated once per section; only exceptions pass a field-level scope. */
function ScopeBadge({ scope }: { scope?: ControlScope }) { return scope ? <small className="scope-badge">{scope}</small> : null; }
type SetupSectionState = { open: boolean; onToggle: (open: boolean) => void };
/** Collapsible setup group whose summary carries the section scope and a collapsed-state digest. */
function SetupSection({ title, scope, note, open, onToggle, className = "", children }: SetupSectionState & { title: string; scope?: ControlScope; note?: ReactNode; className?: string; children: ReactNode }) {
  return <details className={`setup-section ${className}`.trim()} open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
    <summary><span className="setup-section-title">{title}</span><ScopeBadge scope={scope} />{note !== undefined && <span className="setup-section-note">{note}</span>}</summary>
    <div className="setup-section-body">{children}</div>
  </details>;
}
/** One visible line of help; the remaining explanation stays available behind a native disclosure. */
function Hint({ id, topic, more, children }: { id?: string; topic?: string; more?: ReactNode; children: ReactNode }) {
  return <div className="setup-hint"><p id={id}>{children}</p>{more && <details className="more-help"><summary>More<span className="sr-only">{topic ? ` about ${topic}` : " details"}</span>…</summary><div>{more}</div></details>}</div>;
}
/** A field-level scope badge is kept outside the label so it never becomes part of the control's name. */
function Field({ label, children, scope }: { label: string; children: ReactNode; scope?: ControlScope }) {
  const generatedId = useId();
  if (!scope) return <label className="field"><span>{label}</span>{children}</label>;
  if (!isValidElement<{ id?: string }>(children)) return <div className="scoped-control"><label className="field"><span>{label}</span>{children}</label><ScopeBadge scope={scope} /></div>;
  const id = children.props.id ?? generatedId;
  return <div className="field"><span><label htmlFor={id}>{label}</label> <ScopeBadge scope={scope} /></span>{children.props.id ? children : cloneElement(children, { id })}</div>;
}
function NumberField({ label, value, min, max, describedBy, onChange, onEditStart, onEditEnd, scope }: { label: string; value: number; min: number; max: number; describedBy?: string; onChange: (value: number) => boolean | void; onEditStart?: () => void; onEditEnd?: () => void; scope?: ControlScope }) { return <Field label={label} scope={scope}><BoundedNumberInput value={value} min={min} max={max} describedBy={describedBy} onChange={onChange} onEditStart={onEditStart} onEditEnd={onEditEnd} /></Field>; }
function OptionalNumberField({ label, value, min, max, disabled = false, onChange, scope }: { label: string; value?: number; min: number; max?: number; disabled?: boolean; onChange: (value?: number) => void; scope?: ControlScope }) { return <Field label={label} scope={scope}><input type="number" value={value ?? ""} min={min} max={max} disabled={disabled} placeholder="Auto" onChange={(event) => {
  if (!event.target.value.trim()) onChange(undefined);
  else onChange(boundedInteger(event.target.value, min, min, max ?? Number.MAX_SAFE_INTEGER));
}} /></Field>; }
function RangeField({ label, value, suffix, min, max, onInteractionStart, onInteractionEnd, onChange }: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  onChange: (value: number) => void;
}) {
  const interactionActive = useRef(false);
  const begin = () => {
    if (interactionActive.current) return;
    interactionActive.current = true;
    onInteractionStart();
  };
  const finish = () => {
    if (!interactionActive.current) return;
    interactionActive.current = false;
    onInteractionEnd();
  };
  return <label className="range-field"><span>{label}<strong>{value}{suffix}</strong></span><input
    type="range"
    min={min}
    max={max}
    value={value}
    onPointerDown={begin}
    onPointerUp={finish}
    onPointerCancel={finish}
    onKeyDown={begin}
    onKeyUp={finish}
    onBlur={finish}
    onChange={(event) => { begin(); onChange(numberValue(event.target.value, min)); }}
  /></label>;
}
function Toggle({ label, checked, describedBy, onChange, scope }: { label: string; checked: boolean; describedBy?: string; onChange: (value: boolean) => void; scope?: ControlScope }) {
  const toggle = <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} aria-describedby={describedBy} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
  return scope ? <div className="scoped-control">{toggle}<ScopeBadge scope={scope} /></div> : toggle;
}

export function PlaneLayoutInfo({ plane }: { plane: Plane }) {
  const natural = plane.landformStyle === "natural-v1";
  if (resolvePlaneOwnershipMode(plane) !== "sparse") return <div className="plane-info-card province-layout-info">
    <span>Province outlines</span>
    <strong>{!plane.provinces.length ? "Generated with the next atlas" : natural ? "Natural shared borders" : "Saved province outlines"}</strong>
    <small>{natural
      ? "Irregular shared boundaries shape both shores and inland provinces. Preview, clicks and native export use the same ownership."
      : "Generate creates the new natural outlines. Opening, editing content or exporting this map keeps its saved shape."}</small>
  </div>;
  const underworld = plane.kind === "underworld";
  const sky = plane.kind === "cloud" || plane.kind === "air";
  const layoutNotice = usesConnectedRegions(plane) ? connectedRegionLayoutNotice(plane) : undefined;
  const noticeDetail = layoutNotice?.replace(/^Compatibility geometry is retained(?: because)?\s*/i, "");
  const noticeId = `${plane.id}-province-layout-notice`;
  return <>
    <div className="plane-info-card province-layout-info" aria-describedby={layoutNotice ? noticeId : undefined}>
      <span>Province layout</span>
      <strong>{underworld ? "River Styx layout" : "Connected regions & passages"}</strong>
      <small>{underworld
        ? "The Underworld keeps its realm-bisecting Styx and controlled crossings."
        : sky ? "Adjoining floating-island provinces have wind-shaped coastlines and broad, gently curved causeways."
        : "Adjoining province groups are joined by broad, playable passage provinces."}</small>
      {!underworld && !sky && <small>{natural
        ? "Realm-specific chamber contours vary without changing the movement graph."
        : "Saved contours are retained. Generate applies the new realm-specific shapes."}</small>}
    </div>
    {layoutNotice && <p id={noticeId} className="warning-copy province-layout-notice" role="status">
      <strong>Current map uses compatibility geometry.</strong>{" "}
      {noticeDetail ? noticeDetail[0]!.toLocaleUpperCase() + noticeDetail.slice(1) : layoutNotice}
    </p>}
  </>;
}

export function PlaneStartPolicyControl({ plane, onChange }: { plane: Pick<Plane, "noGeneratedStarts">; onChange: (value: boolean) => void }) {
  return <>
    <Toggle
      label="Block generated starts on this plane"
      checked={plane.noGeneratedStarts ?? false}
      describedBy="plane-generated-start-policy-help"
      onChange={onChange}
    />
    <Hint id="plane-generated-start-policy-help" topic="blocking generated starts" more={<p>Manual generic, team, and nation-specific starts remain available; every start and its directly connected provinces still receive capital protection from generated guardians, special units, and thrones.</p>}>Applies on the next Generate only.</Hint>
  </>;
}

/** A collapsible inspector section whose default is chosen once; afterwards the user's open/closed choice wins. */
function InspectorSection({ kicker, title, status, defaultOpen, children }: { kicker: string; title: string; status: string; defaultOpen: boolean; children: ReactNode }) {
  const [initiallyOpen] = useState(defaultOpen);
  return <details className="inspector-section" open={initiallyOpen}>
    <summary><span className="eyebrow">{kicker}</span><strong>{title}</strong><small>{status}</small></summary>
    <div className="details-body">{children}</div>
  </details>;
}

function CheckCard({ label, checked, onChange, compact = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; compact?: boolean }) { return <label className={`check-card ${compact ? "compact" : ""} ${checked ? "checked" : ""}`}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i>{checked ? "✓" : ""}</i><span>{label}</span></label>; }

export function CaveStartNationField({ values, caveStartCount, hasCaveFamilyPlane, entries, onChange }: {
  values: number[];
  caveStartCount: number;
  hasCaveFamilyPlane: boolean;
  entries: CatalogEntry[];
  onChange: (values: number[]) => void;
}) {
  const exceedsCapacity = values.length > caveStartCount;
  return <section className="cave-start-nation-config" aria-label="Deterministic cave-start nations">
    <CatalogIdSetField
      label="Deterministic cave-start nations"
      values={values}
      entries={entries}
      ordered
      emptyMessage="None selected — Dominions native cave preference remains in control."
      isAllowedId={(id) => Number.isSafeInteger(id) && id >= 5}
      onChange={onChange}
    />
    <p className="microcopy">Leave this empty for Dominions native cave preference. After any selection change, choose Generate to create one distinct cave capital and <code>#specstart</code> per configured nation in the priority shown. Validation blocks export until those assignments are current.</p>
    {hasCaveFamilyPlane && caveStartCount === 0 && <div className="info-card cave-start-zero-info">
      <strong>No generic cave capital will be generated</strong>
      <p>A cave-family plane exists, but Cave starts is 0. Dominions native cave preference has no cave slot to use; starts remain exactly as allocated above.</p>
    </div>}
    {exceedsCapacity && <p className="warning-copy cave-start-capacity" role="alert">{values.length} nations selected for {caveStartCount} requested cave start{caveStartCount === 1 ? "" : "s"}. {caveStartCount > 0 ? `Only the first ${caveStartCount} can be assigned; increase Cave starts or remove lower-priority nations.` : "None can be assigned until Cave starts is increased."}</p>}
  </section>;
}

function CatalogIdSetField({ label, values, entries, emptyMessage = "Unrestricted", ordered = false, isAllowedId = isPlayerNationId, onChange }: {
  label: string;
  values: number[];
  entries: CatalogEntry[];
  emptyMessage?: string;
  ordered?: boolean;
  isAllowedId?: (id: number) => boolean;
  onChange: (values: number[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = (value: string) => {
    setDraft(value);
    const id = catalogId(value, entries);
    if (id === undefined || !isAllowedId(id) || values.includes(id)) return;
    const next = [...values, id];
    onChange(ordered ? next : next.sort((left, right) => left - right));
    setDraft("");
  };
  const move = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= values.length) return;
    const next = [...values];
    [next[index], next[destination]] = [next[destination]!, next[index]!];
    onChange(next);
  };
  return <div className="catalog-id-field">
    <CatalogCombobox numericOnly key={values.join(",")} label={`Add ${label.toLocaleLowerCase()}`} value={draft} entries={entries} onCommit={add} placeholder="Search nation name or ID" />
    <div className={`catalog-chip-list ${ordered ? "ordered" : ""}`} aria-label={label}>
      {values.map((id, index) => {
        const entry = findCatalogEntry(entries, id);
        const name = entry ? formatCatalogEntry(entry) : `Custom nation #${id}`;
        return <span className={`catalog-chip ${ordered ? "ordered" : ""}`} key={id}>
          <span className="catalog-chip-label">{ordered ? `${index + 1}. ` : ""}{name}</span>
          <span className="catalog-chip-actions">
            {ordered && <button type="button" disabled={index === 0} aria-label={`Move nation ${id} earlier`} onClick={() => move(index, -1)}>↑</button>}
            {ordered && <button type="button" disabled={index === values.length - 1} aria-label={`Move nation ${id} later`} onClick={() => move(index, 1)}>↓</button>}
            <button type="button" aria-label={`Remove nation ${id}`} onClick={() => onChange(values.filter((value) => value !== id))}>×</button>
          </span>
        </span>;
      })}
      {!values.length && <small>{emptyMessage}</small>}
    </div>
  </div>;
}

function ComputerPlayersField({ values, entries, onChange }: { values: ComputerPlayer[]; entries: CatalogEntry[]; onChange: (values: ComputerPlayer[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = (value: string) => {
    setDraft(value);
    const nation = catalogId(value, entries);
    if (nation === undefined || !isPlayerNationId(nation) || values.some((entry) => entry.nation === nation)) return;
    onChange([...values, { nation, difficulty: 3 }]);
    setDraft("");
  };
  return <div className="computer-player-field">
    <CatalogCombobox numericOnly key={values.map((entry) => entry.nation).join(",")} label="Add computer-controlled nation" value={draft} entries={entries} onCommit={add} placeholder="Search nation name or ID" />
    <div className="computer-player-rows">
      {values.map((player, index) => {
        const entry = findCatalogEntry(entries, player.nation);
        return <div key={`${player.nation}:${index}`}>
          <span>{entry ? formatCatalogEntry(entry) : `Custom nation #${player.nation}`}</span>
          <select value={player.difficulty} aria-label={`AI difficulty for nation ${player.nation}`} onChange={(event) => {
            const difficulty = Math.max(1, Math.min(5, numberValue(event.target.value, 3))) as ComputerPlayer["difficulty"];
            onChange(values.map((item, itemIndex) => itemIndex === index ? { ...item, difficulty } : item));
          }}>
            <option value={1}>Easy</option><option value={2}>Normal</option><option value={3}>Difficult</option><option value={4}>Mighty</option><option value={5}>Master</option>
          </select>
          <button type="button" aria-label={`Remove AI nation ${player.nation}`} onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>×</button>
        </div>;
      })}
      {!values.length && <small>No forced computer players</small>}
    </div>
  </div>;
}

function CatalogManager({ catalog, hasUserCatalog, onImport, onReset, onTemplate }: { catalog: Dom6CatalogBundle; hasUserCatalog: boolean; onImport: () => void; onReset: () => void; onTemplate: () => void }) {
  const counts: Array<[string, number]> = [
    ["Population types", catalog.poptypes.length],
    ["Magic sites", catalog.sites.length],
    ["Units", catalog.units.length],
    ["Nations", catalog.nations.length],
    ["Forts", catalog.forts.length],
  ];
  return <section className="catalog-manager" aria-labelledby="catalog-manager-title">
    <div><p className="eyebrow">VERIFIED ID INDEX</p><h3 id="catalog-manager-title">Dominions {BUILTIN_DOM6_CATALOG.gameVersion} bundled catalogs</h3><span>{catalog.catalogVersion}</span></div>
    <div className="catalog-counts">{counts.map(([label, count]) => <span key={label}><strong>{count.toLocaleString()}</strong><small>{label}</small></span>)}</div>
    <details className="catalog-provenance"><summary>Sources &amp; license</summary>{catalog.provenance.map((source) => <div key={source.id}><strong>{source.title}</strong><span>{source.authority}{source.version ? ` · ${source.version}` : ""}</span><p>{source.source}{source.notes ? ` — ${source.notes}` : ""}</p></div>)}</details>
    <div className="catalog-actions"><button className="button quiet" type="button" onClick={onImport}>Import verified JSON</button><button className="button quiet" type="button" onClick={onTemplate}>Download template</button>{hasUserCatalog && <button className="text-button danger-text" type="button" onClick={onReset}>Reset custom entries</button>}</div>
    <p className="microcopy">The complete bundled unit and magic-site indexes come from the pinned GPL Dom6 Inspector export. Custom catalogs override matching IDs and remain in local autosave.</p>
  </section>;
}

const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

function isTextEntryTarget(target: EventTarget): boolean {
  if (typeof HTMLTextAreaElement !== "undefined" && target instanceof HTMLTextAreaElement) return true;
  return typeof HTMLInputElement !== "undefined" && target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(target.type);
}

function subscribeToMediaQuery(query: string, onChange: () => void): () => void {
  const list = window.matchMedia?.(query);
  list?.addEventListener("change", onChange);
  return () => list?.removeEventListener("change", onChange);
}

/** Server and hydration renders assume the wide layout; the client then follows the live media query. */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    useCallback((onChange: () => void) => subscribeToMediaQuery(query, onChange), [query]),
    () => window.matchMedia?.(query)?.matches ?? false,
    () => false,
  );
}

/** Single-key shortcuts must never steal characters typed into a field. */
export function isShortcutBlockedTarget(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return isTextEntryTarget(target) || target instanceof HTMLSelectElement || target.isContentEditable;
}

function defaultStartDistribution(players: number): StartDistribution {
  return { land: players, coastal: 0, water: 0, cave: 0, other: 0 };
}

function resizeStartDistribution(distribution: StartDistribution, previousPlayers: number, nextPlayers: number): StartDistribution {
  const currentTotal = Object.values(distribution).reduce((sum, value) => sum + value, 0);
  if (currentTotal !== previousPlayers) return { ...distribution };
  const next = { ...distribution };
  const delta = nextPlayers - previousPlayers;
  if (delta >= 0) {
    next.land += delta;
    return next;
  }
  let toRemove = -delta;
  for (const type of ["land", "other", "cave", "coastal", "water"] as StartType[]) {
    const removed = Math.min(next[type], toRemove);
    next[type] -= removed;
    toRemove -= removed;
    if (!toRemove) break;
  }
  return next;
}

function defaultVariantForKind(kind: PlaneKind): PlaneVariant {
  const variants: Record<PlaneKind, PlaneVariant> = {
    surface: "temperate",
    cave: "fungal",
    cavern: "crystal",
    cloud: "storm",
    air: "storm",
    underworld: "fungal",
    hell: "infernal",
    abyss: "void",
    dream: "wild",
    elemental: "volcanic",
    custom: "temperate",
  };
  return variants[kind];
}

/** Return a collision-free human name without changing imported plane IDs. */
export function uniquePlaneName(planes: Plane[], preferred: string): string {
  const used = new Set(planes.map((plane) => plane.name.trim().toLocaleLowerCase()));
  if (!used.has(preferred.trim().toLocaleLowerCase())) return preferred;
  for (let suffix = 2; suffix <= MAX_PLANES + 1; suffix += 1) {
    const candidate = `${preferred} ${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return `${preferred} ${planes.length + 1}`;
}

function isGeneratedPlaneName(name: string): boolean {
  const value = name.trim();
  if (value === "Pantokrator's Realm" || /^Plane \d+$/.test(value)) return true;
  const defaults = (["cave", "cavern", "cloud", "air", "underworld", "hell", "abyss", "dream", "elemental"] as PlaneKind[])
    .map((kind) => defaultPlaneName(kind, 1));
  return defaults.some((base) => value === base || (value.startsWith(`${base} `) && /^\d+$/.test(value.slice(base.length + 1))));
}

export function markerAnnotationsForPlane(project: Pick<MapProject, "gates" | "specificStarts">, planeId: string): ReadonlyMap<string, ProvinceMarkerAnnotations> {
  const annotations = new Map<string, { specificStartNation?: number; gateNumbers: number[] }>();
  const entryFor = (provinceId: string) => {
    const current = annotations.get(provinceId);
    if (current) return current;
    const created: { specificStartNation?: number; gateNumbers: number[] } = { gateNumbers: [] };
    annotations.set(provinceId, created);
    return created;
  };
  for (const start of project.specificStarts) {
    if (start.planeId === planeId) entryFor(start.provinceId).specificStartNation = start.nation;
  }
  for (const gate of project.gates) {
    for (const endpoint of gate.endpoints) {
      if (endpoint.planeId !== planeId) continue;
      const numbers = entryFor(endpoint.provinceId).gateNumbers;
      if (!numbers.includes(gate.gateNumber)) numbers.push(gate.gateNumber);
    }
  }
  for (const annotation of annotations.values()) annotation.gateNumbers.sort((a, b) => a - b);
  return annotations;
}

/** Plane number disambiguates duplicate names in imported projects and gate UI. */
function planeDisplayLabel(project: MapProject, plane: Plane): string {
  const index = project.planes.findIndex((candidate) => candidate.id === plane.id);
  return `Plane ${Math.max(0, index) + 1} · ${plane.name}`;
}

export function planeAutoSizeDescription(project: MapProject, plane: Plane): string {
  const planeIndex = project.planes.findIndex((item) => item.id === plane.id);
  if (plane.kind === "cave" || plane.kind === "cavern") {
    const autoCavePlanes = project.planes.filter((item, index) =>
      (item.autoSize ?? index === 0) && (item.kind === "cave" || item.kind === "cavern")).length;
    return `Cave starts × provinces/player, divided across ${Math.max(1, autoCavePlanes)} auto-sized core Cave/Cavern plane${autoCavePlanes === 1 ? "" : "s"}; minimum 18 provinces per plane`;
  }
  if (planeIndex === 0) return `(Land + coastal + water starts) × provinces/player; minimum 18 provinces`;
  if (plane.kind === "surface" || (plane.kind === "custom" && plane.ownershipMode !== "sparse"
    && !["fungal", "crystal", "volcanic", "storm", "infernal", "void"].includes(plane.variant ?? "temperate"))) {
    return "Surface-like core share of players × provinces/player; minimum 18 provinces";
  }
  return `Bonus realm: ${project.settings.specialPlaneSizePercent ?? 30}% of the combined generated core total; minimum 18, maximum 800 provinces`;
}

function resolvePlaneConnectionRules(project: MapProject): PlaneConnectionRule[] {
  const defaults = createDefaultPlaneConnections(
    project.planes,
    project.settings.gateLayout ?? "hub",
    project.settings.gatePairsPerConnection ?? 1,
  );
  const planeIds = new Set(project.planes.map((plane) => plane.id));
  const existing = new Map<string, PlaneConnectionRule>();
  for (const rule of project.settings.planeConnections ?? []) {
    if (rule.a === rule.b || !planeIds.has(rule.a) || !planeIds.has(rule.b)) continue;
    existing.set(connectionKey(rule.a, rule.b), rule);
  }
  return defaults.map((fallback) => {
    const current = existing.get(connectionKey(fallback.a, fallback.b));
    return current ? {
      ...fallback,
      enabled: current.enabled !== false,
      pairs: Math.max(1, Math.min(3, Math.round(current.pairs))),
    } : fallback;
  });
}

export function includeSelectedEntry(filtered: CatalogEntry[], all: CatalogEntry[], value: string | number | undefined): CatalogEntry[] {
  const selected = findCatalogEntry(all, value);
  if (!selected || filtered.some((entry) => entry.id === selected.id)) return filtered;
  return [selected, ...filtered];
}

function catalogId(value: string, entries: CatalogEntry[]): number | undefined {
  const known = findCatalogEntry(entries, value);
  if (known) return known.id;
  const numeric = optionalNumber(value.replace(/^#/, ""));
  return numeric !== undefined && Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

export function isPlayerNationId(id: number): boolean {
  return Number.isSafeInteger(id) && id >= 5;
}

function playerNationEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return entries.filter((entry) => isPlayerNationId(entry.id) && (entry.era === undefined || entry.era > 0));
}

function handleTabKey<T extends string>(event: KeyboardEvent<HTMLButtonElement>, tabs: readonly T[], active: T, select: (tab: T) => void) {
  const currentIndex = Math.max(0, tabs.indexOf(active));
  let nextIndex: number | undefined;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.length - 1;
  if (nextIndex === undefined) return;
  event.preventDefault();
  select(tabs[nextIndex]!);
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
}

export function dialogShouldClose(key: string, closeDisabled: boolean): boolean {
  return key === "Escape" && !closeDisabled;
}

/**
 * Return the focus index needed to keep Tab inside a dialog. `-1` means the
 * dialog container itself when the busy state has no enabled descendants.
 */
export function resolveDialogTabIndex(
  focusableCount: number,
  activeIndex: number,
  shiftKey: boolean,
): number | undefined {
  if (focusableCount <= 0) return -1;
  if (activeIndex < 0) return shiftKey ? focusableCount - 1 : 0;
  if (shiftKey && activeIndex === 0) return focusableCount - 1;
  if (!shiftKey && activeIndex === focusableCount - 1) return 0;
  return undefined;
}

function useDialogFocus<T extends HTMLElement>(onClose: () => void, closeDisabled = false) {
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { closeDisabledRef.current = closeDisabled; }, [closeDisabled]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])';
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      (dialog?.querySelector<HTMLElement>(focusableSelector) ?? dialog)?.focus();
    });
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (dialogShouldClose(event.key, closeDisabledRef.current)) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => element.offsetParent !== null);
      const activeIndex = focusable.findIndex((element) => element === document.activeElement);
      const targetIndex = resolveDialogTabIndex(focusable.length, activeIndex, event.shiftKey);
      if (targetIndex === undefined) return;
      event.preventDefault();
      if (targetIndex < 0) dialogRef.current.focus();
      else focusable[targetIndex]?.focus();
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, []);
  return dialogRef;
}

function numberValue(value: string, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function boundedInteger(value: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}
function optionalNumber(value: string): number | undefined { if (!value.trim()) return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function optionalBooleanValue(value: boolean | undefined): "inherit" | "on" | "off" { return value === undefined ? "inherit" : value ? "on" : "off"; }
function parseOptionalBoolean(value: string): boolean | undefined { return value === "on" ? true : value === "off" ? false : undefined; }
function formatBytes(bytes: number): string { if (bytes < 1_000_000) return `${Math.ceil(bytes / 1000)} KB`; return `${(bytes / 1_000_000).toFixed(bytes > 100_000_000 ? 0 : 1)} MB`; }
function scoreClass(score: number): string { return score >= 85 ? "excellent" : score >= 70 ? "fair" : "poor"; }
function downloadBrowserBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1500); }
