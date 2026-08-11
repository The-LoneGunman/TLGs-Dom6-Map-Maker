"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
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
  sanitizeMapName,
  type BiomeKey,
  type ComputerPlayer,
  type EdgeKind,
  type GateLayout,
  type GenerationSettings,
  type MagicPath,
  type MapProject,
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
  gateCompatibility,
  generateProject,
  hashString,
  synchronizePlaneEdges,
} from "./generator";
import { ADVANCED_COMMANDS, terrainMask, validateProject } from "./dom6";
import { auditPlaneTopology, computeProvinceTopology, connectionKey } from "./geometry";
import {
  downloadPackage,
  downloadProject,
  estimatedPackageBytes,
  installPackage,
  parseProject,
  type ExportProgress,
} from "./export";
import { MapCanvas, renderPlanePng } from "./MapCanvas";
import { CatalogCombobox } from "./catalog/CatalogCombobox";
import {
  BUILTIN_DOM6_CATALOG,
  createCatalogTemplate,
  findCatalogEntry,
  formatCatalogEntry,
  mergeCatalogBundles,
  parseCatalogBundle,
  siteCompatibility,
  type CatalogEntry,
  type Dom6CatalogBundle,
} from "./catalog";

type Tool = "select" | "link" | "gate" | "start" | "throne" | "site";
type InspectorTab = "terrain" | "gameplay" | "sites" | "advanced";
type LeftTab = "generate" | "planes" | "scenario";

const STORAGE_KEY = "pantokrator-atlas-project-v1";
const CATALOG_STORAGE_KEY = "pantokrator-atlas-user-catalog-v1";
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
const CONDITIONS: Array<{ value: PreviewCondition; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "winter", label: "Frozen / winter" },
  { value: "forested", label: "Forested" },
  { value: "flooded", label: "Submerged" },
  { value: "wasted", label: "Wasted" },
  { value: "farmland", label: "Farmland" },
];

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
  { value: "cloud", label: "Cloud realm", description: "Stormy high realm with sparse ground." },
  { value: "air", label: "Air plane", description: "Aerial and storm-biased other plane." },
  { value: "underworld", label: "Underworld", description: "Fungal, death, and deep-earth terrain." },
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

export function MapMakerApp() {
  const [project, setProject] = useState<MapProject>(() => createDefaultProject());
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
  const [exportOpen, setExportOpen] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress>();
  const [exportBusy, setExportBusy] = useState(false);
  const [toast, setToast] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [userCatalog, setUserCatalog] = useState<Dom6CatalogBundle>();
  const importRef = useRef<HTMLInputElement>(null);
  const catalogImportRef = useRef<HTMLInputElement>(null);

  const activePlane = project.planes.find((plane) => plane.id === activePlaneId) ?? project.planes[0];
  const selected = activePlane?.provinces.find((province) => province.id === selectedId);
  const catalog = useMemo(() => mergeCatalogBundles(BUILTIN_DOM6_CATALOG, ...(userCatalog ? [userCatalog] : [])), [userCatalog]);
  const playableNations = useMemo(() => playerNationEntries(catalog.nations), [catalog.nations]);
  const startDistribution = project.settings.startDistribution ?? defaultStartDistribution(project.settings.players);
  const allocatedStarts = Object.values(startDistribution).reduce((sum, value) => sum + value, 0);
  const planeConnectionRules = useMemo(() => resolvePlaneConnectionRules(project), [project]);
  const fairness = useMemo(() => calculateFairness(project), [project]);
  const issues = useMemo(() => validateProject(project), [project]);
  const topologyAudits = useMemo(() => project.planes.map((plane) => ({
    planeId: plane.id,
    audit: auditPlaneTopology(plane),
  })), [project.planes]);
  const projectTopologyIssueCount = topologyAudits.reduce((sum, item) =>
    sum + item.audit.missing.length + item.audit.extra.length, 0);
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const totalProvinces = project.planes.reduce((sum, plane) => sum + plane.provinces.length, 0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const restored = parseProject(saved);
          setProject(restored);
          setActivePlaneId(restored.planes[0]?.id ?? "");
        }
      } catch {
        setToast("The autosave could not be restored; a fresh atlas was opened.");
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(CATALOG_STORAGE_KEY);
        if (saved) {
          const parsed = parseCatalogBundle(saved);
          mergeCatalogBundles(BUILTIN_DOM6_CATALOG, parsed);
          setUserCatalog(parsed);
        }
      } catch {
        window.localStorage.removeItem(CATALOG_STORAGE_KEY);
        setToast("A saved custom catalog was invalid and has been ignored.");
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [hydrated, project]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(undefined), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const commit = useCallback((next: MapProject, remember = true) => {
    if (remember) {
      setUndoStack((stack) => [...stack.slice(-29), project]);
      setRedoStack([]);
    }
    setProject(next);
  }, [project]);

  const mutate = useCallback((recipe: (draft: MapProject) => void, remember = true) => {
    const draft = cloneProject(project);
    recipe(draft);
    draft.updatedAt = new Date().toISOString();
    commit(draft, remember);
  }, [commit, project]);

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
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-29), project]);
    setProject(previous);
    setSelectedId(undefined);
  };

  const handleRedo = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-29), project]);
    setProject(next);
    setSelectedId(undefined);
  };

  const handleGenerate = () => {
    if (allocatedStarts !== project.settings.players) {
      setLeftTab("generate");
      setToast(`Start allocation totals ${allocatedStarts}; it must equal ${project.settings.players} players.`);
      return;
    }
    const source = cloneProject(project);
    source.settings.gateDirection = "bidirectional";
    const next = generateProject(source);
    commit(next);
    setActivePlaneId(next.planes[0]?.id ?? "");
    setSelectedId(undefined);
    setLinkSource(undefined);
    setGateSource(undefined);
    setToast(`Generated ${next.planes.reduce((sum, plane) => sum + plane.provinces.length, 0)} provinces from seed “${next.seed}”.`);
  };

  const stagePlane = () => {
    const next = addPlane(project, "underworld", { generate: false, autoSize: false });
    next.settings.planeConnections = resolvePlaneConnectionRules(next);
    commit(next);
    setActivePlaneId(next.planes.at(-1)?.id ?? activePlaneId);
    setSelectedId(undefined);
    setLeftTab("planes");
    setToast("Plane added to the generation plan. Configure it, then generate the atlas.");
  };

  const importCatalog = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = parseCatalogBundle(await file.text());
      const merged = userCatalog ? mergeCatalogBundles(userCatalog, imported) : imported;
      mergeCatalogBundles(BUILTIN_DOM6_CATALOG, merged);
      setUserCatalog(merged);
      window.localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(merged));
      const count = imported.poptypes.length + imported.sites.length + imported.units.length + imported.nations.length + imported.forts.length + imported.planes.length + imported.siteTerrainTypes.length;
      setToast(`Loaded ${count.toLocaleString()} verified catalog entries from ${imported.catalogVersion}.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Catalog import failed.");
    }
  };

  const resetCatalog = () => {
    setUserCatalog(undefined);
    window.localStorage.removeItem(CATALOG_STORAGE_KEY);
    setToast("Custom catalog entries removed; bundled Dominions 6.35 data remains available.");
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
    mutate((draft) => {
      draft.planes = draft.planes.map((plane, planeIndex) => synchronizePlaneEdges(
        plane,
        `${draft.seed}:plane:${planeIndex}:border-sync`,
      ));
    });
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
        if (province.start) {
          province.noStart = false;
          province.throne = "avoid";
        }
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
      const topology = computeProvinceTopology(activePlane);
      if (!topology.pairKeys.has(connectionKey(linkSource.provinceId, provinceId))) {
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
        setToast("Switch planes, then choose the destination province.");
        return;
      }
      if (gateSource.planeId === activePlane.id && gateSource.provinceId === provinceId) {
        setGateSource(undefined);
        return;
      }
      mutate((draft) => {
        const nextNumber = Math.max(0, ...draft.gates.map((gate) => gate.gateNumber)) + 1;
        draft.gates.push({
          id: `gate-manual-${nextNumber}-${hashString(draft.seed).toString(36)}`,
          gateNumber: nextNumber,
          endpoints: [gateSource, { planeId: activePlane.id, provinceId }],
        });
      });
      setGateSource(undefined);
      setToast("Cross-plane gate linked.");
    }
  };

  const updateProvinceById = (planeId: string, provinceId: string, recipe: (province: Province) => void) => {
    mutate((draft) => {
      const province = draft.planes.find((plane) => plane.id === planeId)?.provinces.find((item) => item.id === provinceId);
      if (province) recipe(province);
    });
  };

  const runExport = async (kind: "install" | "zip") => {
    if (errorCount) {
      setValidationOpen(true);
      return;
    }
    setExportBusy(true);
    setExportProgress({ stage: "preparing", plane: 0, planeCount: project.planes.length, percent: 0, message: "Preparing the atlas…" });
    try {
      if (kind === "install") {
        const result = await installPackage(project, setExportProgress);
        if (result === "unsupported") {
          setToast("Direct folder access is unavailable here. Use the ready-to-install ZIP instead.");
        } else if (result === "installed") {
          setToast("Installed into your selected Dominions 6 maps folder.");
        }
      } else {
        await downloadPackage(project, setExportProgress);
        setToast("Ready-to-install map package downloaded.");
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExportBusy(false);
    }
  };

  const exportPreview = async () => {
    if (!activePlane) return;
    setExportBusy(true);
    try {
      const blob = await renderPlanePng(activePlane, preview);
      downloadBrowserBlob(blob, `${sanitizeMapName(project.name)}-${sanitizeMapName(activePlane.name)}-${preview}.png`);
      setToast("High-resolution preview exported.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Preview export failed.");
    } finally {
      setExportBusy(false);
    }
  };

  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const next = parseProject(await file.text());
      commit(next);
      setActivePlaneId(next.planes[0]?.id ?? "");
      setSelectedId(undefined);
      setToast(`Opened ${next.name}.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Project import failed.");
    }
  };

  if (!activePlane) return <main className="empty-state">No plane is available.</main>;

  return (
    <main className="atlas-shell">
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
            value={project.name}
            onChange={(event) => mutate((draft) => { draft.name = event.target.value; })}
            aria-label="Project name"
          />
          <span className="autosave"><i /> Local autosave</span>
        </div>
        <div className="top-actions">
          <button className="icon-button" type="button" onClick={handleUndo} disabled={!undoStack.length} title="Undo" aria-label="Undo">↶</button>
          <button className="icon-button" type="button" onClick={handleRedo} disabled={!redoStack.length} title="Redo" aria-label="Redo">↷</button>
          <button className="button quiet" type="button" onClick={() => setValidationOpen(true)}>
            Validate <span className={errorCount ? "count error" : warningCount ? "count warning" : "count ok"}>{errorCount || warningCount || "✓"}</span>
          </button>
          <button className="button primary" type="button" onClick={() => setExportOpen(true)}>Install / export</button>
        </div>
      </header>

      <div className="workbench">
        <aside className="left-panel panel">
          <div className="tab-row compact-tabs" role="tablist" aria-label="Map setup">
            {(["generate", "planes", "scenario"] as LeftTab[]).map((tab) => (
              <button key={tab} type="button" className={leftTab === tab ? "active" : ""} onClick={() => setLeftTab(tab)}>
                {tab === "generate" ? "Generate" : tab === "planes" ? "Planes" : "Scenario"}
              </button>
            ))}
          </div>

          {leftTab === "generate" && (
            <div className="panel-scroll setup-stack">
              <SectionHeading kicker="WORLD SEED" title="Realm generator" />
              <Field label="Seed">
                <div className="input-with-button">
                  <input value={project.seed} onChange={(event) => mutate((draft) => { draft.seed = event.target.value; })} />
                  <button type="button" onClick={() => mutate((draft) => { draft.seed = randomSeed(); })} aria-label="Randomize seed">✣</button>
                </div>
              </Field>
              <div className="field-grid two">
                <NumberField label="Players" value={project.settings.players} min={2} max={32} onChange={(value) => mutate((draft) => {
                  draft.settings.startDistribution = resizeStartDistribution(
                    draft.settings.startDistribution ?? defaultStartDistribution(draft.settings.players),
                    draft.settings.players,
                    value,
                  );
                  draft.settings.players = value;
                })} />
                <NumberField label="Provinces / player" value={project.settings.provincesPerPlayer} min={8} max={30} onChange={(value) => mutate((draft) => { draft.settings.provincesPerPlayer = value; })} />
              </div>
              <Divider />
              <SectionHeading kicker="PLAYER HOMELANDS" title="Start allocation" />
              <div className="start-allocation-grid">
                {START_TYPES.map((item) => <NumberField
                  key={item.value}
                  label={`${item.label} starts`}
                  value={startDistribution[item.value]}
                  min={0}
                  max={32}
                  onChange={(value) => mutate((draft) => {
                    const distribution = draft.settings.startDistribution ?? defaultStartDistribution(draft.settings.players);
                    draft.settings.startDistribution = { ...distribution, [item.value]: value };
                  })}
                />)}
              </div>
              <div className={`allocation-summary ${allocatedStarts === project.settings.players ? "valid" : "invalid"}`}>
                <span>{allocatedStarts} of {project.settings.players} starts allocated</span>
                {allocatedStarts !== project.settings.players && <button type="button" onClick={() => mutate((draft) => {
                  const distribution = draft.settings.startDistribution ?? defaultStartDistribution(draft.settings.players);
                  const nonLand = distribution.coastal + distribution.water + distribution.cave + distribution.other;
                  draft.settings.startDistribution = { ...distribution, land: Math.max(0, draft.settings.players - nonLand) };
                })}>Put remainder on land</button>}
              </div>
              <NumberField label="Minimum useful connections at starts" value={project.settings.startDegreeTarget ?? 4} min={1} max={8} onChange={(value) => mutate((draft) => { draft.settings.startDegreeTarget = value; })} />
              <p className="microcopy">Land, coast, water, cave, and other counts must total the player count. Each category is placed on a compatible plane and scored against the connection target.</p>
              <Divider />
              <SectionHeading kicker="WORLD SHAPE" title={`${project.planes.length}-plane generation plan`} />
              <RangeField label="Water provinces" value={project.settings.waterPercent} suffix="%" min={0} max={60} onChange={(value) => mutate((draft) => { draft.settings.waterPercent = value; }, false)} />
              <RangeField label="Biome cohesion" value={project.settings.biomeCohesion} suffix="%" min={0} max={100} onChange={(value) => mutate((draft) => { draft.settings.biomeCohesion = value; }, false)} />
              <NumberField label="Recommended throne locations" value={project.settings.throneCount} min={0} max={64} onChange={(value) => mutate((draft) => { draft.settings.throneCount = value; })} />
              <Field label="Output resolution">
                <select value={project.settings.resolution} onChange={(event) => commit(applyResolution(project, event.target.value as GenerationSettings["resolution"]))}>
                  {Object.entries(RESOLUTION_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}
                  <option value="custom">Custom per plane</option>
                </select>
              </Field>
              <div className="resolution-card">
                <span>{activePlane.width.toLocaleString()} × {activePlane.height.toLocaleString()}</span>
                <small>Native D6M • condition-reactive</small>
              </div>
              <Toggle label="Wrap east / west" checked={activePlane.wrapX} onChange={(value) => updateWrap("wrapX", value)} />
              <Toggle label="Wrap north / south" checked={activePlane.wrapY} onChange={(value) => updateWrap("wrapY", value)} />
              <button className="button quiet wide" type="button" onClick={() => setLeftTab("planes")}>Configure plane archetypes &amp; gates</button>
              <button className="button generate-button" type="button" disabled={allocatedStarts !== project.settings.players} onClick={handleGenerate}><span>✦</span> Generate balanced atlas ({project.planes.length} plane{project.planes.length === 1 ? "" : "s"})</button>
              <button
                className="button quiet wide"
                type="button"
                disabled={!projectTopologyIssueCount}
                onClick={handleSynchronizeBorders}
              >
                {projectTopologyIssueCount
                  ? `Synchronize ${projectTopologyIssueCount} project border issue${projectTopologyIssueCount === 1 ? "" : "s"}`
                  : "Visible borders synchronized"}
              </button>
              <p className="microcopy">Every shared border is a Dominions connection. Rivers, passes, roads, and impassable borders are drawn directly on that boundary.</p>
            </div>
          )}

          {leftTab === "planes" && (
            <div className="panel-scroll setup-stack">
              <SectionHeading kicker="MULTI-REALM" title={`${project.planes.length} of ${MAX_PLANES} planes`} />
              <div className="plane-list">
                {project.planes.map((plane, index) => (
                  <button
                    className={`plane-list-item ${plane.id === activePlane.id ? "active" : ""}`}
                    key={plane.id}
                    type="button"
                    onClick={() => { setActivePlaneId(plane.id); setSelectedId(undefined); }}
                  >
                    <span className={`plane-gem kind-${plane.kind}`}>{index + 1}</span>
                    <span><strong>{plane.name}</strong><small>{plane.provinces.length ? `${plane.provinces.length} provinces` : "Draft — not generated"} · {plane.kind}</small></span>
                    <i className={validateProject({ ...project, planes: [plane] }).some((issue) => issue.severity === "error") ? "bad" : "good"} />
                  </button>
                ))}
              </div>
              <button
                className="button quiet wide"
                type="button"
                disabled={project.planes.length >= MAX_PLANES}
                onClick={stagePlane}
              >+ Add plane to plan</button>
              <Divider />
              <Field label="Plane name"><input value={activePlane.name} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.name = event.target.value; })} /></Field>
              <Field label="Plane archetype"><select value={activePlane.kind} onChange={(event) => mutate((draft) => {
                const plane = draft.planes.find((item) => item.id === activePlane.id)!;
                plane.kind = event.target.value as PlaneKind;
                plane.variant = defaultVariantForKind(plane.kind);
              })}>{PLANE_KINDS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>
              <p className="field-note">{PLANE_KINDS.find((item) => item.value === activePlane.kind)?.description}</p>
              <Field label="Terrain variant"><select value={activePlane.variant ?? defaultVariantForKind(activePlane.kind)} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.variant = event.target.value as PlaneVariant; })}>{PLANE_VARIANTS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>
              <Toggle label="Auto-size from player count" checked={activePlane.autoSize ?? project.planes[0]?.id === activePlane.id} onChange={(value) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.autoSize = value; })} />
              {activePlane.autoSize
                ? <div className="resolution-card"><span>Automatic province count</span><small>{activePlane.id === project.planes[0]?.id ? "Players × provinces per player" : "45% of the main-plane target"}</small></div>
                : <NumberField label="Province target" value={activePlane.provinceTarget} min={8} max={800} onChange={(value) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.provinceTarget = value; })} />}
              <Toggle label="Wrap east / west" checked={activePlane.wrapX} onChange={(value) => updateWrap("wrapX", value)} />
              <Toggle label="Wrap north / south" checked={activePlane.wrapY} onChange={(value) => updateWrap("wrapY", value)} />
              {project.settings.resolution === "custom" && (
                <>
                  <div className="field-grid two">
                    <NumberField label="Width" value={activePlane.width} min={256} max={3840} onChange={(value) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.width = value; })} />
                    <NumberField label="Height" value={activePlane.height} min={256} max={3840} onChange={(value) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.height = value; })} />
                  </div>
                  <p className="field-note">Each axis is capped at 3,840 pixels; width × height must remain at or below 8.29 megapixels.</p>
                </>
              )}
              <details className="plane-advanced-settings">
                <summary>Plane display &amp; native flags</summary>
                <div>
                  <Field label="Reveal this plane's map image"><select value={optionalBooleanValue(activePlane.mapNoHide)} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.mapNoHide = parseOptionalBoolean(event.target.value); })}><option value="inherit">Inherit scenario setting</option><option value="on">On</option><option value="off">Off</option></select></Field>
                  <Field label="Disable random deep caves from this plane"><select value={optionalBooleanValue(activePlane.noDeepCaves)} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.noDeepCaves = parseOptionalBoolean(event.target.value); })}><option value="inherit">Inherit scenario setting</option><option value="on">On</option><option value="off">Off</option></select></Field>
                  <Field label="Province-name color (#maptextcol)"><input placeholder="0.93 0.88 0.70 1.0" value={activePlane.mapTextColor ?? ""} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.mapTextColor = event.target.value || undefined; })} /></Field>
                  <Field label="Dominion-overlay color (#mapdomcol)"><input placeholder="238 205 112 42" value={activePlane.mapDominionColor ?? ""} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.mapDominionColor = event.target.value || undefined; })} /></Field>
                </div>
              </details>
              {project.planes.length > 1 && (
                <button className="text-button danger-text" type="button" onClick={() => {
                  const index = project.planes.findIndex((plane) => plane.id === activePlane.id);
                  const nextId = project.planes[index === 0 ? 1 : index - 1]?.id;
                  mutate((draft) => {
                    draft.planes = draft.planes.filter((plane) => plane.id !== activePlane.id);
                    draft.gates = draft.gates.filter((gate) => !gate.endpoints.some((endpoint) => endpoint.planeId === activePlane.id));
                    draft.specificStarts = draft.specificStarts.filter((start) => start.planeId !== activePlane.id);
                    draft.settings.planeConnections = draft.settings.planeConnections?.filter((rule) => rule.a !== activePlane.id && rule.b !== activePlane.id);
                  });
                  setActivePlaneId(nextId ?? "");
                  setSelectedId(undefined);
                }}>Remove this plane</button>
              )}
              <Divider />
              <SectionHeading kicker="DEFAULT LAYER LINKS" title="Gate generation" />
              <Field label="Connection preset"><select value={project.settings.gateLayout ?? "hub"} onChange={(event) => mutate((draft) => {
                const layout = event.target.value as GateLayout;
                draft.settings.gateLayout = layout;
                draft.settings.gateDirection = "bidirectional";
                draft.settings.planeConnections = createDefaultPlaneConnections(draft.planes, layout, draft.settings.gatePairsPerConnection ?? 1);
              })}>{GATE_LAYOUTS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>
              <p className="field-note">{GATE_LAYOUTS.find((item) => item.value === (project.settings.gateLayout ?? "hub"))?.description}</p>
              <NumberField label="Default pairs per enabled link" value={project.settings.gatePairsPerConnection ?? 1} min={1} max={3} onChange={(value) => mutate((draft) => {
                draft.settings.gatePairsPerConnection = value;
                draft.settings.gateDirection = "bidirectional";
                draft.settings.planeConnections = resolvePlaneConnectionRules(draft).map((rule) => ({ ...rule, pairs: value }));
              })} />
              <div className="plane-connection-list" aria-label="Plane connection matrix">
                {planeConnectionRules.map((rule) => {
                  const source = project.planes.find((plane) => plane.id === rule.a);
                  const destination = project.planes.find((plane) => plane.id === rule.b);
                  if (!source || !destination) return null;
                  const compatible = gateCompatibility(source.kind, destination.kind);
                  return <div className={`plane-connection-row ${rule.enabled === false ? "disabled" : ""}`} key={`${rule.a}:${rule.b}`}>
                    <label aria-label={`Connect ${source.name} and ${destination.name}`}><input type="checkbox" checked={rule.enabled !== false} onChange={(event) => mutate((draft) => {
                      draft.settings.gateDirection = "bidirectional";
                      draft.settings.planeConnections = resolvePlaneConnectionRules(draft).map((item) => item.a === rule.a && item.b === rule.b ? { ...item, enabled: event.target.checked } : item);
                    })} /><span><strong>{source.name} ↔ {destination.name}</strong><small>{compatible}% archetype compatibility · bidirectional</small></span></label>
                    <input type="number" min={1} max={3} value={rule.pairs} disabled={rule.enabled === false} aria-label={`Gate pairs between ${source.name} and ${destination.name}`} onChange={(event) => mutate((draft) => {
                      const pairs = numberValue(event.target.value, 1);
                      draft.settings.planeConnections = resolvePlaneConnectionRules(draft).map((item) => item.a === rule.a && item.b === rule.b ? { ...item, pairs: Math.max(1, Math.min(3, pairs)) } : item);
                    })} />
                  </div>;
                })}
                {!planeConnectionRules.length && <p>Add another plane to configure its gate connection.</p>}
              </div>
              <div className="gate-summary">
                <strong>{project.gates.filter((gate) => gate.endpoints.some((endpoint) => endpoint.planeId === activePlane.id)).length} gates touch this plane</strong>
                <span>Use the Gate tool, choose a source, switch planes, then choose its destination.</span>
              </div>
            </div>
          )}

          {leftTab === "scenario" && (
            <div className="panel-scroll setup-stack">
              <SectionHeading kicker="HOST & SCENARIO" title="Game setup" />
              <Field label="Description"><textarea rows={3} value={project.description} onChange={(event) => mutate((draft) => { draft.description = event.target.value; })} /></Field>
              <NumberField label="Minimum Dominions version (#domversion)" value={project.targetVersion} min={600} max={999} onChange={(value) => mutate((draft) => { draft.targetVersion = value; })} />
              <p className="field-note">Use 635 or newer when relying on IDs from the bundled Dominions 6.35 catalog.</p>
              <div className="field-grid two">
                <NumberField label="Sail distance" value={project.sailDistance} min={1} max={10} onChange={(value) => mutate((draft) => { draft.sailDistance = value; })} />
                <NumberField label="Site frequency" value={project.settings.siteFrequency ?? 50} min={0} max={100} onChange={(value) => mutate((draft) => { draft.settings.siteFrequency = value; })} />
              </div>
              <OptionalNumberField label="Ascension points" value={project.victoryPoints} min={1} max={999} onChange={(value) => mutate((draft) => { draft.victoryPoints = value; })} />
              <CatalogIdSetField label="Allowed nations" values={project.allowedPlayers} entries={playableNations} onChange={(values) => mutate((draft) => { draft.allowedPlayers = values; })} />
              <ComputerPlayersField values={project.computerPlayers} entries={playableNations} onChange={(values) => mutate((draft) => { draft.computerPlayers = values; })} />
              <CatalogIdSetField label="Cannot-win nations" values={project.cannotWin} entries={playableNations} onChange={(values) => mutate((draft) => { draft.cannotWin = values; })} />
              <Toggle label="Reveal map image" checked={project.mapNoHide} onChange={(value) => mutate((draft) => { draft.mapNoHide = value; })} />
              <Toggle label="Disable random deep-cave planes" checked={project.noDeepCaves} onChange={(value) => mutate((draft) => { draft.noDeepCaves = value; })} />
              <Toggle label="Hide deep-plane choice" checked={project.noDeepChoice} onChange={(value) => mutate((draft) => { draft.noDeepChoice = value; })} />
              <Toggle label="Disable homeland names" checked={project.noHomelandNames} onChange={(value) => mutate((draft) => { draft.noHomelandNames = value; })} />
              <Toggle label="Disable name filter" checked={project.noNameFilter} onChange={(value) => mutate((draft) => { draft.noNameFilter = value; })} />
              <Field label="Map-level directives"><textarea className="code-input" rows={7} placeholder="#god 5 120\n#dominionstr 5 7" value={project.rawDirectives} onChange={(event) => mutate((draft) => { draft.rawDirectives = event.target.value; })} /></Field>
              <p className="microcopy">Raw directives preserve advanced Dominions 6 scenario commands that do not need a dedicated control.</p>
              <Divider />
              <CatalogManager catalog={catalog} hasUserCatalog={!!userCatalog} onImport={() => catalogImportRef.current?.click()} onReset={resetCatalog} onTemplate={downloadCatalogTemplate} />
            </div>
          )}
        </aside>

        <section className="canvas-column">
          <div className="canvas-toolbar">
            <div className="tool-group" aria-label="Map tools">
              {TOOL_ITEMS.map((item) => (
                <button
                  key={item.id}
                  className={tool === item.id ? "active" : ""}
                  type="button"
                  onClick={() => { setTool(item.id); setLinkSource(undefined); setGateSource(undefined); }}
                  title={item.hint}
                  aria-label={item.label}
                ><span>{item.mark}</span><small>{item.label}</small></button>
              ))}
            </div>
            <div className="canvas-controls">
              {(linkSource || gateSource) && <span className="pending-link">Endpoint armed</span>}
              <label>Condition preview
                <select value={preview} onChange={(event) => setPreview(event.target.value as PreviewCondition)}>
                  {CONDITIONS.map((condition) => <option value={condition.value} key={condition.value}>{condition.label}</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="map-stage">
            <MapCanvas key={activePlane.id} plane={activePlane} selectedId={selectedId} previewCondition={preview} onSelect={handleProvinceClick} onZoomChange={setZoom} tool={tool} />
            <div className="map-title-card">
              <span>{activePlane.kind}</span>
              <strong>{activePlane.name}</strong>
              <small>{activePlane.provinces.length} provinces · {activePlane.width}×{activePlane.height}</small>
            </div>
            <div className="map-legend">
              <span><i className="legend-border" />Shared border = connected</span>
              <span><i className="legend-start" />Start</span>
              <span><i className="legend-throne" />Throne</span>
              <span><i className="legend-site" />Site</span>
              <span><i className="legend-defense" />Guardians</span>
            </div>
          </div>
          <div className="plane-strip" aria-label="Plane selector">
            {project.planes.map((plane, index) => (
              <button key={plane.id} type="button" className={plane.id === activePlane.id ? "active" : ""} onClick={() => { setActivePlaneId(plane.id); setSelectedId(undefined); }}>
                <span>{index + 1}</span><strong>{plane.name}</strong><small>{plane.provinces.length}</small>
              </button>
            ))}
            {project.planes.length < MAX_PLANES && <button className="add-plane-mini" type="button" onClick={() => setLeftTab("planes")}>+ Plane</button>}
          </div>
        </section>

        <aside className="right-panel panel">
          {selected ? (
            <>
              <div className="province-header">
                <div>
                  <p className="eyebrow">PROVINCE {selected.index}</p>
                  <input value={selected.name} onChange={(event) => updateSelected((province) => { province.name = event.target.value; })} aria-label="Province name" />
                </div>
                <span className="terrain-mask" title="Dominions terrain mask">{terrainMask(selected).toString()}</span>
              </div>
              <div className="tab-row inspector-tabs" role="tablist" aria-label="Province inspector">
                {(["terrain", "gameplay", "sites", "advanced"] as InspectorTab[]).map((tab) => (
                  <button key={tab} type="button" className={inspectorTab === tab ? "active" : ""} onClick={() => setInspectorTab(tab)}>
                    {tab === "sites" ? "Sites & PD" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
              <div className="panel-scroll inspector-scroll">
                {inspectorTab === "terrain" && <TerrainInspector province={selected} update={updateSelected} />}
                {inspectorTab === "gameplay" && <GameplayInspector catalog={catalog} project={project} planeId={activePlane.id} province={selected} update={updateSelected} mutateProject={mutate} />}
                {inspectorTab === "sites" && <SitesDefenseInspector catalog={catalog} plane={activePlane} province={selected} update={updateSelected} />}
                {inspectorTab === "advanced" && <AdvancedInspector project={project} planeId={activePlane.id} province={selected} update={updateSelected} mutateProject={mutate} />}
              </div>
            </>
          ) : (
            <div className="empty-inspector">
              <span className="empty-sigil">⌖</span>
              <p className="eyebrow">PROVINCE INSPECTOR</p>
              <h2>Select a province</h2>
              <p>Inspect terrain, starts, thrones, magic sites, unique guardians, battle scenery, and raw map commands.</p>
              <div className="selection-hints">
                <span><kbd>Scroll</kbd> zoom</span><span><kbd>Drag</kbd> pan</span><span><kbd>Arrows</kbd> next province</span>
              </div>
            </div>
          )}
        </aside>
      </div>

      <footer className="statusbar">
        <span><i className={errorCount ? "status-dot bad" : "status-dot good"} />{errorCount ? `${errorCount} export blocker${errorCount === 1 ? "" : "s"}` : "Dominions checks ready"}</span>
        <span>{project.planes.length} plane{project.planes.length === 1 ? "" : "s"} · {totalProvinces} provinces · {project.settings.players} starts target</span>
        <span>Fairness <strong className={scoreClass(fairness.overall)}>{fairness.overall}</strong></span>
        <span>{Math.round(zoom * 100)}%</span>
        <span>{formatBytes(estimatedPackageBytes(project))} package</span>
      </footer>

      {validationOpen && <ValidationDrawer issues={issues} fairness={fairness} onClose={() => setValidationOpen(false)} onSelectIssue={(issue) => {
        if (issue.planeId) setActivePlaneId(issue.planeId);
        if (issue.provinceId) setSelectedId(issue.provinceId);
        setValidationOpen(false);
      }} />}

      {exportOpen && <ExportDialog
        project={project}
        issues={issues}
        progress={exportProgress}
        busy={exportBusy}
        onClose={() => !exportBusy && setExportOpen(false)}
        onInstall={() => runExport("install")}
        onZip={() => runExport("zip")}
        onProject={() => { downloadProject(project); setToast("Editable project downloaded."); }}
        onPreview={exportPreview}
        onValidate={() => { setExportOpen(false); setValidationOpen(true); }}
      />}

      <input ref={importRef} className="sr-only" type="file" accept=".json,.atlas.json,application/json" onChange={importProject} />
      <input ref={catalogImportRef} className="sr-only" type="file" accept=".json,application/json" onChange={importCatalog} />
      <button className="import-fab" type="button" onClick={() => importRef.current?.click()} title="Open an Atlas project">Open project</button>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function TerrainInspector({ province, update }: { province: Province; update: (recipe: (province: Province) => void) => void }) {
  const inherentFlags = effectiveProvinceTerrainFlags({ terrain: province.terrain, terrainFlags: undefined, freshwater: false });
  const effectiveFlags = effectiveProvinceTerrainFlags(province);
  const additionalFlags = ADDITIVE_TERRAIN_FLAGS.filter((flag) => !inherentFlags.has(flag));
  return (
    <div className="inspector-stack">
      <SectionHeading kicker="MECHANICAL TERRAIN" title="Biome & terrain" />
      <Field label="Visual / primary terrain"><select value={province.terrain} onChange={(event) => update((item) => {
        item.terrain = event.target.value as TerrainKey;
        const nextInherent = effectiveProvinceTerrainFlags({ terrain: item.terrain, terrainFlags: undefined, freshwater: false });
        item.terrainFlags = item.terrainFlags?.filter((flag) => !nextInherent.has(flag));
        if (!item.terrainFlags?.length) item.terrainFlags = undefined;
      })}>{TERRAIN_KEYS.map((key) => <option value={key} key={key}>{TERRAIN_LABELS[key]}</option>)}</select></Field>
      <Field label="Biome"><select value={province.biome} onChange={(event) => update((item) => { item.biome = event.target.value as BiomeKey; })}>{BIOME_KEYS.map((key) => <option value={key} key={key}>{BIOME_LABELS[key]}</option>)}</select></Field>
      <div className="choice-grid">
        <CheckCard label="Small province" checked={province.small} onChange={(value) => update((item) => { item.small = value; if (value) item.large = false; })} />
        <CheckCard label="Large province" checked={province.large} onChange={(value) => update((item) => { item.large = value; if (value) item.small = false; })} />
        <CheckCard label="No random start" checked={province.noStart} onChange={(value) => update((item) => { item.noStart = value; if (value) item.start = false; })} />
        <CheckCard label="Many sites" checked={province.manySites} onChange={(value) => update((item) => { item.manySites = value; })} />
        <CheckCard label="Fresh-water marker" checked={effectiveFlags.has("freshwater")} onChange={(value) => update((item) => {
          item.freshwater = value || undefined;
          item.terrainFlags = item.terrainFlags?.filter((flag) => flag !== "freshwater");
          if (!item.terrainFlags?.length) item.terrainFlags = undefined;
        })} />
        <CheckCard label="Warmer" checked={province.warmer} onChange={(value) => update((item) => { item.warmer = value; if (value) item.colder = false; })} />
        <CheckCard label="Colder" checked={province.colder} onChange={(value) => update((item) => { item.colder = value; if (value) item.warmer = false; })} />
      </div>
      <Divider />
      <SectionHeading kicker="ADDITIVE BITMASK" title="Additional terrain flags" />
      <p className="microcopy">Primary terrain contributes {([...inherentFlags].map((flag) => TERRAIN_FLAG_LABELS[flag]).join(" + ") || "plain land")}. Add any legal Dominions combination below; the manual recommends no more than two adverse types.</p>
      <div className="choice-grid">
        {additionalFlags.map((flag) => <CheckCard
          key={flag}
          compact
          label={TERRAIN_FLAG_LABELS[flag]}
          checked={province.terrainFlags?.includes(flag) ?? false}
          onChange={(value) => update((item) => {
            item.terrainFlags = value
              ? [...new Set([...(item.terrainFlags ?? []), flag])]
              : item.terrainFlags?.filter((entry) => entry !== flag);
            if (!item.terrainFlags?.length) item.terrainFlags = undefined;
            if (value && flag === "cavewall") {
              item.noStart = true;
              item.start = false;
            }
          })}
        />)}
      </div>
      <p className="field-note">Effective mask: {[...effectiveFlags].map((flag) => TERRAIN_FLAG_LABELS[flag]).join(" + ") || "plain land"}. Sea + Mountains enables underwater-mountain sites; Sea + Forest is kelp/underwater forest. Fresh water remains a land marker unless Sea is also set.</p>
      <Divider />
      <SectionHeading kicker="SITE AFFINITY" title="Magic path bias" />
      <div className="path-grid">
        {MAGIC_PATHS.map((path) => <CheckCard key={path} compact label={MAGIC_PATH_LABELS[path]} checked={province.siteBias.includes(path)} onChange={(value) => update((item) => { item.siteBias = value ? [...new Set([...item.siteBias, path])] : item.siteBias.filter((entry) => entry !== path); })} />)}
      </div>
      <div className="info-card"><strong>Native terrain rendering</strong><p>The terrain mask is the source of truth. Fresh water is an auxiliary marker and does not make a province aquatic. Dominions redraws winter, forests, flooding/submergence, farms, waste, kelp, and related changes itself.</p></div>
    </div>
  );
}

function GameplayInspector({ catalog, project, planeId, province, update, mutateProject }: { catalog: Dom6CatalogBundle; project: MapProject; planeId: string; province: Province; update: (recipe: (province: Province) => void) => void; mutateProject: (recipe: (project: MapProject) => void) => void }) {
  const specific = project.specificStarts.find((start) => start.planeId === planeId && start.provinceId === province.id);
  const plane = project.planes.find((item) => item.id === planeId)!;
  const playableNations = playerNationEntries(catalog.nations);
  return (
    <div className="inspector-stack">
      <SectionHeading kicker="MULTIPLAYER" title="Starts & thrones" />
      <Toggle label="Generic player start" checked={province.start} onChange={(value) => update((item) => { item.start = value; if (value) { item.noStart = false; item.throne = "avoid"; } })} />
      <OptionalNumberField label="Team-start group" value={province.teamStart} min={0} onChange={(value) => update((item) => { item.teamStart = value; })} />
      <CatalogCombobox label="Specific-start nation" value={specific?.nation} entries={playableNations} placeholder="Search playable nation name or ID" onCommit={(value) => {
        const nation = optionalNumber(value);
        mutateProject((draft) => {
          draft.specificStarts = draft.specificStarts.filter((start) => !(start.planeId === planeId && start.provinceId === province.id));
          if (nation !== undefined && isPlayerNationId(nation)) draft.specificStarts.push({ nation, planeId, provinceId: province.id });
        });
      }} />
      <Field label="Throne treatment"><select value={province.throne} onChange={(event) => update((item) => { item.throne = event.target.value as Province["throne"]; if (item.throne !== "fixed") item.fixedThrone = undefined; })}>
        <option value="none">Neutral</option><option value="preferred">Preferred location</option><option value="avoid">Avoid location</option><option value="fixed">Fixed throne site (advanced)</option>
      </select></Field>
      {province.throne === "fixed" && <CatalogCombobox label="Fixed throne site" value={province.fixedThrone} entries={catalog.sites.filter((entry) => entry.tags?.includes("throne"))} getEntryStatus={(entry) => siteCompatibility(entry, province, plane)} onCommit={(value) => update((item) => { item.fixedThrone = value || undefined; })} placeholder="Search throne name or ID" />}
      {province.throne === "fixed" && <p className="warning-copy">Fixed thrones use a magic-site feature and can conflict with a unique site selected randomly. Preferred locations are the reliable multiplayer default.</p>}
      <Divider />
      <SectionHeading kicker="PROVINCE SETUP" title="Ownership & economy" />
      <div className="catalog-field-grid">
        <CatalogCombobox label="Owner nation" value={province.owner} entries={catalog.nations} placeholder="Search nation name or ID" onCommit={(value) => update((item) => { item.owner = optionalNumber(value); if (item.owner !== undefined && [0, 2, 4].includes(item.owner)) item.provinceDefense = undefined; })} />
        <CatalogCombobox label="Population type" value={province.poptype} entries={catalog.poptypes} placeholder="Search poptype name or ID" onCommit={(value) => update((item) => { item.poptype = optionalNumber(value); })} />
        <CatalogCombobox label="Fortification" value={province.fort} entries={catalog.forts} placeholder="Search fort name or ID" onCommit={(value) => update((item) => { item.fort = optionalNumber(value); })} />
      </div>
      <div className="field-grid two">
        <OptionalNumberField label="Population" value={province.population} min={0} max={50000} onChange={(value) => update((item) => { item.population = value; })} />
        <OptionalNumberField label="Unrest" value={province.unrest} min={0} max={500} onChange={(value) => update((item) => { item.unrest = value; })} />
        <OptionalNumberField label="Owned PD level" value={province.provinceDefense} min={0} max={125} disabled={province.owner !== undefined && [0, 2, 4].includes(province.owner)} onChange={(value) => update((item) => { item.provinceDefense = value; })} />
      </div>
      <p className="microcopy">The map manual guarantees that poptype changes local recruitment, not the initial independent army. It does not define separate PD-roster IDs. Owned PD level only applies when a playable owner nation is set.</p>
      <Toggle label="Temple" checked={province.temple} onChange={(value) => update((item) => { item.temple = value; })} />
      <Toggle label="Laboratory" checked={province.lab} onChange={(value) => update((item) => { item.lab = value; })} />
    </div>
  );
}

function SitesDefenseInspector({ catalog, plane, province, update }: { catalog: Dom6CatalogBundle; plane: Plane; province: Province; update: (recipe: (province: Province) => void) => void }) {
  const [showAllSites, setShowAllSites] = useState(false);
  const siteStatus = (entry: CatalogEntry) => siteCompatibility(entry, province, plane);
  const compatibleSites = showAllSites ? catalog.sites : catalog.sites.filter((entry) => siteStatus(entry).compatible);
  return (
    <div className="inspector-stack">
      <SectionHeading kicker="MAGIC SITES" title="Placed sites" />
      <Toggle label="Remove randomly generated sites" checked={province.killRandomSites} onChange={(value) => update((item) => { item.killRandomSites = value; })} />
      <div className="catalog-filter-bar"><span>{compatibleSites.length.toLocaleString()} of {catalog.sites.length.toLocaleString()} sites shown</span><button type="button" className={showAllSites ? "active" : ""} onClick={() => setShowAllSites((value) => !value)}>{showAllSites ? "Compatible only" : "Show all"}</button></div>
      <div className="site-list">
        {province.sites.map((site, index) => (
          <div className="site-row" key={site.id}>
            <CatalogCombobox compact label={`Site ${index + 1}`} value={site.value} entries={includeSelectedEntry(compatibleSites, catalog.sites, site.value)} getEntryStatus={siteStatus} placeholder="Search site name or ID" onCommit={(value) => update((item) => { item.sites[index]!.value = value; })} />
            <label title="Known at game start"><input type="checkbox" checked={site.known} onChange={(event) => update((item) => { item.sites[index]!.known = event.target.checked; })} />Known</label>
            <button type="button" onClick={() => update((item) => { item.sites.splice(index, 1); })} aria-label="Remove site">×</button>
          </div>
        ))}
      </div>
      <button className="button quiet wide" type="button" onClick={() => update((item) => { item.sites.push({ id: `site-${Date.now().toString(36)}`, value: "", known: false }); })}>+ Place magic site</button>
      <p className="microcopy">Hidden sites use <code>#feature</code>; known sites use <code>#knownfeature</code>. Exact site compatibility depends on the vanilla site selected.</p>
      <Divider />
      <SectionHeading kicker="UNIQUE INITIAL DEFENSE" title="Guardian groups" />
      <div className="info-card amber"><strong>Map-only boundary</strong><p>These commanders and squads are unique initial independents. Persistent purchasable PD composition is defined by a vanilla poptype or nation; a wholly new PD roster requires enabling a separate mod.</p></div>
      {province.defenders.map((defense, defenseIndex) => (
        <div className="defense-card" key={`${defense.commander}-${defenseIndex}`}>
          <div className="card-heading"><strong>Guardian group {defenseIndex + 1}</strong><button type="button" onClick={() => update((item) => { item.defenders.splice(defenseIndex, 1); })}>Remove</button></div>
          <CatalogCombobox label="Commander" value={defense.commander} entries={catalog.units} placeholder="Search unit name or ID" onCommit={(value) => update((item) => { item.defenders[defenseIndex]!.commander = value; })} />
          <Field label="Commander display name"><input value={defense.commanderName ?? ""} onChange={(event) => update((item) => { item.defenders[defenseIndex]!.commanderName = event.target.value || undefined; })} /></Field>
          {defense.squads.map((squad, squadIndex) => (
            <div className="squad-row" key={squad.id}>
              <input type="number" min={1} value={squad.count} aria-label="Squad count" onChange={(event) => update((item) => { item.defenders[defenseIndex]!.squads[squadIndex]!.count = numberValue(event.target.value, 1); })} />
              <CatalogCombobox compact label={`Squad ${squadIndex + 1} unit`} value={squad.unit} entries={catalog.units} placeholder="Search unit name or ID" onCommit={(value) => update((item) => { item.defenders[defenseIndex]!.squads[squadIndex]!.unit = value; })} />
              <button type="button" onClick={() => update((item) => { item.defenders[defenseIndex]!.squads.splice(squadIndex, 1); })} aria-label="Remove squad">×</button>
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
              <Field label="Specific items (one per line)"><textarea rows={3} value={(defense.items ?? []).join("\n")} onChange={(event) => update((item) => { item.defenders[defenseIndex]!.items = lines(event.target.value); })} /></Field>
              <Toggle label="Clear commander's innate magic first" checked={defense.clearMagic ?? false} onChange={(value) => update((item) => { item.defenders[defenseIndex]!.clearMagic = value || undefined; })} />
              <div className="bodyguard-fields">
                <CatalogCombobox label="Bodyguard unit" value={defense.bodyguard} entries={catalog.units} placeholder="Search unit name or ID" onCommit={(value) => update((item) => {
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
      <button className="button quiet wide" type="button" disabled={province.start} onClick={() => update((item) => { item.defenders.push({ commander: "", squads: [{ id: `squad-${Date.now().toString(36)}`, unit: "", count: 10 }] }); })}>+ Add guardian group</button>
      {province.start && <p className="warning-copy">Initial guardians are disabled on starts because Dominions’ <code>#land</code> command would erase the starting army and pretender.</p>}
    </div>
  );
}

function AdvancedInspector({ project, planeId, province, update, mutateProject }: { project: MapProject; planeId: string; province: Province; update: (recipe: (province: Province) => void) => void; mutateProject: (recipe: (project: MapProject) => void) => void }) {
  const plane = project.planes.find((item) => item.id === planeId)!;
  const incident = plane.edges.filter((edge) => edge.a === province.id || edge.b === province.id);
  return (
    <div className="inspector-stack">
      <SectionHeading kicker="BORDERS" title={`${incident.length} connections`} />
      <div className="edge-list">{incident.map((edge) => {
        const otherId = edge.a === province.id ? edge.b : edge.a;
        const other = plane.provinces.find((item) => item.id === otherId);
        return <div className="edge-row" key={edge.id}><span>{other?.index}. {other?.name}</span><select value={edge.kind} onChange={(event) => mutateProject((draft) => { const target = draft.planes.find((item) => item.id === planeId)!.edges.find((item) => item.id === edge.id)!; target.kind = event.target.value as EdgeKind; })}>{EDGE_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></div>;
      })}</div>
      <Divider />
      <SectionHeading kicker="BATTLE SCENE" title="Province battlefield" />
      <Field label="Skybox"><input value={province.battle.skybox ?? ""} onChange={(event) => update((item) => { item.battle.skybox = event.target.value || undefined; })} /></Field>
      <Field label="Battle map"><input value={province.battle.battleMap ?? ""} onChange={(event) => update((item) => { item.battle.battleMap = event.target.value || undefined; })} /></Field>
      <div className="field-grid three">
        <Field label="Ground RGB"><input placeholder="0.4 0.4 0.3" value={province.battle.groundColor ?? ""} onChange={(event) => update((item) => { item.battle.groundColor = event.target.value || undefined; })} /></Field>
        <Field label="Rock RGB"><input placeholder="0.3 0.3 0.3" value={province.battle.rockColor ?? ""} onChange={(event) => update((item) => { item.battle.rockColor = event.target.value || undefined; })} /></Field>
        <Field label="Fog RGB"><input placeholder="0.6 0.6 0.7" value={province.battle.fogColor ?? ""} onChange={(event) => update((item) => { item.battle.fogColor = event.target.value || undefined; })} /></Field>
      </div>
      <Field label="Province directives"><textarea className="code-input" rows={7} placeholder="#clearmagic\n#mag_fire 2" value={province.rawDirectives} onChange={(event) => update((item) => { item.rawDirectives = event.target.value; })} /></Field>
      <Field label="Plane directives"><textarea className="code-input" rows={5} placeholder="#maptextcol …" value={plane.rawDirectives} onChange={(event) => mutateProject((draft) => { draft.planes.find((item) => item.id === planeId)!.rawDirectives = event.target.value; })} /></Field>
      <details className="coverage-list"><summary>Dominions feature coverage ({ADVANCED_COMMANDS.length} command families)</summary><div>{ADVANCED_COMMANDS.map((item) => <span key={item.command}><code>{item.command}</code><small>{item.description}</small></span>)}</div></details>
    </div>
  );
}

function ValidationDrawer({ issues, fairness, onClose, onSelectIssue }: { issues: ValidationIssue[]; fairness: ReturnType<typeof calculateFairness>; onClose: () => void; onSelectIssue: (issue: ValidationIssue) => void }) {
  return <div className="drawer-backdrop"><aside className="validation-drawer" aria-modal="true" role="dialog" aria-label="Map validation">
    <div className="dialog-heading"><div><p className="eyebrow">EXPORT READINESS</p><h2>Compatibility & fairness</h2></div><button type="button" onClick={onClose} aria-label="Close">×</button></div>
    <div className="score-hero"><div className={`score-ring ${scoreClass(fairness.overall)}`} style={{ "--score": fairness.overall } as CSSProperties}><strong>{fairness.overall}</strong><small>overall</small></div><div><h3>Multiplayer balance</h3><p>{fairness.notes[0]}</p></div></div>
    <div className="metric-grid">{([['Start spacing', fairness.startSeparation], ['Expansion parity', fairness.expansionParity], ['Throne access', fairness.throneAccess], ['Terrain variety', fairness.terrainVariety], ['Connectivity', fairness.connectivity]] as Array<[string, number]>).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong><i><b style={{ width: `${value}%` }} /></i></div>)}</div>
    <div className="validation-list">{issues.map((issue) => <button key={issue.id} type="button" className={`issue ${issue.severity}`} onClick={() => onSelectIssue(issue)}><span>{issue.severity === "error" ? "!" : issue.severity === "warning" ? "△" : "✓"}</span><p><strong>{issue.severity}</strong>{issue.message}</p></button>)}</div>
  </aside></div>;
}

function ExportDialog({ project, issues, progress, busy, onClose, onInstall, onZip, onProject, onPreview, onValidate }: { project: MapProject; issues: ValidationIssue[]; progress?: ExportProgress; busy: boolean; onClose: () => void; onInstall: () => void; onZip: () => void; onProject: () => void; onPreview: () => void; onValidate: () => void }) {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  return <div className="modal-backdrop"><section className="export-dialog" role="dialog" aria-modal="true" aria-label="Install or export map">
    <div className="dialog-heading"><div><p className="eyebrow">DOMINIONS 6 PACKAGE</p><h2>Install a playable atlas</h2></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close">×</button></div>
    <div className="package-summary"><div className="package-glyph">D6</div><div><strong>{sanitizeMapName(project.name)}.map</strong><span>{project.planes.length} plane{project.planes.length === 1 ? "" : "s"} · {project.planes.reduce((sum, plane) => sum + plane.provinces.length, 0)} provinces · {formatBytes(estimatedPackageBytes(project))}</span></div><i className={errors ? "bad" : "good"}>{errors ? "!" : "✓"}</i></div>
    {errors ? <div className="export-blocked"><strong>{errors} compatibility blocker{errors === 1 ? "" : "s"}</strong><p>Resolve export errors before building the package.</p><button className="button quiet" type="button" onClick={onValidate}>Review validation</button></div> : <div className="export-options">
      <button className="export-option primary-option" type="button" onClick={onInstall} disabled={busy}><span className="option-icon">↳</span><span><strong>Install directly</strong><small>Choose the Dominions 6 <code>maps</code> folder once; the ready-to-play folder is written there.</small></span><b>Recommended</b></button>
      <button className="export-option" type="button" onClick={onZip} disabled={busy}><span className="option-icon">↓</span><span><strong>Download ready ZIP</strong><small>Extract the included folder into your Dominions 6 user-data <code>maps</code> directory.</small></span></button>
    </div>}
    {busy && progress && <div className="export-progress"><div><span>{progress.message}</span><strong>{progress.percent}%</strong></div><i><b style={{ width: `${progress.percent}%` }} /></i><small>Plane {Math.max(1, progress.plane)} of {progress.planeCount}</small></div>}
    <div className="secondary-exports"><button type="button" onClick={onProject} disabled={busy}>Editable project JSON</button><button type="button" onClick={onPreview} disabled={busy}>High-res {project.planes[0]?.width}×{project.planes[0]?.height} preview</button></div>
    <p className="export-note"><strong>Zero-mod export.</strong> Native <code>.d6m</code> files let Dominions render condition changes. The package also includes host settings, the editable project, and a balance report.</p>
  </section></div>;
}

function SectionHeading({ kicker, title }: { kicker: string; title: string }) { return <div className="section-heading"><p className="eyebrow">{kicker}</p><h2>{title}</h2></div>; }
function Divider() { return <div className="divider" />; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) { return <Field label={label}><input type="number" value={value} min={min} max={max} onChange={(event) => onChange(numberValue(event.target.value, min))} /></Field>; }
function OptionalNumberField({ label, value, min, max, disabled = false, onChange }: { label: string; value?: number; min: number; max?: number; disabled?: boolean; onChange: (value?: number) => void }) { return <Field label={label}><input type="number" value={value ?? ""} min={min} max={max} disabled={disabled} placeholder="Auto" onChange={(event) => onChange(optionalNumber(event.target.value))} /></Field>; }
function RangeField({ label, value, suffix, min, max, onChange }: { label: string; value: number; suffix: string; min: number; max: number; onChange: (value: number) => void }) { return <label className="range-field"><span>{label}<strong>{value}{suffix}</strong></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(numberValue(event.target.value, min))} /></label>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>; }
function CheckCard({ label, checked, onChange, compact = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; compact?: boolean }) { return <label className={`check-card ${compact ? "compact" : ""} ${checked ? "checked" : ""}`}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i>{checked ? "✓" : ""}</i><span>{label}</span></label>; }

function CatalogIdSetField({ label, values, entries, onChange }: { label: string; values: number[]; entries: CatalogEntry[]; onChange: (values: number[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = (value: string) => {
    setDraft(value);
    const id = catalogId(value, entries);
    if (id === undefined || !isPlayerNationId(id) || values.includes(id)) return;
    onChange([...values, id].sort((left, right) => left - right));
    setDraft("");
  };
  return <div className="catalog-id-field">
    <CatalogCombobox key={values.join(",")} label={`Add ${label.toLocaleLowerCase()}`} value={draft} entries={entries} onCommit={add} placeholder="Search nation name or ID" />
    <div className="catalog-chip-list" aria-label={label}>
      {values.map((id) => {
        const entry = findCatalogEntry(entries, id);
        return <span className="catalog-chip" key={id}><span>{entry ? formatCatalogEntry(entry) : `Custom nation #${id}`}</span><button type="button" aria-label={`Remove nation ${id}`} onClick={() => onChange(values.filter((value) => value !== id))}>×</button></span>;
      })}
      {!values.length && <small>Unrestricted</small>}
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
    <CatalogCombobox key={values.map((entry) => entry.nation).join(",")} label="Add computer-controlled nation" value={draft} entries={entries} onCommit={add} placeholder="Search nation name or ID" />
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

function includeSelectedEntry(filtered: CatalogEntry[], all: CatalogEntry[], value: string | number | undefined): CatalogEntry[] {
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

function isPlayerNationId(id: number): boolean {
  return ![0, 2, 4].includes(id);
}

function playerNationEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return entries.filter((entry) => isPlayerNationId(entry.id) && (entry.era === undefined || entry.era > 0));
}

function numberValue(value: string, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function optionalNumber(value: string): number | undefined { if (!value.trim()) return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function optionalBooleanValue(value: boolean | undefined): "inherit" | "on" | "off" { return value === undefined ? "inherit" : value ? "on" : "off"; }
function parseOptionalBoolean(value: string): boolean | undefined { return value === "on" ? true : value === "off" ? false : undefined; }
function lines(value: string): string[] { return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
function randomSeed(): string { return `realm-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}`; }
function formatBytes(bytes: number): string { if (bytes < 1_000_000) return `${Math.ceil(bytes / 1000)} KB`; return `${(bytes / 1_000_000).toFixed(bytes > 100_000_000 ? 0 : 1)} MB`; }
function scoreClass(score: number): string { return score >= 85 ? "excellent" : score >= 70 ? "fair" : "poor"; }
function downloadBrowserBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1500); }
