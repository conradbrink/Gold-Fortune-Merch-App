/**
 * Light / dark / system, as one contract.
 *
 * The dark palette has existed in `globals.css` since the app was scaffolded and
 * 147 `dark:` utilities are written against it — but nothing ever added the
 * class, so none of it could be reached. This is the switch.
 *
 * Tailwind is configured class-first here:
 *
 *     @custom-variant dark (&:is(.dark *));
 *
 * so the whole mechanism is "is there a `dark` class on `<html>`". Deliberately
 * *not* the `data-theme` attribute the Next guide uses in its example — that
 * would mean rewriting the variant and every rule under `.dark`, to no end.
 *
 * The storage key, the resolution rule and the pre-paint script all live in this
 * one file on purpose. They have to agree exactly: the script decides what the
 * user sees before React exists, and `useState`'s lazy initialiser decides what
 * React believes. If those two ever disagreed, the toggle would open showing the
 * wrong mode — the class of bug that is invisible until someone has a preference
 * saved.
 */

export type ThemeMode = "light" | "dark" | "system";

/** Namespaced: `localStorage` is shared with anything else on the origin. */
export const THEME_STORAGE_KEY = "gf-theme";

export const THEME_MODES: readonly ThemeMode[] = ["light", "dark", "system"];

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * The default when nothing has been chosen.
 *
 * Following the operating system is what a theme control is assumed to do, and
 * it means a manager whose phone is already dark is not handed a white screen at
 * six in the morning. Change this one value to make the app default to light.
 */
export const DEFAULT_THEME_MODE: ThemeMode = "system";

/** Whatever was chosen last, or the default. Safe to call on the server. */
export function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return DEFAULT_THEME_MODE;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : DEFAULT_THEME_MODE;
  } catch {
    // Safari in private mode throws on access, not just on write.
    return DEFAULT_THEME_MODE;
  }
}

export function storeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // A preference that cannot be saved is still worth applying for this visit.
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/** What "system" actually resolves to right now. */
export function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

/** The single place the class is added or removed. */
export function applyMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveMode(mode) === "dark");
}

/**
 * Fired on this page when the mode is changed here.
 *
 * `storage` only reaches *other* tabs, so without this the component that made
 * the change would be the one place that never hears about it.
 */
const THEME_CHANGE_EVENT = "gf-theme-change";

/* ------------------------------------------------------------------ *
 * The external store
 *
 * The mode lives in localStorage and the OS preference lives in matchMedia —
 * both outside React, both mutable, and neither readable while rendering on the
 * server. That is exactly what `useSyncExternalStore` is for, and using it
 * instead of a mount effect buys the thing that is easy to get wrong: React
 * renders `getServerSnapshot` on the server *and* through hydration, then
 * switches to `getSnapshot`. The first client render therefore matches the
 * server's HTML by construction rather than by remembering to gate every
 * derived attribute on a `mounted` flag.
 * ------------------------------------------------------------------ */

/**
 * `"<mode>|<resolved>"`.
 *
 * One string rather than an object because `useSyncExternalStore` compares
 * snapshots by identity — a fresh object every call is an infinite render loop.
 * The resolved half is part of the snapshot because resolving "system" means
 * reading matchMedia, which is another thing the server cannot do.
 */
export type ThemeSnapshot = `${ThemeMode}|light` | `${ThemeMode}|dark`;

export function getThemeSnapshot(): ThemeSnapshot {
  const mode = readStoredMode();
  return `${mode}|${resolveMode(mode)}` as ThemeSnapshot;
}

export function getServerThemeSnapshot(): ThemeSnapshot {
  return `${DEFAULT_THEME_MODE}|light` as ThemeSnapshot;
}

export function parseThemeSnapshot(snapshot: ThemeSnapshot): {
  mode: ThemeMode;
  resolved: "light" | "dark";
} {
  const [mode, resolved] = snapshot.split("|") as [ThemeMode, "light" | "dark"];
  return { mode, resolved };
}

/** Every source that can change the answer, in one subscription. */
export function subscribeToTheme(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const query = window.matchMedia ? window.matchMedia(DARK_QUERY) : null;
  // The OS flipping at sunset has to move the app when the mode is "system".
  query?.addEventListener("change", listener);
  // Another tab on the same estate changing the preference.
  window.addEventListener("storage", listener);
  // This tab changing it.
  window.addEventListener(THEME_CHANGE_EVENT, listener);

  return () => {
    query?.removeEventListener("change", listener);
    window.removeEventListener("storage", listener);
    window.removeEventListener(THEME_CHANGE_EVENT, listener);
  };
}

/** Saves the choice, applies it, and tells the store — the only way to set it. */
export function setMode(mode: ThemeMode): void {
  storeMode(mode);
  applyMode(mode);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/**
 * Keeps the `dark` class in step with a snapshot React has already rendered.
 *
 * Needed for the two changes that do not go through `setMode`: the OS flipping
 * while on "system", and another tab writing a new preference.
 */
export function syncClassToSnapshot(snapshot: ThemeSnapshot): void {
  if (typeof document === "undefined") return;
  const { resolved } = parseThemeSnapshot(snapshot);
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

/**
 * Runs synchronously in `<head>`, before the browser paints anything.
 *
 * This is the whole reason there is no flash of the wrong theme. `useEffect`
 * runs after paint, and even `useLayoutEffect` runs after hydration — on a slow
 * connection the browser paints the server's HTML long before React loads. An
 * inline script runs during HTML *parsing*, ahead of all of it. The approach is
 * the one in `next/dist/docs/01-app/02-guides/preventing-flash-before-hydration`.
 *
 * Built from the constants above rather than written out, so it cannot drift
 * from `resolveMode`. Kept to ES5 and wrapped in try/catch: it runs before any
 * bundle, on whatever browser the user has, and a throw here would abort the
 * rest of the parse.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});if(m!=="light"&&m!=="dark"&&m!=="system")m=${JSON.stringify(
  DEFAULT_THEME_MODE
)};var d=m==="dark"||(m==="system"&&window.matchMedia&&window.matchMedia(${JSON.stringify(
  DARK_QUERY
)}).matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
