"use client";

import { useState } from "react";
import { Check, Globe, Store, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AUDIENCE_LABELS, type Audience, type FileRow } from "@/lib/files";
import type { RepSummary } from "@/lib/representatives";

/**
 * Who a file is for, editable in place.
 *
 * Follows the Stores page pattern where the badge showing the state is also the
 * control that changes it. Picking "Everyone" applies immediately; the other
 * two open a tick-list, because they need to know *which* reps or chains.
 */
export function AudienceControl({
  file,
  reps,
  groups,
  disabled,
  onChange,
}: {
  file: FileRow;
  reps: RepSummary[];
  groups: { id: string; name: string }[];
  disabled?: boolean;
  onChange: (audience: Audience, repIds: string[], groupIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const summary =
    file.audience === "everyone"
      ? "Everyone"
      : file.audience === "reps"
        ? file.rep_ids.length === 0
          ? "No one yet"
          : reps
              .filter((r) => file.rep_ids.includes(r.rep_id))
              .map((r) => r.rep_name ?? "Unnamed")
              .join(", ")
        : file.group_ids.length === 0
          ? "No chain yet"
          : groups
              .filter((g) => file.group_ids.includes(g.id))
              .map((g) => g.name)
              .join(", ");

  // An audience nobody satisfies is the one failure worth shouting about: the
  // file looks shared and reaches no one.
  const empty =
    (file.audience === "reps" && file.rep_ids.length === 0) ||
    (file.audience === "groups" && file.group_ids.length === 0);

  const Icon =
    file.audience === "everyone" ? Globe : file.audience === "reps" ? Users : Store;

  function toggleRep(repId: string) {
    const next = file.rep_ids.includes(repId)
      ? file.rep_ids.filter((r) => r !== repId)
      : [...file.rep_ids, repId];
    onChange("reps", next, []);
  }

  function toggleGroup(groupId: string) {
    const next = file.group_ids.includes(groupId)
      ? file.group_ids.filter((g) => g !== groupId)
      : [...file.group_ids, groupId];
    onChange("groups", [], next);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className="max-w-[240px] text-left disabled:opacity-50"
          >
            <Badge
              variant={empty ? "destructive" : "secondary"}
              className="gap-1.5 font-normal"
            >
              <Icon className="h-3 w-3 shrink-0" />
              <span className="truncate">{summary}</span>
            </Badge>
          </button>
        }
      />
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuItem
          className="gap-2"
          onClick={() => onChange("everyone", [], [])}
        >
          <Check
            className={`h-3.5 w-3.5 ${file.audience === "everyone" ? "opacity-100" : "opacity-0"}`}
          />
          <Globe className="h-3.5 w-3.5" />
          {AUDIENCE_LABELS.everyone}
        </DropdownMenuItem>

        <p className="px-2 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {AUDIENCE_LABELS.reps}
        </p>
        {reps.length === 0 && (
          <DropdownMenuItem disabled>No active reps</DropdownMenuItem>
        )}
        {reps.map((r) => (
          <DropdownMenuItem
            key={r.rep_id}
            className="gap-2"
            // Keeps the menu open so several reps can be ticked in one go.
            onSelect={(e) => e.preventDefault()}
            onClick={() => toggleRep(r.rep_id)}
          >
            <Check
              className={`h-3.5 w-3.5 ${
                file.audience === "reps" && file.rep_ids.includes(r.rep_id)
                  ? "opacity-100"
                  : "opacity-0"
              }`}
            />
            {r.rep_name ?? "Unnamed"}
          </DropdownMenuItem>
        ))}

        <p className="px-2 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {AUDIENCE_LABELS.groups}
        </p>
        {groups.length === 0 && (
          <DropdownMenuItem disabled>No chains yet</DropdownMenuItem>
        )}
        {groups.map((g) => (
          <DropdownMenuItem
            key={g.id}
            className="gap-2"
            onSelect={(e) => e.preventDefault()}
            onClick={() => toggleGroup(g.id)}
          >
            <Check
              className={`h-3.5 w-3.5 ${
                file.audience === "groups" && file.group_ids.includes(g.id)
                  ? "opacity-100"
                  : "opacity-0"
              }`}
            />
            {g.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
