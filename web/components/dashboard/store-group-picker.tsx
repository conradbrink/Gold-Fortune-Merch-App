"use client";

import { FilterChip } from "@/components/dashboard/detail-page";
import { NativeSelect } from "@/components/ui/native-select";
import { lower, type Terms } from "@/lib/terms";
import type { StoreGroupState } from "@/lib/use-store-group-filter";

const PICKER_ID = "store-group";

/**
 * "Group: Every group / Choppies Group (102) / … / No group": the whole page,
 * tiles and all, for one group's stores, since one person may look after
 * Choppies. Shown once the company has a named group to choose. When a link
 * asked for a group the page cannot show, says so rather than quietly showing
 * every group's figures; `ready` (the page's figures are on screen) keeps that
 * from appearing over a page that is loading or failed.
 */
export function StoreGroupPicker({ filter, t, ready }: { filter: StoreGroupState; t: Terms; ready: boolean }) {
  const group = lower(t.site_group.one);
  const note = !ready
    ? ""
    : filter.failed
      ? `The ${lower(t.site_group.many)} could not be read, so these are the figures for every ${group}.`
      : filter.missing
        ? `The ${group} in this link no longer exists, so these are the figures for every ${group}.`
        : "";
  return (
    <>
      {filter.choices.length > 0 && (
        // Full width on a phone, also where it shares a row with the dates (Store health).
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label htmlFor={PICKER_ID} className="text-sm text-muted-foreground">
            {t.site_group.one}
          </label>
          <div className="w-full sm:w-72">
            <NativeSelect id={PICKER_ID} value={filter.active} onChange={(e) => filter.choose(e.target.value)}>
              <option value="">Every {group}</option>
              {filter.choices.map((g) => (
                <option key={g.id} value={g.id}>
                  {filter.counted ? `${g.name} (${g.n})` : g.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      )}
      {/* Always in the page, empty until needed, so a screen reader announces it when it fills. */}
      <p role="status" className={note ? "text-sm text-amber-700 dark:text-amber-400" : "sr-only"}>
        {note}
        {note && filter.failed && (
          <>
            {" "}
            <button type="button" className="font-medium underline underline-offset-2" onClick={filter.retry}>
              Try again
            </button>
          </>
        )}
      </p>
    </>
  );
}

/** "Choppies Group only · every group" beside the search: takes the group off, and hands focus to the picker. */
export function StoreGroupChip({ filter }: { filter: StoreGroupState }) {
  if (!filter.chip) return null;
  return (
    <FilterChip
      onClear={() => {
        filter.choose("");
        // The chip goes; keep the keyboard where it was working, not back at the top of the page.
        document.getElementById(PICKER_ID)?.focus();
      }}
    >
      {filter.chip}
    </FilterChip>
  );
}
