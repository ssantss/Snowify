window.DownloadUI = function DownloadUI(opts) {
  'use strict';
  const { playlistDl, showToast, I18n, $, renderLibrary, getDownloadFolder, fileExists } = opts;

  const DL_ARROW_SVG = '<svg width="16" height="16" viewBox="2 2 20 16" fill="currentColor"><path d="M12 18l-8-8h5V2h6v8h5l-8 8z"/></svg>';
  const DL_RING_CIRCUMFERENCE = 2 * Math.PI * 12; // r=12 → ~75.4
  let _dlBusy = false; // debounce guard for download button
  const _dlNames = {};  // { playlistId → displayName }
  let _popoverOpen = false;

  function syncDownloadButton(btn, status) {
    const ring = btn.querySelector('.dl-ring-fill');
    btn.classList.remove('downloaded', 'downloading', 'dl-loading');
    ring.style.strokeDashoffset = DL_RING_CIRCUMFERENCE;
    btn.title = I18n.t('playlist.download');
    btn.setAttribute('aria-label', I18n.t('playlist.download'));
    btn.removeAttribute('aria-busy');

    if (!status || status.status === 'idle') return;

    if (status.status === 'downloading') {
      btn.classList.add('downloading');
      if (status.downloaded === 0) btn.classList.add('dl-loading');
      const processed = status.downloaded + (status.failed || 0);
      const progress = status.total > 0 ? processed / status.total : 0;
      ring.style.strokeDashoffset = DL_RING_CIRCUMFERENCE * (1 - progress);
      btn.title = `${status.downloaded}/${status.total}`;
      btn.setAttribute('aria-label', `Downloading ${status.downloaded}/${status.total}`);
      btn.setAttribute('aria-busy', 'true');
    } else if (status.status === 'completed' || status.status === 'partial') {
      btn.classList.add('downloaded');
      btn.title = I18n.t('playlist.removeDownload');
      btn.setAttribute('aria-label', I18n.t('playlist.removeDownload'));
    }
  }

  function updateDownloadButton(activePlaylistId) {
    for (const sel of ['#btn-download-playlist', '#btn-album-download']) {
      const btn = $(sel);
      if (btn && btn.dataset.playlistId === activePlaylistId) {
        syncDownloadButton(btn, playlistDl.getStatus(activePlaylistId));
        const container = btn.closest('.view')?.querySelector('.track-list');
        if (container) updateTrackDownloadIcons(activePlaylistId, container);
      }
    }
  }

  function updateTrackDownloadIcons(playlistId, container) {
    if (!container) return;

    container.querySelectorAll('.track-row').forEach(row => {
      const trackId = row.dataset.trackId;
      if (!trackId) return;
      const existing = row.querySelector('.track-dl-icon');
      const isDownloaded = playlistDl.getTrackPath(trackId);
      if (isDownloaded && !existing) {
        const icon = createDlIcon(isDownloaded, true);
        const likeCol = row.querySelector('.track-like-col');
        const likeBtn = likeCol?.querySelector('.track-like-btn');
        if (likeCol && likeBtn) likeCol.insertBefore(icon, likeBtn);
        else if (likeCol) likeCol.appendChild(icon);
      } else if (!isDownloaded && existing) {
        existing.remove();
      }
    });
  }

  function createDlIcon(filePath, animate) {
    const icon = document.createElement('span');
    icon.className = 'track-dl-icon' + (animate ? ' dl-pop' : '');
    icon.title = I18n.t('context.showInFolder');
    icon.innerHTML = DL_ARROW_SVG;
    icon.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (fileExists && !(await fileExists(filePath))) {
        icon.remove();
        await playlistDl.validateAllTracks(fileExists);
        showToast(I18n.t('toast.fileNotFound'));
        return;
      }
      window.snowify.showInFolder(filePath);
    });
    if (animate) {
      icon.addEventListener('animationend', () => icon.classList.remove('dl-pop'), { once: true });
    }
    return icon;
  }

  function bindDlIcons(container) {
    container.querySelectorAll('.track-dl-icon').forEach(icon => {
      const row = icon.closest('.track-row');
      if (!row) return;
      const filePath = playlistDl.getTrackPath(row.dataset.trackId);
      if (!filePath) return;
      icon.title = I18n.t('context.showInFolder');
      icon.style.cursor = 'pointer';
      icon.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (fileExists && !(await fileExists(filePath))) {
          icon.remove();
          await playlistDl.validateAllTracks(fileExists);
          showToast(I18n.t('toast.fileNotFound'));
          return;
        }
        window.snowify.showInFolder(filePath);
      });
    });
  }

  function wireDownloadButton(btn, collectionId, tracks, subPath, includeArtist) {
    btn.dataset.playlistId = collectionId;
    btn.style.display = tracks.length === 0 ? 'none' : '';
    syncDownloadButton(btn, playlistDl.getStatus(collectionId));

    btn.onclick = async () => {
      if (_dlBusy) return;
      _dlBusy = true;
      try {
        if (playlistDl.isDownloaded(collectionId)) {
          if (confirm(I18n.t('playlist.confirmRemoveDownload'))) {
            await playlistDl.removeDownload(collectionId);
            btn.closest('.view')?.querySelector('.track-list')
              ?.querySelectorAll('.track-dl-icon').forEach(el => el.remove());
            syncDownloadButton(btn, null);
            showToast(I18n.t('toast.downloadRemoved'));
            renderLibrary();
          }
        } else {
          const curStatus = playlistDl.getStatus(collectionId);
          if (curStatus?.status === 'downloading') {
            await playlistDl.cancel(collectionId);
            btn.closest('.view')?.querySelector('.track-list')
              ?.querySelectorAll('.track-dl-icon').forEach(el => el.remove());
            syncDownloadButton(btn, null);
            showToast(I18n.t('toast.downloadCancelled'));
          } else {
            btn.classList.add('downloading', 'dl-loading');
            showToast(I18n.tp('toast.downloadStarted', tracks.length));
            const baseFolder = await getDownloadFolder();
            const userFolder = subPath ? baseFolder + '/' + subPath : baseFolder;
            playlistDl.downloadPlaylist(collectionId, tracks, userFolder, includeArtist);
          }
        }
      } catch (err) {
        console.warn('Download button error:', err);
        syncDownloadButton(btn, playlistDl.getStatus(collectionId));
      } finally {
        _dlBusy = false;
      }
    };
  }

  async function validateAndRefresh(container, playlistId) {
    if (!fileExists) return;
    const changed = await playlistDl.validateAllTracks(fileExists);
    if (changed) {
      updateTrackDownloadIcons(playlistId, container);
      for (const sel of ['#btn-download-playlist', '#btn-album-download']) {
        const btn = $(sel);
        if (btn && btn.dataset.playlistId === playlistId) {
          syncDownloadButton(btn, playlistDl.getStatus(playlistId));
        }
      }
    }
  }

  // ─── Global Download Indicator ───

  function registerDownloadName(playlistId, displayName) {
    _dlNames[playlistId] = displayName;
  }

  function _resolveName(playlistId, userFolder) {
    if (_dlNames[playlistId]) return _dlNames[playlistId];
    if (userFolder) {
      const parts = userFolder.replace(/[\\/]+$/, '').split(/[\\/]/);
      return parts[parts.length - 1] || playlistId;
    }
    return playlistId;
  }

  function updateGlobalIndicator() {
    const wrap = $('#global-dl-wrap');
    const badge = $('#global-dl-badge');
    const btn = $('#btn-global-dl');
    if (!wrap || !badge || !btn) return;

    const active = playlistDl.getAllActive();

    if (!active.length) {
      if (!wrap.classList.contains('hidden')) {
        btn.classList.remove('downloading');
        wrap.classList.add('hidden');
        if (_popoverOpen) {
          _popoverOpen = false;
          $('#global-dl-popover')?.classList.add('hidden');
        }
      }
      return;
    }

    wrap.classList.remove('hidden');
    btn.classList.add('downloading');

    let totalDl = 0, totalAll = 0;
    for (const dl of active) {
      totalDl += dl.downloaded;
      totalAll += dl.total;
    }
    badge.textContent = totalDl + '/' + totalAll;

    if (_popoverOpen) _renderPopoverList(active);
  }

  function _renderPopoverList(active) {
    const list = $('#global-dl-list');
    if (!list) return;

    list.innerHTML = active.map(dl => {
      const name = _resolveName(dl.id, dl.userFolder);
      const processed = dl.downloaded + dl.failed;
      const pct = dl.total > 0 ? (processed / dl.total) * 100 : 0;
      return `<div class="global-dl-item">
        <div class="global-dl-item-row">
          <span class="global-dl-item-name" title="${name}">${name}</span>
          <span class="global-dl-item-count">${dl.downloaded}/${dl.total}</span>
        </div>
        <div class="global-dl-progress">
          <div class="global-dl-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>`;
    }).join('');
  }

  function initGlobalIndicator() {
    const btn = $('#btn-global-dl');
    const popover = $('#global-dl-popover');
    if (!btn || !popover) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _popoverOpen = !_popoverOpen;
      if (_popoverOpen) {
        popover.classList.remove('hidden', 'closing');
        _renderPopoverList(playlistDl.getAllActive());
      } else {
        popover.classList.add('closing');
        popover.addEventListener('animationend', () => {
          popover.classList.add('hidden');
          popover.classList.remove('closing');
        }, { once: true });
      }
    });

    document.addEventListener('click', (e) => {
      if (_popoverOpen && !e.target.closest('#global-dl-wrap')) {
        _popoverOpen = false;
        popover.classList.add('closing');
        popover.addEventListener('animationend', () => {
          popover.classList.add('hidden');
          popover.classList.remove('closing');
        }, { once: true });
      }
    });

    // Check initial state on startup
    updateGlobalIndicator();
  }

  return {
    DL_ARROW_SVG,
    syncDownloadButton,
    updateDownloadButton,
    updateTrackDownloadIcons,
    wireDownloadButton,
    bindDlIcons,
    validateAndRefresh,
    registerDownloadName,
    updateGlobalIndicator,
    initGlobalIndicator,
  };
};
