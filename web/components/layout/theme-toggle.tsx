"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getServerThemeSnapshot,
  getThemeSnapshot,
  parseThemeSnapshot,
  setMode,
  subscribeToTheme,
  syncClassToSnapshot,
  type ThemeMode,
} from "@/lib/theme";

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
  { mode: "system", label: "System", Icon: Monitor },
];

/**
 * Light / dark / system.
 *
 * Three options rather than a two-way switch: with a plain toggle there is no
 * way back to following the operating system once you have touched it, and
 * "system" is the default, so the control could not express the state it starts
 * in.
 *
 * The page is already in the right theme before this mounts — the inline script
 * in the root layout set the class during HTML parsing. This component only has
 * to agree with it, which is why every value it renders comes from the same
 * helpers that script is generated from.
 */
export function ThemeToggle() {
  const snapshot = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot
  );
  const { mode, resolved } = parseThemeSnapshot(snapshot);

  /**
   * Covers the two changes that do not originate here — the OS flipping while
   * on "system", and another tab writing a preference. Both re-render this
   * component through the store, but neither touches the class on `<html>`.
   *
   * In an effect rather than during render: React may render a component and
   * discard it without committing, and a DOM mutation during render would then
   * have happened for a render that never existed. Running after paint is right
   * for these two cases anyway — both are rare, and the common case (choosing
   * from the menu) has already applied the class synchronously in `setMode`, so
   * nothing here is ever seen lagging.
   */
  useEffect(() => syncClassToSnapshot(snapshot), [snapshot]);

  const current = OPTIONS.find((o) => o.mode === mode) ?? OPTIONS[2];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          // No `nativeButton={false}` here, unlike the Settings control beside
          // it: that one renders a <Link>, this renders a real <button>, and
          // Base UI rejects the combination.
          <Button
            variant="ghost"
            size="icon"
            title={`Appearance — ${current.label.toLowerCase()}`}
            aria-label={`Appearance: ${current.label.toLowerCase()}. Change theme.`}
          >
            {/* The icon shows what you are looking at, not which mode is set:
                on "system" the useful fact is that it is currently dark, and the
                menu below is where the mode itself is named and ticked. */}
            {resolved === "dark" ? (
              <Moon className="h-5 w-5" />
            ) : (
              <Sun className="h-5 w-5" />
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {OPTIONS.map(({ mode: value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setMode(value)}
            className="gap-2"
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1">{label}</span>
            {/* Reserved whether ticked or not, so the labels do not shift as the
                selection moves down the list. */}
            <Check
              className={[
                "h-4 w-4",
                mode === value ? "opacity-100" : "opacity-0",
              ].join(" ")}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
