// ─── Playlist Download Manager ───
// Persistent offline downloads for playlists. Files stored in userData/playlist-downloads/.
// State persisted in localStorage('snowify_downloads').

window.PlaylistDownloadManager = function PlaylistDownloadManager(opts) {
  'use strict';

  const { getState, downloadTrack, cancelDownload, deleteDownload } = opts;

  // State: { [playlistId]: { status, tracks: { [videoId]: path }, total, downloaded, failed } }
  // status: 'idle' | 'downloading' | 'completed' | 'partial'
  let _state = {};
  let _queue = [];           // [{ playlistId, videoId, url }]
  let _isDownloading = false;
  let _currentItem = null;   // track being downloaded right now
  let _onProgress = null;    // (playlistId) => void
  let _onComplete = null;    // (playlistId, success) => void

  const DL_STATE_VERSION = 1;

  function _loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem('snowify_downloads') || '{}');
      if (raw._v === DL_STATE_VERSION) { _state = raw.data || {}; }
      else if (raw._v === undefined && Object.keys(raw).length) { _state = raw; _saveState(); }
      else { _state = {}; }
    } catch { _state = {}; }
  }

  function _saveState() {
    localStorage.setItem('snowify_downloads', JSON.stringify({ _v: DL_STATE_VERSION, data: _state }));
  }

  _loadState();

  // --- Public API ---

  async function downloadPlaylist(playlistId, tracks, userFolder, includeArtist) {
    const existing = _state[playlistId];
    _state[playlistId] = {
      status: 'downloading',
      tracks: existing?.tracks || {},
      total: tracks.length,
      downloaded: Object.keys(existing?.tracks || {}).length,
      failed: 0,
      userFolder: userFolder || '',
      includeArtist: !!includeArtist
    };
    _saveState();

    const newItems = tracks
      .filter(t => t && t.id && t.url && !_state[playlistId].tracks[t.id])
      .map(t => ({
        playlistId, videoId: t.id, url: t.url, thumbnail: t.thumbnail,
        title: t.title || t.name, artist: t.artist,
        trackNumber: tracks.indexOf(t) + 1
      }));

    _queue.push(...newItems);
    _processQueue();
  }

  async function cancel(playlistId) {
    _queue = _queue.filter(item => item.playlistId !== playlistId);
    if (_currentItem?.playlistId === playlistId) cancelDownload();
    const filePaths = Object.values(_state[playlistId]?.tracks || {});
    await deleteDownload(playlistId, filePaths);
    delete _state[playlistId];
    _saveState();
  }

  async function removeDownload(playlistId) {
    _queue = _queue.filter(item => item.playlistId !== playlistId);
    if (_currentItem?.playlistId === playlistId) cancelDownload();
    const filePaths = Object.values(_state[playlistId]?.tracks || {});
    await deleteDownload(playlistId, filePaths);
    delete _state[playlistId];
    _saveState();
  }

  function isDownloaded(playlistId) {
    const s = _state[playlistId];
    return s?.status === 'completed' || s?.status === 'partial';
  }

  function getStatus(playlistId) {
    return _state[playlistId] || null;
  }

  function getAllActive() {
    const result = [];
    for (const [plId, info] of Object.entries(_state)) {
      if (info.status === 'downloading') {
        result.push({ id: plId, downloaded: info.downloaded, failed: info.failed || 0, total: info.total, userFolder: info.userFolder || '' });
      }
    }
    return result;
  }

  function getTrackPath(videoId) {
    for (const [, info] of Object.entries(_state)) {
      if (info.status !== 'idle' && info.tracks[videoId]) {
        return info.tracks[videoId];
      }
    }
    return null;
  }

  function onProgress(cb) { _onProgress = cb; }
  function onComplete(cb) { _onComplete = cb; }

  // --- Internal ---

  async function _processQueue() {
    if (_isDownloading || !_queue.length) return;
    _isDownloading = true;

    while (_queue.length) {
      const item = _queue.shift();
      const { playlistId, videoId, url } = item;

      if (!_state[playlistId] || _state[playlistId].tracks[videoId]) continue;

      _currentItem = item;
      try {
        const appState = getState();
        const plState = _state[playlistId];
        const result = await downloadTrack(url, appState.audioQuality, videoId, playlistId, appState.downloadFormat, item.thumbnail, item.title, item.artist, plState?.userFolder, plState?.includeArtist, item.trackNumber);

        if (_state[playlistId]) {
          _state[playlistId].tracks[videoId] = result.path;
          _state[playlistId].downloaded = Object.keys(_state[playlistId].tracks).length;

          if (_state[playlistId].downloaded + _state[playlistId].failed >= _state[playlistId].total) {
            _state[playlistId].status = _state[playlistId].failed === 0 ? 'completed' : 'partial';
          }
          _saveState();
          if (_onProgress) _onProgress(playlistId);
        }
      } catch (err) {
        if (err !== 'cancelled') {
          console.warn('Playlist download failed:', videoId, err);
          if (_state[playlistId]) {
            _state[playlistId].failed = (_state[playlistId].failed || 0) + 1;
            if (_state[playlistId].downloaded + _state[playlistId].failed >= _state[playlistId].total) {
              _state[playlistId].status = 'partial';
            }
            _saveState();
            if (_onProgress) _onProgress(playlistId);
          }
        }
      }
      _currentItem = null;
    }

    _isDownloading = false;
    const activePlaylists = new Set(_queue.map(i => i.playlistId));
    for (const [plId, info] of Object.entries(_state)) {
      if (info.status === 'downloading' && !activePlaylists.has(plId)) {
        info.status = info.failed === 0 ? 'completed' : 'partial';
        _saveState();
        if (_onComplete) _onComplete(plId, info.status === 'completed');
      }
    }
  }

  async function validateTracks(playlistId, fileExists) {
    const info = _state[playlistId];
    if (!info || !info.tracks) return false;

    let changed = false;
    for (const [videoId, path] of Object.entries(info.tracks)) {
      const exists = await fileExists(path);
      if (!exists) {
        delete info.tracks[videoId];
        changed = true;
      }
    }
    if (!changed) return false;

    info.downloaded = Object.keys(info.tracks).length;
    if (info.downloaded === 0) {
      info.status = 'idle';
    } else if (info.status === 'completed') {
      info.status = 'partial';
    }
    _saveState();
    return true;
  }

  async function validateAllTracks(fileExists) {
    let anyChanged = false;
    for (const playlistId of Object.keys(_state)) {
      if (await validateTracks(playlistId, fileExists)) anyChanged = true;
    }
    return anyChanged;
  }

  return {
    downloadPlaylist, cancel, removeDownload,
    isDownloaded, getStatus, getAllActive, getTrackPath,
    onProgress, onComplete,
    validateTracks, validateAllTracks
  };
};
