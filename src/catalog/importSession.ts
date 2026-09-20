import { BUILTIN_DOM6_CATALOG, mergeCatalogBundles, type Dom6CatalogBundle } from "./index";

/** Apply imports in selection order, never against a render's stale catalog. */
export function createCatalogImportSession() {
  let current: Dom6CatalogBundle | undefined;
  let epoch = 0;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    reset(value?: Dom6CatalogBundle) {
      epoch += 1;
      current = value;
      queue = Promise.resolve();
    },
    import(read: () => Promise<Dom6CatalogBundle>, persistAndApply: (catalog: Dom6CatalogBundle) => void) {
      const requestEpoch = epoch;
      const operation = queue.catch(() => undefined).then(async () => {
        if (requestEpoch !== epoch) return undefined;
        let imported: Dom6CatalogBundle;
        try { imported = await read(); } catch (error) {
          if (requestEpoch !== epoch) return undefined;
          throw error;
        }
        if (requestEpoch !== epoch) return undefined;
        const merged = current ? mergeCatalogBundles(current, imported) : imported;
        mergeCatalogBundles(BUILTIN_DOM6_CATALOG, merged);
        // This callback must persist before changing visible state. On failure,
        // neither the session's merge base nor the active catalog advances.
        persistAndApply(merged);
        current = merged;
        return imported;
      });
      queue = operation;
      return operation;
    },
  };
}
