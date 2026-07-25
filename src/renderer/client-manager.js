// ─── Client Manager (factory module) ───
// Manages client CRUD, favorites, queue injection, and UI rendering.
// Created via ClientManager(opts). Same pattern as DualAudioEngine / LoudnessNormalizer.

window.ClientManager = function ClientManager(opts) {
  'use strict';

  const I18n = window.I18n;

  const {
    getState, saveState, renderQueue, showToast, showInputModal,
    showNowPlaying, switchView, renderTrackList, playFromList,
    toggleLike, handlePlayNext, handleAddToQueue,
    getEngine, getUpNexts,
    $, escapeHtml, removeContextMenu, renderArtistLinks, bindArtistLinks,
  } = opts;

  // ─── Private state ───
  let _currentClientId = null;
  const MIN_TRACKS_FOR_REINJECT = 3;

  // ─── CRUD ───

  function createClient(name) {
    const state = getState();
    const client = {
      id: 'client_' + Date.now(),
      name,
      favorites: []
    };
    state.clients.push(client);
    saveState();
    renderClients();
    showToast(I18n.t('toast.clientCreated', { name }));
    return client;
  }

  async function renameClient(clientId) {
    const state = getState();
    const client = state.clients.find(c => c.id === clientId);
    if (!client) return;
    const newName = await showInputModal(I18n.t('modal.renameClient'), client.name);
    if (newName && newName !== client.name) {
      client.name = newName;
      const newFirstName = newName.split(' ')[0];
      state.queue.forEach(t => {
        if (t._clientIds) {
          const ci = t._clientIds.indexOf(clientId);
          if (ci !== -1) t._clientNames[ci] = newFirstName;
        }
      });
      saveState();
      renderClients();
      renderQueue();
      const current = state.queue[state.queueIndex];
      if (current) showNowPlaying(current);
      if (_currentClientId === clientId) {
        $('#playlist-hero-name').textContent = newName;
      }
      showToast(I18n.t('toast.clientRenamed', { name: newName }));
    }
  }

  function deleteClient(clientId) {
    const state = getState();
    const client = state.clients.find(c => c.id === clientId);
    if (!client) return;
    if (!confirm(I18n.t('modal.confirmDeleteClient', { name: client.name }))) return;
    const presIdx = state.clientsPresent.indexOf(clientId);
    if (presIdx !== -1) {
      state.clientsPresent.splice(presIdx, 1);
      removeClientTracks(clientId);
      updateClientsButton();
    }
    // Clean stale _clientIds from already-played tracks
    state.queue.forEach(t => {
      if (t._clientIds) {
        const ci = t._clientIds.indexOf(clientId);
        if (ci !== -1) {
          t._clientIds.splice(ci, 1);
          t._clientNames.splice(ci, 1);
          if (!t._clientIds.length) { delete t._clientIds; delete t._clientNames; }
        }
      }
    });
    state.clients = state.clients.filter(c => c.id !== clientId);
    saveState();
    renderClients();
    if (_currentClientId === clientId) {
      _currentClientId = null;
      switchView('home');
    }
    showToast(I18n.t('toast.clientDeleted', { name: client.name }));
  }

  function removeFromClientFavorites(clientId, trackIndex) {
    const state = getState();
    const client = state.clients.find(c => c.id === clientId);
    if (!client) return;
    const removedTrack = client.favorites[trackIndex];
    client.favorites.splice(trackIndex, 1);
    if (state.clientsPresent.includes(clientId) && removedTrack) {
      for (let i = state.queue.length - 1; i > state.queueIndex; i--) {
        const t = state.queue[i];
        if (t._clientIds && t._clientIds.includes(clientId) && t.id === removedTrack.id) {
          if (t._clientIds.length === 1) {
            state.queue.splice(i, 1);
          } else {
            const ci = t._clientIds.indexOf(clientId);
            t._clientIds.splice(ci, 1);
            t._clientNames.splice(ci, 1);
          }
          break;
        }
      }
      renderQueue();
    }
    saveState();
    showClientDetail(client);
  }

  // ─── UI ───

  function buildClientsFavSection(track) {
    const state = getState();
    if (!state.clients.length) return '';
    const alreadyIn = (client) => client.favorites.some(t => t.id === track.id);
    const checkIcon = '<svg class="client-toggle-icon is-added" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const plusIcon = '<svg class="client-toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    const subItems = state.clients.map(c =>
      `<div class="context-menu-item context-sub-item" data-action="toggle-client" data-cid="${c.id}"><span>${escapeHtml(c.name)}</span>${alreadyIn(c) ? checkIcon : plusIcon}</div>`
    ).join('');
    return `
      <div class="context-menu-divider"></div>
      <div class="context-menu-item context-menu-has-sub" data-action="none">
        <span>${I18n.t('context.clients')}</span>
        <svg class="sub-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        <div class="context-submenu">${subItems}</div>
      </div>`;
  }

  function handleToggleClient(clientId, track) {
    const state = getState();
    const client = state.clients.find(c => c.id === clientId);
    if (!client) return;
    const idx = client.favorites.findIndex(t => t.id === track.id);
    const isPresent = state.clientsPresent.includes(clientId);
    if (idx !== -1) {
      client.favorites.splice(idx, 1);
      if (isPresent) {
        for (let i = state.queue.length - 1; i > state.queueIndex; i--) {
          const t = state.queue[i];
          if (t._clientIds && t._clientIds.includes(clientId) && t.id === track.id) {
            if (t._clientIds.length === 1) {
              state.queue.splice(i, 1);
            } else {
              const ci = t._clientIds.indexOf(clientId);
              t._clientIds.splice(ci, 1);
              t._clientNames.splice(ci, 1);
            }
            break;
          }
        }
        renderQueue();
      }
      showToast(I18n.t('toast.removedFromClientFav', { name: client.name }));
    } else {
      client.favorites.push(track);
      if (isPresent) {
        const firstName = client.name.split(' ')[0];
        const tagged = { ...track, _clientIds: [clientId], _clientNames: [firstName] };
        silentPlayNext(tagged);
        renderQueue();
      }
      showToast(I18n.t('toast.addedToClientFav', { name: client.name }));
    }
    saveState();
    renderClients();
  }

  function renderClients() {
    const state = getState();
    const container = $('#client-list');
    if (!state.clients.length) {
      container.innerHTML = `
        <div class="empty-state" style="padding:24px 10px;">
          <p style="color:var(--text-subdued);font-size:13px;">${I18n.t('client.noClients')}</p>
        </div>`;
      return;
    }

    let html = '';
    state.clients.forEach(client => {
      const initial = client.name.charAt(0).toUpperCase();
      const count = client.favorites.length;
      html += `
        <div class="playlist-item" data-client="${client.id}">
          <div class="client-avatar">${initial}</div>
          <div class="playlist-info">
            <span class="playlist-name">${escapeHtml(client.name)}</span>
            <span class="playlist-count">${I18n.tp('client.favoriteCount', count)}</span>
          </div>
        </div>`;
    });

    container.innerHTML = html;
    container.querySelectorAll('.playlist-item').forEach(item => {
      item.addEventListener('click', () => {
        const client = state.clients.find(c => c.id === item.dataset.client);
        if (client) showClientDetail(client);
      });
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const client = state.clients.find(c => c.id === item.dataset.client);
        if (client) showClientContextMenu(e, client);
      });
    });
  }

  function showClientContextMenu(e, client) {
    removeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    menu.innerHTML = `
      <div class="context-menu-item" data-action="rename">${I18n.t('context.rename')}</div>
      <div class="context-menu-item" data-action="delete" style="color:var(--red)">${I18n.t('context.delete')}</div>
    `;

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

    menu.addEventListener('click', (ev) => {
      const item = ev.target.closest('.context-menu-item');
      if (!item) return;
      switch (item.dataset.action) {
        case 'rename':
          removeContextMenu();
          renameClient(client.id);
          return;
        case 'delete':
          removeContextMenu();
          deleteClient(client.id);
          return;
      }
      removeContextMenu();
    });

    setTimeout(() => {
      document.addEventListener('click', removeContextMenu, { once: true });
    }, 10);
  }

  function showClientDetail(client) {
    const state = getState();
    _currentClientId = client.id;
    state.currentPlaylistId = null;
    switchView('playlist');

    const heroName = $('#playlist-hero-name');
    const heroCount = $('#playlist-hero-count');
    const heroCover = $('#playlist-hero-cover');
    const tracksContainer = $('#playlist-tracks');
    const typeLabel = $('#view-playlist .playlist-type');

    heroName.textContent = client.name;
    heroCount.textContent = I18n.tp('client.favoriteCount', client.favorites.length);
    if (typeLabel) typeLabel.textContent = I18n.t('client.type');

    // Person icon hero
    heroCover.innerHTML = `<div class="client-hero-cover"><svg width="64" height="64" viewBox="0 0 24 24" fill="#fff"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></div>`;
    heroCover.style.background = 'none';

    // #view-playlist is shared with showPlaylistDetail — clear what it left behind,
    // otherwise the previous playlist's cover picker / header menu stay wired up.
    heroCover.classList.remove('playlist-cover-editable', 'liked-hero-cover', 'liked-cover');
    heroCover.onclick = null;
    heroCover.title   = '';
    const heroHeader = $('#view-playlist .playlist-header');
    if (heroHeader) heroHeader.oncontextmenu = null;

    // Hide playlist-specific buttons, repurpose delete for client
    const deleteBtn = $('#btn-delete-playlist');
    const folderBtn = $('#btn-import-folder');
    if (folderBtn) folderBtn.style.display = 'none';
    if (deleteBtn) {
      deleteBtn.style.display = '';
      deleteBtn.onclick = () => deleteClient(client.id);
    }

    if (client.favorites.length) {
      // Tag up front so every play path (row, thumbnail, Play Next / Add to Queue badges)
      // sends the track to the queue already identified as this client's.
      const firstName = client.name.split(' ')[0];
      const tagged = client.favorites.map(t => ({
        ...t, _clientIds: [client.id], _clientNames: [firstName],
      }));
      // 5th arg overrides the delegated menu — attaching per-row listeners instead loses
      // the race against showContextMenu's removeContextMenu(), and breaks on virtualized rows.
      renderTrackList(tracksContainer, tagged, 'client', client.id,
        (e, track, idx) => showClientTrackMenu(e, track, client, idx));
    } else {
      tracksContainer.innerHTML = `
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="#535353"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
          <p>${I18n.t('client.noFavorites')}</p>
          <p style="color:var(--text-subdued);font-size:13px;">${I18n.t('client.noFavoritesHint')}</p>
        </div>`;
    }

    $('#btn-play-all').onclick = () => {
      if (client.favorites.length) playFromList(client.favorites, 0);
    };

    $('#btn-shuffle-playlist').onclick = () => {
      if (client.favorites.length) {
        const shuffled = [...client.favorites];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        playFromList(shuffled, 0);
      }
    };
  }

  function showClientTrackMenu(e, track, client, idx) {
    const state = getState();
    removeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const liked = state.likedSongs.some(t => t.id === track.id);
    const clientsSection = buildClientsFavSection(track);

    menu.innerHTML = `
      <div class="context-menu-item" data-action="play">${I18n.t('context.play')}</div>
      <div class="context-menu-item" data-action="play-next">${I18n.t('context.playNext')}</div>
      <div class="context-menu-item" data-action="add-queue">${I18n.t('context.addToQueue')}</div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="like">${liked ? I18n.t('context.unlike') : I18n.t('context.like')}</div>
      <div class="context-menu-item" data-action="start-radio">${I18n.t('context.startRadio')}</div>
      ${clientsSection}
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="remove">${I18n.t('context.removeFromFavorites')}</div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="share">${I18n.t('context.copyLink')}</div>
    `;

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

    // Position submenus
    menu.querySelectorAll('.context-submenu').forEach(subMenuEl => {
      const parentItem = subMenuEl.parentElement;
      parentItem.addEventListener('mouseenter', () => {
        const subRect = subMenuEl.getBoundingClientRect();
        if (subRect.right > window.innerWidth) subMenuEl.classList.add('open-left');
        else subMenuEl.classList.remove('open-left');
        if (subRect.bottom > window.innerHeight) { subMenuEl.style.top = 'auto'; subMenuEl.style.bottom = '0'; }
      });
    });

    menu.addEventListener('click', async (ev) => {
      const item = ev.target.closest('[data-action]');
      if (!item || item.classList.contains('disabled')) return;
      const action = item.dataset.action;
      if (action === 'none') return;
      const taggedTrack = { ...track, _clientIds: [client.id], _clientNames: [client.name.split(' ')[0]] };
      switch (action) {
        case 'play':
          playFromList([taggedTrack], 0);
          break;
        case 'play-next': handlePlayNext(taggedTrack); break;
        case 'add-queue': handleAddToQueue(taggedTrack); break;
        // Untagged copy — likedSongs is persisted without stripping _clientIds.
        case 'like': toggleLike(client.favorites[idx]); break;
        case 'start-radio': {
          const upNexts = await getUpNexts(track.id);
          if (upNexts.length) {
            playFromList([track, ...upNexts.filter(t => t.id !== track.id)], 0);
            showToast(I18n.t('toast.radioStarted'));
          } else {
            showToast(I18n.t('toast.couldNotStartRadio'));
          }
          break;
        }
        case 'toggle-client':
          handleToggleClient(item.dataset.cid, track);
          break;
        case 'remove':
          removeFromClientFavorites(client.id, idx);
          showToast(I18n.t('toast.removedFromClientFav', { name: client.name }));
          break;
        case 'share':
          navigator.clipboard.writeText(track.url || `https://music.youtube.com/watch?v=${track.id}`);
          showToast(I18n.t('toast.linkCopied'));
          break;
      }
      removeContextMenu();
    });

    setTimeout(() => {
      document.addEventListener('click', removeContextMenu, { once: true });
    }, 10);
  }

  function renderClientsPopover() {
    const state = getState();
    const list = $('#clients-popover-list');
    const empty = $('#clients-popover-empty');
    if (!state.clients.length) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    // Clean up clientsPresent: remove IDs of deleted clients
    state.clientsPresent = state.clientsPresent.filter(id => state.clients.some(c => c.id === id));
    list.innerHTML = state.clients.map(c => {
      const isPresent = state.clientsPresent.includes(c.id);
      const initial = c.name.charAt(0).toUpperCase();
      return `
        <div class="clients-popover-item${isPresent ? ' active' : ''}" data-client-id="${c.id}">
          <div class="clients-popover-avatar">${initial}</div>
          <span class="clients-popover-name">${escapeHtml(c.name)}</span>
          <div class="clients-popover-switch${isPresent ? ' on' : ''}"><div class="clients-popover-switch-knob"></div></div>
        </div>`;
    }).join('');

    list.querySelectorAll('.clients-popover-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = item.dataset.clientId;
        toggleClientPresence(id);
        renderClientsPopover();
      });
    });
  }

  function updateClientsButton() {
    const state = getState();
    const btn = $('#btn-clients');
    const count = state.clientsPresent.filter(id => state.clients.some(c => c.id === id)).length;
    btn.classList.toggle('has-active', count > 0);
    btn.dataset.count = count;
    btn.title = count > 0 ? I18n.tp('client.clientsInVenueCount', count) : I18n.t('sidebar.clients');
  }

  // ─── Queue injection ───

  function toggleClientPresence(clientId) {
    const state = getState();
    const idx = state.clientsPresent.indexOf(clientId);
    if (idx !== -1) {
      state.clientsPresent.splice(idx, 1);
      removeClientTracks(clientId);
    } else {
      state.clientsPresent.push(clientId);
      injectClientTracks(clientId);
    }
    updateClientsButton();
    saveState();
  }

  function silentPlayNext(track) {
    const state = getState();
    const engine = getEngine();
    const existIdx = state.queue.findIndex((t, i) => i > state.queueIndex && t.id === track.id);
    if (existIdx !== -1) {
      const existing = state.queue[existIdx];
      if (existing._clientIds && track._clientIds) {
        existing._clientIds.forEach((id, i) => {
          if (!track._clientIds.includes(id)) {
            track._clientIds.push(id);
            track._clientNames.push(existing._clientNames[i]);
          }
        });
      } else if (existing._clientIds && !track._clientIds) {
        track = { ...track, _clientIds: existing._clientIds, _clientNames: existing._clientNames };
      }
      state.queue.splice(existIdx, 1);
    }
    if (state.queueIndex >= 0) state.queue.splice(state.queueIndex + 1, 0, track);
    else state.queue.push(track);
    engine.clearPreload();
  }

  function injectClientTracks(clientId) {
    const state = getState();
    const client = state.clients.find(c => c.id === clientId);
    if (!client || !client.favorites.length) return;

    const firstName = client.name.split(' ')[0];
    const upcoming = state.queue.slice(state.queueIndex + 1);

    // Merge client into tracks already in queue, collect new ones
    const toInsert = [];
    client.favorites.forEach(fav => {
      const existing = upcoming.find(t => t.id === fav.id);
      if (existing && existing._clientIds) {
        if (!existing._clientIds.includes(clientId)) {
          existing._clientIds.push(clientId);
          existing._clientNames.push(firstName);
        }
      } else if (existing) {
        existing._clientIds = [clientId];
        existing._clientNames = [firstName];
      } else {
        toInsert.push({ ...fav, _clientIds: [clientId], _clientNames: [firstName] });
      }
    });

    if (!toInsert.length) { renderQueue(); return; }

    // Shuffle before injecting
    for (let i = toInsert.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [toInsert[i], toInsert[j]] = [toInsert[j], toInsert[i]];
    }

    // First → Play Next
    silentPlayNext(toInsert[0]);

    // Rest → random positions in upcoming queue
    for (let i = 1; i < toInsert.length; i++) {
      const minPos = state.queueIndex + 2;
      const maxPos = state.queue.length;
      const pos = minPos + Math.floor(Math.random() * (maxPos - minPos + 1));
      state.queue.splice(pos, 0, toInsert[i]);
    }

    renderQueue();
    showToast(I18n.t('toast.clientFavInjected', { name: firstName }));
  }

  function removeClientTracks(clientId) {
    const state = getState();
    const engine = getEngine();
    const client = state.clients.find(c => c.id === clientId);
    const firstName = client ? client.name.split(' ')[0] : 'Client';

    for (let i = state.queue.length - 1; i > state.queueIndex; i--) {
      const t = state.queue[i];
      if (t._clientIds && t._clientIds.includes(clientId)) {
        if (t._clientIds.length === 1) {
          state.queue.splice(i, 1);
        } else {
          const ci = t._clientIds.indexOf(clientId);
          t._clientIds.splice(ci, 1);
          t._clientNames.splice(ci, 1);
        }
      }
    }

    engine.clearPreload();
    renderQueue();
    showToast(I18n.t('toast.clientFavRemoved', { name: firstName }));
  }

  function recheckClientInjections() {
    const state = getState();
    const current = state.queue[state.queueIndex];
    const toDeselect = [];
    state.clientsPresent.forEach(cid => {
      const client = state.clients.find(c => c.id === cid);
      if (!client) return;
      const upcoming = state.queue.slice(state.queueIndex + 1);
      const currentIsClient = current && current._clientIds && current._clientIds.includes(cid);
      const hasUpcoming = upcoming.some(t => t._clientIds && t._clientIds.includes(cid));
      if (!hasUpcoming && !currentIsClient) {
        if (client.favorites.length >= MIN_TRACKS_FOR_REINJECT) {
          injectClientTracks(cid);
        } else {
          toDeselect.push(cid);
        }
      }
    });
    // Auto-deselect clients with < 3 favorites after all their tracks played
    if (toDeselect.length) {
      toDeselect.forEach(cid => {
        state.clientsPresent.splice(state.clientsPresent.indexOf(cid), 1);
      });
      updateClientsButton();
      saveState();
    }
  }

  // ─── Event listener binding ───

  function init() {
    $('#btn-create-client').addEventListener('click', async () => {
      const name = await showInputModal(I18n.t('modal.newClientName'));
      if (name) createClient(name);
    });

    $('#btn-clients').addEventListener('click', (e) => {
      e.stopPropagation();
      const popover = $('#clients-popover');
      popover.classList.toggle('hidden');
      if (!popover.classList.contains('hidden')) {
        renderClientsPopover();
      }
    });

    document.addEventListener('click', (e) => {
      const popover = $('#clients-popover');
      if (!popover.classList.contains('hidden') && !popover.contains(e.target) && !e.target.closest('#btn-clients')) {
        popover.classList.add('hidden');
      }
    });
  }

  // ─── Public API ───

  return {
    create: createClient,
    rename: renameClient,
    delete: deleteClient,
    removeFromFavorites: removeFromClientFavorites,
    renderList: renderClients,
    renderPopover: renderClientsPopover,
    showDetail: showClientDetail,
    updateButton: updateClientsButton,
    buildFavSection: buildClientsFavSection,
    handleToggle: handleToggleClient,
    togglePresence: toggleClientPresence,
    recheckInjections: recheckClientInjections,
    getCurrentClientId: () => _currentClientId,
    clearCurrentClient: () => { _currentClientId = null; },
    init,
  };
};
