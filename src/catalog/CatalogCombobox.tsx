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
}: CatalogComboboxProps) {
  const inputId = useId();
  const listboxId = `${inputId}-results`;
  const [query, setQuery] = useState(value === undefined ? "" : String(value));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const focusRef = useRef(false);
  const selected = useMemo(() => findCatalogEntry(entries, value), [entries, value]);
  const results = useMemo(() => searchCatalog(entries, query, 8), [entries, query]);

  useEffect(() => {
    if (!focusRef.current) setQuery(value === undefined ? "" : String(value));
  }, [value]);

  const commit = (next: string) => {
    const normalized = next.trim();
    onCommit(normalized);
    setQuery(normalized);
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
          value={query}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && results[activeIndex] ? `${listboxId}-${results[activeIndex]!.id}` : undefined}
          onFocus={() => {
            focusRef.current = true;
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onBlur={() => {
            focusRef.current = false;
            commit(query);
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
      {selected && <span className="catalog-selection" title={selected.sourceRef}>{formatCatalogEntry(selected)}</span>}
      {open && (
        <div className="catalog-results" id={listboxId} role="listbox" aria-label={`${label} catalog results`}>
          {results.map((entry, index) => (
            <button
              id={`${listboxId}-${entry.id}`}
              key={entry.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`${index === activeIndex ? "active" : ""}${getEntryStatus && !getEntryStatus(entry).compatible ? " incompatible" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(String(entry.id))}
            >
              <span><strong>{entry.name}</strong><small>{catalogEntryDetails(entry, getEntryStatus?.(entry))}</small></span>
              <b>#{entry.id}</b>
            </button>
          ))}
          {!results.length && <p>{entries.length ? "No catalog matches. Press Enter to keep the raw value." : emptyMessage}</p>}
        </div>
      )}
    </div>
  );
}

function catalogEntryDetails(entry: CatalogEntry, status?: { label: string; compatible: boolean }): string {
  return [
    entry.subtitle,
    entry.magicPath,
    status?.label,
    entry.sourceRef ?? entry.provenanceId,
  ].filter(Boolean).join(" · ");
}
