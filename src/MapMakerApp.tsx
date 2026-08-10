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
  TERRAIN_LABELS,
  cloneProject,
  sanitizeMapName,
  type BiomeKey,
  type EdgeKind,
  type GenerationSettings,
  type MagicPath,
  type MapProject,
  type PlaneKind,
  type PreviewCondition,
  type Province,
  type TerrainKey,
  type ValidationIssue,
} from "./domain";
import {
  addPlane,
  applyResolution,
  calculateFairness,
  createDefaultProject,
  generateProject,
  hashString,
} from "./generator";
import { ADVANCED_COMMANDS, terrainMask, validateProject } from "./dom6";
import {
  downloadPackage,
  downloadProject,
  estimatedPackageBytes,
  installPackage,
  parseProject,
  type ExportProgress,
} from "./export";
import { MapCanvas, renderPlanePng } from "./MapCanvas";

type Tool = "select" | "link" | "gate" | "start" | "throne" | "site";
type InspectorTab = "terrain" | "gameplay" | "sites" | "advanced";
type LeftTab = "generate" | "planes" | "scenario";

const STORAGE_KEY = "pantokrator-atlas-project-v1";
const TERRAIN_KEYS = Object.keys(TERRAIN_LABELS) as TerrainKey[];
const BIOME_KEYS = Object.keys(BIOME_LABELS) as BiomeKey[];
const MAGIC_PATHS = Object.keys(MAGIC_PATH_LABELS) as MagicPath[];
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
  { id: "link", mark: "⌁", label: "Link", hint: "Connect two provinces" },
  { id: "gate", mark: "◎", label: "Gate", hint: "Link provinces across planes" },
  { id: "start", mark: "S", label: "Start", hint: "Toggle a player start" },
  { id: "throne", mark: "♜", label: "Throne", hint: "Cycle throne preference" },
  { id: "site", mark: "✦", label: "Site", hint: "Toggle many-sites terrain" },
];

const PLANE_KINDS: Array<{ value: PlaneKind; label: string }> = [
  { value: "surface", label: "Surface" },
  { value: "underworld", label: "Underworld" },
  { value: "abyss", label: "Abyss" },
  { value: "dream", label: "Dream" },
  { value: "elemental", label: "Elemental" },
  { value: "custom", label: "Custom" },
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
  const importRef = useRef<HTMLInputElement>(null);

  const activePlane = project.planes.find((plane) => plane.id === activePlaneId) ?? project.planes[0];
  const selected = activePlane?.provinces.find((province) => province.id === selectedId);
  const fairness = useMemo(() => calculateFairness(project), [project]);
  const issues = useMemo(() => validateProject(project), [project]);
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
    const next = generateProject(project);
    commit(next);
    setActivePlaneId(next.planes[0]?.id ?? "");
    setSelectedId(undefined);
    setLinkSource(undefined);
    setGateSource(undefined);
    setToast(`Generated ${next.planes.reduce((sum, plane) => sum + plane.provinces.length, 0)} provinces from seed “${next.seed}”.`);
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
      mutate((draft) => {
        const plane = draft.planes.find((item) => item.id === activePlane.id)!;
        const existing = plane.edges.find((edge) =>
          (edge.a === linkSource.provinceId && edge.b === provinceId)
          || (edge.b === linkSource.provinceId && edge.a === provinceId));
        if (existing) plane.edges = plane.edges.filter((edge) => edge.id !== existing.id);
        else plane.edges.push({
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
                <NumberField label="Players" value={project.settings.players} min={2} max={32} onChange={(value) => mutate((draft) => { draft.settings.players = value; })} />
                <NumberField label="Provinces / player" value={project.settings.provincesPerPlayer} min={8} max={30} onChange={(value) => mutate((draft) => { draft.settings.provincesPerPlayer = value; })} />
              </div>
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
              <Toggle label="Wrap east / west" checked={activePlane.wrapX} onChange={(value) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.wrapX = value; })} />
              <Toggle label="Wrap north / south" checked={activePlane.wrapY} onChange={(value) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.wrapY = value; })} />
              <button className="button generate-button" type="button" onClick={handleGenerate}><span>✦</span> Generate balanced atlas</button>
              <p className="microcopy">Deterministic geometry, connected graphs, coherent biomes, spaced starts, contested thrones, and reproducible gates.</p>
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
                    <span><strong>{plane.name}</strong><small>{plane.provinces.length} provinces · {plane.kind}</small></span>
                    <i className={validateProject({ ...project, planes: [plane] }).some((issue) => issue.severity === "error") ? "bad" : "good"} />
                  </button>
                ))}
              </div>
              <button
                className="button quiet wide"
                type="button"
                disabled={project.planes.length >= MAX_PLANES}
                onClick={() => {
                  const next = addPlane(project);
                  commit(next);
                  setActivePlaneId(next.planes.at(-1)!.id);
                  setSelectedId(undefined);
                }}
              >+ Add linked plane</button>
              <Divider />
              <Field label="Plane name"><input value={activePlane.name} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.name = event.target.value; })} /></Field>
              <Field label="Realm type"><select value={activePlane.kind} onChange={(event) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.kind = event.target.value as PlaneKind; })}>{PLANE_KINDS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field>
              <NumberField label="Province target" value={activePlane.provinceTarget} min={8} max={800} onChange={(value) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.provinceTarget = value; })} />
              {project.settings.resolution === "custom" && (
                <div className="field-grid two">
                  <NumberField label="Width" value={activePlane.width} min={256} max={32767} onChange={(value) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.width = value; })} />
                  <NumberField label="Height" value={activePlane.height} min={256} max={32767} onChange={(value) => mutate((draft) => { draft.planes.find((plane) => plane.id === activePlane.id)!.height = value; })} />
                </div>
              )}
              {project.planes.length > 1 && (
                <button className="text-button danger-text" type="button" onClick={() => {
                  const index = project.planes.findIndex((plane) => plane.id === activePlane.id);
                  const nextId = project.planes[index === 0 ? 1 : index - 1]?.id;
                  mutate((draft) => {
                    draft.planes = draft.planes.filter((plane) => plane.id !== activePlane.id);
                    draft.gates = draft.gates.filter((gate) => !gate.endpoints.some((endpoint) => endpoint.planeId === activePlane.id));
                    draft.specificStarts = draft.specificStarts.filter((start) => start.planeId !== activePlane.id);
                  });
                  setActivePlaneId(nextId ?? "");
                  setSelectedId(undefined);
                }}>Remove this plane</button>
              )}
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
              <div className="field-grid two">
                <NumberField label="Sail distance" value={project.sailDistance} min={1} max={10} onChange={(value) => mutate((draft) => { draft.sailDistance = value; })} />
                <NumberField label="Site frequency" value={project.settings.siteFrequency ?? 50} min={0} max={100} onChange={(value) => mutate((draft) => { draft.settings.siteFrequency = value; })} />
              </div>
              <OptionalNumberField label="Ascension points" value={project.victoryPoints} min={1} max={999} onChange={(value) => mutate((draft) => { draft.victoryPoints = value; })} />
              <CsvField label="Allowed nation IDs" values={project.allowedPlayers} onChange={(values) => mutate((draft) => { draft.allowedPlayers = values; })} />
              <Field label="Forced AI players (nation:difficulty)"><input value={project.computerPlayers.map((player) => `${player.nation}:${player.difficulty}`).join(", ")} placeholder="e.g. 5:3, 12:4" onChange={(event) => mutate((draft) => { draft.computerPlayers = parseComputerPlayers(event.target.value); })} /></Field>
              <CsvField label="Cannot-win nation IDs" values={project.cannotWin} onChange={(values) => mutate((draft) => { draft.cannotWin = values; })} />
              <Toggle label="Reveal map image" checked={project.mapNoHide} onChange={(value) => mutate((draft) => { draft.mapNoHide = value; })} />
              <Toggle label="Disable random deep-cave planes" checked={project.noDeepCaves} onChange={(value) => mutate((draft) => { draft.noDeepCaves = value; })} />
              <Toggle label="Hide deep-plane choice" checked={project.noDeepChoice} onChange={(value) => mutate((draft) => { draft.noDeepChoice = value; })} />
              <Toggle label="Disable homeland names" checked={project.noHomelandNames} onChange={(value) => mutate((draft) => { draft.noHomelandNames = value; })} />
              <Toggle label="Disable name filter" checked={project.noNameFilter} onChange={(value) => mutate((draft) => { draft.noNameFilter = value; })} />
              <Field label="Map-level directives"><textarea className="code-input" rows={7} placeholder="#god 5 120\n#dominionstr 5 7" value={project.rawDirectives} onChange={(event) => mutate((draft) => { draft.rawDirectives = event.target.value; })} /></Field>
              <p className="microcopy">Raw directives preserve advanced Dominions 6 scenario commands that do not need a dedicated control.</p>
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
                {inspectorTab === "gameplay" && <GameplayInspector project={project} planeId={activePlane.id} province={selected} update={updateSelected} mutateProject={mutate} />}
                {inspectorTab === "sites" && <SitesDefenseInspector province={selected} update={updateSelected} />}
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
      <button className="import-fab" type="button" onClick={() => importRef.current?.click()} title="Open an Atlas project">Open project</button>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function TerrainInspector({ province, update }: { province: Province; update: (recipe: (province: Province) => void) => void }) {
  return (
    <div className="inspector-stack">
      <SectionHeading kicker="MECHANICAL TERRAIN" title="Biome & terrain" />
      <Field label="Terrain type"><select value={province.terrain} onChange={(event) => update((item) => { item.terrain = event.target.value as TerrainKey; })}>{TERRAIN_KEYS.map((key) => <option value={key} key={key}>{TERRAIN_LABELS[key]}</option>)}</select></Field>
      <Field label="Biome"><select value={province.biome} onChange={(event) => update((item) => { item.biome = event.target.value as BiomeKey; })}>{BIOME_KEYS.map((key) => <option value={key} key={key}>{BIOME_LABELS[key]}</option>)}</select></Field>
      <div className="choice-grid">
        <CheckCard label="Small province" checked={province.small} onChange={(value) => update((item) => { item.small = value; if (value) item.large = false; })} />
        <CheckCard label="Large province" checked={province.large} onChange={(value) => update((item) => { item.large = value; if (value) item.small = false; })} />
        <CheckCard label="No random start" checked={province.noStart} onChange={(value) => update((item) => { item.noStart = value; if (value) item.start = false; })} />
        <CheckCard label="Many sites" checked={province.manySites} onChange={(value) => update((item) => { item.manySites = value; })} />
        <CheckCard label="Warmer" checked={province.warmer} onChange={(value) => update((item) => { item.warmer = value; if (value) item.colder = false; })} />
        <CheckCard label="Colder" checked={province.colder} onChange={(value) => update((item) => { item.colder = value; if (value) item.warmer = false; })} />
      </div>
      <Divider />
      <SectionHeading kicker="SITE AFFINITY" title="Magic path bias" />
      <div className="path-grid">
        {MAGIC_PATHS.map((path) => <CheckCard key={path} compact label={MAGIC_PATH_LABELS[path]} checked={province.siteBias.includes(path)} onChange={(value) => update((item) => { item.siteBias = value ? [...new Set([...item.siteBias, path])] : item.siteBias.filter((entry) => entry !== path); })} />)}
      </div>
      <div className="info-card"><strong>Native terrain rendering</strong><p>The terrain mask is the source of truth. Dominions redraws winter, forests, flooding/submergence, farms, waste, kelp, and related changes itself.</p></div>
    </div>
  );
}

function GameplayInspector({ project, planeId, province, update, mutateProject }: { project: MapProject; planeId: string; province: Province; update: (recipe: (province: Province) => void) => void; mutateProject: (recipe: (project: MapProject) => void) => void }) {
  const specific = project.specificStarts.find((start) => start.planeId === planeId && start.provinceId === province.id);
  return (
    <div className="inspector-stack">
      <SectionHeading kicker="MULTIPLAYER" title="Starts & thrones" />
      <Toggle label="Generic player start" checked={province.start} onChange={(value) => update((item) => { item.start = value; if (value) { item.noStart = false; item.throne = "avoid"; } })} />
      <OptionalNumberField label="Team-start group (0–7)" value={province.teamStart} min={0} max={7} onChange={(value) => update((item) => { item.teamStart = value; })} />
      <div className="inline-fields">
        <Field label="Specific nation ID"><input type="number" min={0} value={specific?.nation ?? ""} placeholder="None" onChange={(event) => {
          const nation = optionalNumber(event.target.value);
          mutateProject((draft) => {
            draft.specificStarts = draft.specificStarts.filter((start) => !(start.planeId === planeId && start.provinceId === province.id));
            if (nation !== undefined) draft.specificStarts.push({ nation, planeId, provinceId: province.id });
          });
        }} /></Field>
      </div>
      <Field label="Throne treatment"><select value={province.throne} onChange={(event) => update((item) => { item.throne = event.target.value as Province["throne"]; if (item.throne !== "fixed") item.fixedThrone = undefined; })}>
        <option value="none">Neutral</option><option value="preferred">Preferred location</option><option value="avoid">Avoid location</option><option value="fixed">Fixed throne site (advanced)</option>
      </select></Field>
      {province.throne === "fixed" && <Field label="Vanilla throne site name or ID"><input value={province.fixedThrone ?? ""} onChange={(event) => update((item) => { item.fixedThrone = event.target.value; })} placeholder="e.g. The Throne of Gaia" /></Field>}
      {province.throne === "fixed" && <p className="warning-copy">Fixed thrones use a magic-site feature and can conflict with a unique site selected randomly. Preferred locations are the reliable multiplayer default.</p>}
      <Divider />
      <SectionHeading kicker="PROVINCE SETUP" title="Ownership & economy" />
      <div className="field-grid two">
        <OptionalNumberField label="Owner nation" value={province.owner} min={0} max={999} onChange={(value) => update((item) => { item.owner = value; })} />
        <OptionalNumberField label="Poptype" value={province.poptype} min={0} max={9999} onChange={(value) => update((item) => { item.poptype = value; })} />
        <OptionalNumberField label="Population" value={province.population} min={0} max={999999} onChange={(value) => update((item) => { item.population = value; })} />
        <OptionalNumberField label="Unrest" value={province.unrest} min={0} max={9999} onChange={(value) => update((item) => { item.unrest = value; })} />
        <OptionalNumberField label="Fort type" value={province.fort} min={0} max={999} onChange={(value) => update((item) => { item.fort = value; })} />
        <OptionalNumberField label="Owned PD level" value={province.provinceDefense} min={0} max={125} onChange={(value) => update((item) => { item.provinceDefense = value; })} />
      </div>
      <Toggle label="Temple" checked={province.temple} onChange={(value) => update((item) => { item.temple = value; })} />
      <Toggle label="Laboratory" checked={province.lab} onChange={(value) => update((item) => { item.lab = value; })} />
    </div>
  );
}

function SitesDefenseInspector({ province, update }: { province: Province; update: (recipe: (province: Province) => void) => void }) {
  return (
    <div className="inspector-stack">
      <SectionHeading kicker="MAGIC SITES" title="Placed sites" />
      <Toggle label="Remove randomly generated sites" checked={province.killRandomSites} onChange={(value) => update((item) => { item.killRandomSites = value; })} />
      <div className="site-list">
        {province.sites.map((site, index) => (
          <div className="site-row" key={site.id}>
            <input value={site.value} placeholder="Site name or numeric ID" onChange={(event) => update((item) => { item.sites[index]!.value = event.target.value; })} />
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
          <Field label="Commander name or ID"><input value={defense.commander} onChange={(event) => update((item) => { item.defenders[defenseIndex]!.commander = event.target.value; })} /></Field>
          <Field label="Commander display name"><input value={defense.commanderName ?? ""} onChange={(event) => update((item) => { item.defenders[defenseIndex]!.commanderName = event.target.value || undefined; })} /></Field>
          {defense.squads.map((squad, squadIndex) => (
            <div className="squad-row" key={squad.id}>
              <input type="number" min={1} value={squad.count} aria-label="Squad count" onChange={(event) => update((item) => { item.defenders[defenseIndex]!.squads[squadIndex]!.count = numberValue(event.target.value, 1); })} />
              <input value={squad.unit} aria-label="Unit name or ID" placeholder="Unit name or ID" onChange={(event) => update((item) => { item.defenders[defenseIndex]!.squads[squadIndex]!.unit = event.target.value; })} />
              <button type="button" onClick={() => update((item) => { item.defenders[defenseIndex]!.squads.splice(squadIndex, 1); })} aria-label="Remove squad">×</button>
            </div>
          ))}
          <button className="text-button" type="button" onClick={() => update((item) => { item.defenders[defenseIndex]!.squads.push({ id: `squad-${Date.now().toString(36)}`, unit: "", count: 10 }); })}>+ Add squad</button>
          <details>
            <summary>Commander details</summary>
            <div className="details-body">
              <div className="field-grid two">
                <OptionalNumberField label="Experience" value={defense.experience} min={0} max={999} onChange={(value) => update((item) => { item.defenders[defenseIndex]!.experience = value; })} />
                <OptionalNumberField label="Random items" value={defense.randomEquipment} min={0} max={4} onChange={(value) => update((item) => { item.defenders[defenseIndex]!.randomEquipment = value; })} />
              </div>
              <Field label="Specific items (one per line)"><textarea rows={3} value={(defense.items ?? []).join("\n")} onChange={(event) => update((item) => { item.defenders[defenseIndex]!.items = lines(event.target.value); })} /></Field>
              <div className="magic-level-grid">{MAGIC_PATHS.map((path) => <OptionalNumberField key={path} label={MAGIC_PATH_LABELS[path]} value={defense.magic?.[path]} min={0} max={10} onChange={(value) => update((item) => { const group = item.defenders[defenseIndex]!; group.magic ??= {}; if (value === undefined) delete group.magic[path]; else group.magic[path] = value; })} />)}</div>
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
        return <div className="edge-row" key={edge.id}><span>{other?.index}. {other?.name}</span><select value={edge.kind} onChange={(event) => mutateProject((draft) => { const target = draft.planes.find((item) => item.id === planeId)!.edges.find((item) => item.id === edge.id)!; target.kind = event.target.value as EdgeKind; })}>{EDGE_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select><button type="button" onClick={() => mutateProject((draft) => { const draftPlane = draft.planes.find((item) => item.id === planeId)!; draftPlane.edges = draftPlane.edges.filter((item) => item.id !== edge.id); })}>×</button></div>;
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
function OptionalNumberField({ label, value, min, max, onChange }: { label: string; value?: number; min: number; max: number; onChange: (value?: number) => void }) { return <Field label={label}><input type="number" value={value ?? ""} min={min} max={max} placeholder="Auto" onChange={(event) => onChange(optionalNumber(event.target.value))} /></Field>; }
function RangeField({ label, value, suffix, min, max, onChange }: { label: string; value: number; suffix: string; min: number; max: number; onChange: (value: number) => void }) { return <label className="range-field"><span>{label}<strong>{value}{suffix}</strong></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(numberValue(event.target.value, min))} /></label>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>; }
function CheckCard({ label, checked, onChange, compact = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; compact?: boolean }) { return <label className={`check-card ${compact ? "compact" : ""} ${checked ? "checked" : ""}`}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i>{checked ? "✓" : ""}</i><span>{label}</span></label>; }
function CsvField({ label, values, onChange }: { label: string; values: number[]; onChange: (values: number[]) => void }) { return <Field label={label}><input value={values.join(", ")} placeholder="Leave empty for unrestricted" onChange={(event) => onChange(event.target.value.split(/[ ,]+/).map(Number).filter((value) => Number.isInteger(value) && value >= 0))} /></Field>; }

function numberValue(value: string, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function optionalNumber(value: string): number | undefined { if (!value.trim()) return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function lines(value: string): string[] { return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
function parseComputerPlayers(value: string): MapProject["computerPlayers"] { return value.split(/[,\s]+/).map((entry) => entry.split(":").map(Number)).filter(([nation, difficulty]) => Number.isInteger(nation) && Number.isInteger(difficulty) && nation! >= 0 && difficulty! >= 1 && difficulty! <= 5).map(([nation, difficulty]) => ({ nation: nation!, difficulty: difficulty! as 1 | 2 | 3 | 4 | 5 })); }
function randomSeed(): string { return `realm-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}`; }
function formatBytes(bytes: number): string { if (bytes < 1_000_000) return `${Math.ceil(bytes / 1000)} KB`; return `${(bytes / 1_000_000).toFixed(bytes > 100_000_000 ? 0 : 1)} MB`; }
function scoreClass(score: number): string { return score >= 85 ? "excellent" : score >= 70 ? "fair" : "poor"; }
function downloadBrowserBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1500); }
