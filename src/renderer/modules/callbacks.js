/**
 * callbacks.js
 * Shared callback registry for app-level functions that cannot be imported
 * directly (because app.js is the entry point and modules cannot import from it).
 *
 * app.js populates these in finishInit() after all modules have loaded.
 * Modules import this object and call the registered callbacks.
 */
export const callbacks = {
  /** localStorage + cloud save — set by app.js */
  saveState: () => {},

  /** Non-blocking Spotify metadata enrichment for queued tracks — set by app.js */
  maybeEnrichTrackMeta: (_track) => {},

  /** Switch the main view — set by app.js */
  switchView: (_view) => {},

  /** Dev-mode: force-reload metadata + thumbnail for a track — set by app.js */
  forceReloadTrack: (_track) => {},

  /** Build client favorites submenu HTML for a track — set by app.js */
  buildClientsFavSection: (_track) => '',

  /** Handle toggle-client context menu action — set by app.js */
  handleToggleClient: (_clientId, _track) => {},

  /** Re-check client injections after track changes — set by app.js */
  recheckInjections: () => {},
};
