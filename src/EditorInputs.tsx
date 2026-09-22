"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_IMPORTED_STRING_LENGTH } from "./export";

/** Keep incomplete keystrokes local until they describe a valid number. */
export function BoundedNumberInput({ value, min, max, describedBy, id, onChange, onEditStart, onEditEnd }: {
  value: number; min: number; max: number; describedBy?: string; id?: string; onChange: (value: number) => boolean | void;
  /** Called on focus and after the final blur commit, bracketing one typing session. */
  onEditStart?: () => void; onEditEnd?: () => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);
  return <input id={id} type="number" value={draft} min={min} max={max} aria-describedby={describedBy}
    onFocus={() => { focused.current = true; onEditStart?.(); }}
    onChange={(event) => {
      const text = event.target.value;
      setDraft(text);
      const next = Number(text);
      if (text.trim() && Number.isInteger(next) && next >= min && next <= max && next !== value
        && onChange(next) === false) setDraft(String(value));
    }}
    onBlur={(event) => {
      focused.current = false;
      const text = event.currentTarget.value;
      const parsed = text.trim() ? Number(text) : value;
      const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : value;
      // Reconcile to the accepted model, even when it did not change (locks or
      // validation can reject edits). An accepted commit updates value below.
      setDraft(String(value));
      if (next !== value) onChange(next);
      onEditEnd?.();
    }} />;
}

/** Preserve the visible line being typed while storing normalized item names. */
export function ItemListInput({ value = [], onChange }: { value?: string[]; onChange: (value: string[]) => void }) {
  const [draft, setDraft] = useState(value.join("\n"));
  const [error, setError] = useState<string>();
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value.join("\n")); }, [value]);
  return <><textarea rows={3} value={draft} maxLength={64 * (MAX_IMPORTED_STRING_LENGTH + 1)} aria-invalid={!!error}
    onFocus={() => { focused.current = true; }}
    onChange={(event) => {
      const text = event.target.value;
      setDraft(text);
      const items = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (items.length > 64 || items.some((item) => item.length > MAX_IMPORTED_STRING_LENGTH)) {
        setError("Use at most 64 items, with at most 4096 characters per item. The previous item list is still saved.");
        return;
      }
      setError(undefined);
      if (items.length !== value.length || items.some((item, index) => item !== value[index])) onChange(items);
    }}
    onBlur={() => {
      focused.current = false;
      if (!error) setDraft(value.join("\n"));
    }} />{error && <span role="alert">{error}</span>}</>;
}
