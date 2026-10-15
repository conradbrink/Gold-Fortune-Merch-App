"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { NO_STORE_GROUP } from "@/lib/store-groups";
import { lower, type Terms } from "@/lib/terms";
import type { StoreGroupFilter } from "@/lib/use-store-group-filter";

/**
 * "Group: Every group / Choppies Group (102) / … / No group": the whole page,
 * tiles and all, for one group's stores, since one person may look after
 * Choppies. Shown once the company has a named group with a store on the list;
 * when a link asked for a group that could not be read, says so instead of
 * quietly showing every group's figures.
 */
export function StoreGroupPicker<T>({ filter, t }: { filter: StoreGroupFilter<T>; t: Terms }) {
  if (filter.failed) {
    return (
      <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
        The {lower(t.site_group.many)} could not be read, so these are the figures for every {lower(t.site_group.one)}.
      </p>
    );
  }
  if (!filter.choices.some((g) => g.id !== NO_STORE_GROUP)) return null;
  return (
    // Full width on a phone, also where it shares a row with the dates (Store health).
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <label htmlFor="store-group" className="text-sm text-muted-foreground">
        {t.site_group.one}
      </label>
      <div className="w-full sm:w-72">
        <NativeSelect id="store-group" value={filter.active} onChange={(e) => filter.choose(e.target.value)}>
          <option value="">Every {lower(t.site_group.one)}</option>
          {filter.choices.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.n})
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}
