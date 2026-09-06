import { cloneProject, type MapProject } from "./domain";
import { createDefaultProject } from "./generator";
import { regenerateGeneratedProvinceNames } from "./naming";
import { recordGenerationInputs } from "./workbench";

export function randomSeed(): string {
  const words = globalThis.crypto.getRandomValues(new Uint32Array(2));
  return `realm-${words[0]!.toString(36)}-${words[1]!.toString(36)}`;
}

/** Use only after hydration or a user action, never during server/client rendering. */
export function createFreshProject(): MapProject {
  return recordGenerationInputs(createDefaultProject(randomSeed()));
}

/** Opening is an editor action; parsing, autosave recovery, and Undo stay lossless. */
export function prepareProjectForOpening(project: MapProject, preserveNames = false): MapProject {
  if (preserveNames || project.settings.randomizeNamesOnLoad !== true
    || !project.planes.some(plane => plane.provinces.some(province => province.nameSource === "generated"))) {
    return project;
  }
  const next = cloneProject(project);
  const candidate = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!;
  next.settings.provinceNameSeed = candidate === (project.settings.provinceNameSeed ?? 0)
    ? (candidate + 1) >>> 0 : candidate;
  regenerateGeneratedProvinceNames(next.planes, next.seed, next.settings.provinceNameSeed);
  next.updatedAt = new Date().toISOString();
  return next;
}
