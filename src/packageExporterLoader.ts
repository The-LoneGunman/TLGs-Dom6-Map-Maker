type PackageExporter = typeof import("./export");

let pending: Promise<PackageExporter> | undefined;

/**
 * The package exporter (ZIP assembly, direct install, illustrated artwork and
 * host reports) is only needed once a package is built, so the editor loads
 * it on first use instead of with the main bundle. A failed load is not
 * cached; the next attempt retries.
 */
export function loadPackageExporter(): Promise<PackageExporter> {
  pending ??= import("./export").catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}

/** Warm the exporter while the export dialog is open; errors surface on use. */
export function prefetchPackageExporter(): void {
  loadPackageExporter().catch(() => undefined);
}
