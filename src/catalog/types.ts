export const DOM6_CATALOG_SCHEMA = "pantokrator-atlas/dom6-catalog" as const;
export const DOM6_CATALOG_SCHEMA_VERSION = 1 as const;

export type CatalogAuthority = "official" | "community" | "user";

export interface CatalogProvenance {
  id: string;
  title: string;
  authority: CatalogAuthority;
  version?: string;
  source?: string;
  notes?: string;
}

export interface CatalogEntry {
  id: number;
  name: string;
  subtitle?: string;
  aliases?: string[];
  tags?: string[];
  terrainMask?: number;
  magicPath?: string;
  era?: number;
  abbreviation?: string;
  provenanceId: string;
  sourceRef?: string;
}

export interface Dom6CatalogBundle {
  schema: typeof DOM6_CATALOG_SCHEMA;
  schemaVersion: typeof DOM6_CATALOG_SCHEMA_VERSION;
  gameVersion: string;
  catalogVersion: string;
  provenance: CatalogProvenance[];
  poptypes: CatalogEntry[];
  sites: CatalogEntry[];
  units: CatalogEntry[];
  nations: CatalogEntry[];
  forts: CatalogEntry[];
  planes: CatalogEntry[];
  siteTerrainTypes: CatalogEntry[];
}

export type CatalogCollection =
  | "poptypes"
  | "sites"
  | "units"
  | "nations"
  | "forts"
  | "planes"
  | "siteTerrainTypes";
