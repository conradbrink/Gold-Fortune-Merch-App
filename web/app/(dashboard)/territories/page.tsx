"use client";

import { TerritoriesPanel } from "@/components/settings/territories-panel";

/**
 * Territories, promoted out of Company Profile.
 *
 * It started as a settings tab because it is configuration, but it is read far
 * more often than the rest of that page — the estate is planned in terms of it
 * — and being three clicks deep made it feel optional. The panel is unchanged
 * and still renders in the settings tab as well, so nobody's bookmark breaks.
 */
export default function TerritoriesPage() {
  return <TerritoriesPanel />;
}
