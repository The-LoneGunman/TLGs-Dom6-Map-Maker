import { type Dom6CatalogBundle, BUILTIN_DOM6_CATALOG } from "./catalog";
import { type MapProject } from "./domain";
import { validateProject } from "./dom6";
import { type ExportArtwork, illustratedExportError } from "./illustratedArtworkPlan";
import { type ZipPackageSafety, zipPackageSafety } from "./packageEstimate";

interface InstallEnvironment {
  isSecureContext?: boolean;
  showDirectoryPicker?: unknown;
  navigator?: { locks?: { request?: unknown } };
}

/** Capability detection, not browser-name guessing; the installer checks again at click time. */
export function supportsDirectInstall(environment: InstallEnvironment = globalThis): boolean {
  return environment.isSecureContext !== false
    && typeof environment.showDirectoryPicker === "function"
    && typeof environment.navigator?.locks?.request === "function";
}

export function unsupportedInstallMessage(safety: ZipPackageSafety, artwork: ExportArtwork = "native"): string {
  return safety.level === "blocked"
    ? `Direct folder access is unavailable in this browser, and this ZIP is too large. Reduce output resolution below, ${artwork === "illustrated" ? "choose Native scenery, or " : "or "}save Editable project JSON and reopen it in a browser with folder access.`
    : "Direct folder access is unavailable in this browser. Download the ready ZIP, or save Editable project JSON to move the atlas to a browser with folder access.";
}

/**
 * Offer only a verified smaller raster, never an automatic geography rebuild.
 * Scaling each existing plane preserves mixed sizes and portrait aspect ratios.
 * No shared project object is mutated; the editor commits the explicit choice
 * as one Undo step. Existing export errors and layout locks cannot be bypassed.
 */
export function smallerZipProject(project: MapProject, catalog: Dom6CatalogBundle = BUILTIN_DOM6_CATALOG,
  artwork: ExportArtwork = "native"): MapProject | undefined {
  if (project.authoring?.lockLayout || zipPackageSafety(project, catalog, artwork).level !== "blocked"
    || (artwork === "illustrated" && illustratedExportError(project))) return undefined;
  for (const scale of [.875, .75, .625, .5, .375, .25, .1875, .125, .0625]) {
    const next: MapProject = {
      ...project,
      settings: { ...project.settings, resolution: "custom" },
      planes: project.planes.map(plane => {
        const factor = Math.min(1, Math.max(scale, 256 / plane.width, 256 / plane.height));
        return {
          ...plane,
          width: Math.min(plane.width, Math.max(256, Math.floor(plane.width * factor))),
          height: Math.min(plane.height, Math.max(256, Math.floor(plane.height * factor))),
        };
      }),
    };
    if (zipPackageSafety(next, catalog, artwork).level === "blocked") continue;
    if (!validateProject(next, catalog).some(issue => issue.severity === "error")) return next;
  }
  return undefined;
}
