"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { findCatalogEntry, formatCatalogEntry, searchCatalog, type CatalogEntry } from "./index";

interface CatalogComboboxProps {
  label: string;
  value?: string | number;
  entries: CatalogEntry[];
  onCommit: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  compact?: boolean;
  allowClear?: boolean;
  getEntryStatus?: (entry: CatalogEntry) => { label: string; compatible: boolean };
  isValueAllowed?: (value: string) => boolean;
  rejectedMessage?: string;
  /** ID-only fields must not silently convert an unresolved name to an empty value. */
  numericOnly?: boolean;
}

export function CatalogCombobox({
  label,
  value,
  entries,
  onCommit,
  placeholder = "Search name or numeric ID",
  emptyMessage = "No verified catalog entries are loaded. You can still enter a verified name or numeric ID.",
  compact = false,
  allowClear = true,
  getEntryStatus,
  isValueAllowed,
  rejectedMessage = "That value is not available in this field.",
  numericOnly = false,
}: CatalogComboboxProps) {
  const inputId = useId();
  const listboxId = `${inputId}-results`;
  const errorId = `${inputId}-error`;
  const statusId = `${inputId}-status`;
  const [query, setQuery] = useState(value === undefined ? "" : String(value));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string>();
  const focusRef = useRef(false);
  const selected = useMemo(() => findCatalogEntry(entries, value), [entries, value]);
  const results = useMemo(() => searchCatalog(entries, query, 12), [entries, query]);

  useEffect(() => {
    if (!focusRef.current) setQuery(value === undefined ? "" : String(value));
  }, [value]);

  const commit = (next: string) => {
    const raw = next.trim();
    const id = numericOnly && raw ? resolveCatalogNumericValue(entries, raw) : undefined;
    const normalized = numericOnly && id !== undefined ? String(id) : raw;
    const current = value === undefined ? "" : String(value).trim();
    if (normalized && ((numericOnly && id === undefined)
      || (normalized !== current && isValueAllowed && !isValueAllowed(normalized)))) {
      setQuery(value === undefined ? "" : String(value));
      setError(numericOnly && id === undefined
        ? "Choose a catalog result or enter a numeric ID. This name is unknown or matches more than one entry; the previous value was kept."
        : rejectedMessage);
      setOpen(false);
      setActiveIndex(0);
      return;
    }
    if (normalized !== current) onCommit(normalized);
    setQuery(normalized);
    setError(undefined);
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <div className={`catalog-combobox${compact ? " compact" : ""}`}>
      <label htmlFor={inputId}>{label}</label>
      <div className="catalog-input-wrap">
        <input
          id={inputId}
          type="search"
          maxLength={4096}
          value={query}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-describedby={[error ? errorId : undefined, open && entries.length > results.length ? statusId : undefined].filter(Boolean).join(" ") || undefined}
          aria-invalid={!!error}
          aria-activedescendant={open && results[activeIndex] ? `${listboxId}-${results[activeIndex]!.id}` : undefined}
          onFocus={() => {
            focusRef.current = true;
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setError(undefined);
            setOpen(true);
            setActiveIndex(0);
          }}
          onBlur={(event) => {
            focusRef.current = false;
            commit(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && results.length) {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => (index + 1) % results.length);
            } else if (event.key === "ArrowUp" && results.length) {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => (index - 1 + results.length) % results.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              const result = open ? results[activeIndex] : undefined;
              commit(result ? String(result.id) : query);
            } else if (event.key === "Escape") {
              setQuery(value === undefined ? "" : String(value));
              setOpen(false);
            }
          }}
        />
        {allowClear && query && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => commit("")} aria-label={`Clear ${label}`}>×</button>}
      </div>
      {error && <span id={errorId} className="catalog-field-error" role="alert">{error}</span>}
      {selected && <span className="catalog-selection" title={selected.sourceRef}>{formatCatalogEntry(selected)}</span>}
      {open && entries.length > results.length && (
        <p className="catalog-result-count" id={statusId} role="status">
          Searching all {entries.length.toLocaleString()} entries; showing up to 12 best matches. Type more of the name or a numeric ID to narrow the list.
        </p>
      )}
      {open && (
        // The list and its options are reached with the arrow keys through
        // aria-activedescendant. Both stay out of the Tab order because the list
        // closes when the input blurs: a tabbable option, or the scrollable list
        // itself (browsers make overflowing scrollers focusable), would vanish and
        // drop focus to the page body instead of reaching the next control.
        <div className="catalog-results" id={listboxId} role="listbox" tabIndex={-1} aria-label={`${label} catalog results`}>
          {results.map((entry, index) => (
            <button
              id={`${listboxId}-${entry.id}`}
              key={entry.id}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              className={`${index === activeIndex ? "active" : ""}${getEntryStatus && !getEntryStatus(entry).compatible ? " incompatible" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(String(entry.id))}
            >
              <span><strong>{entry.name}</strong><small>{catalogEntryDetails(entry, getEntryStatus?.(entry))}</small></span>
              <b>#{entry.id}</b>
            </button>
          ))}
          {!results.length && <div role="option" aria-disabled="true" aria-selected="false"><span>{numericOnly ? "No catalog matches. Enter a verified numeric ID or choose another name." : entries.length ? "No catalog matches. Press Enter to keep the raw value." : emptyMessage}</span></div>}
        </div>
      )}
    </div>
  );
}

export function resolveCatalogNumericValue(entries: readonly CatalogEntry[], value: string): number | undefined {
  const raw = value.trim();
  if (/^#?\d+$/.test(raw)) {
    const id = Number(raw.replace(/^#/, ""));
    return Number.isSafeInteger(id) ? id : undefined;
  }
  const query = raw.toLocaleLowerCase();
  const matches = entries.filter((entry) => [entry.name, ...(entry.aliases ?? [])]
    .some((name) => name.toLocaleLowerCase() === query));
  const ids = new Set(matches.map((entry) => entry.id));
  return ids.size === 1 ? ids.values().next().value : undefined;
}

function catalogEntryDetails(entry: CatalogEntry, status?: { label: string; compatible: boolean }): string {
  return [
    entry.subtitle,
    entry.magicPath,
    status?.label,
    entry.sourceRef ?? entry.provenanceId,
  ].filter(Boolean).join(" · ");
}
