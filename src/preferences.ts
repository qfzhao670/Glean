export type PreferenceKey =
  | 'glean-theme'
  | 'glean-companion-theme'
  | `glean-companion-background-${string}`;

const sessionPreferences: Record<string, string> = { ...(window.glean?.preferences || {}) };

export function getPreference(key: PreferenceKey): string | null {
  return sessionPreferences[key] ?? localStorage.getItem(key);
}

export function setPreference(key: PreferenceKey, value: string) {
  // Keep the browser build useful while the Electron copy is stored outside
  // the changing localhost origin used by the desktop backend.
  sessionPreferences[key] = value;
  localStorage.setItem(key, value);
  window.glean?.setPreference(key, value);
}
