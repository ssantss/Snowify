// Playlist + single-song persistent downloads (yt-dlp + ffmpeg thumbnail embed).
// Distinct from prefetch-cache (temp) — these go to a user-chosen folder.

'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { dialog, shell, app } = require('electron');
const { getYtDlpPath } = require('./ytdlp');
const { getAudioFormatArgs, getAudioExtension, embedThumbnail } = require('./ytdlp-utils');

let _activePlaylistDownloadProc = null;

function register(ipcMain, ctx) {
  ipcMain.handle('playlist:downloadTrack', async (_event, videoUrl, _quality, _videoId, _playlistId, format, thumbnailUrl, title, artist, userFolder, includeArtist, trackNumber) => {
    if (!userFolder) return { error: 'No download folder configured' };

    fs.mkdirSync(userFolder, { recursive: true });
    const baseName = (includeArtist
      ? `${title || 'track'}${artist ? ' - ' + artist : ''}`
      : (title || 'track')
    ).replace(/[/\\?%*:|"<>]/g, '_');
    const safeName = trackNumber
      ? `${String(trackNumber).padStart(2, '0')} - ${baseName}`
      : baseName;
    const ext = getAudioExtension(format);
    const filePath = path.join(userFolder, safeName + ext);

    // Already downloaded
    if (fs.existsSync(filePath)) return { path: filePath };

    return new Promise((resolve, reject) => {
      const proc = execFile(getYtDlpPath(), [
        ...getAudioFormatArgs(format),
        '-o', filePath,
        '--no-part', '--no-warnings', '--no-playlist', '--no-check-certificates',
        videoUrl
      ], { timeout: 120000 }, async (err, _stdout, stderr) => {
        if (_activePlaylistDownloadProc === proc) _activePlaylistDownloadProc = null;
        if (err) {
          if (err.killed || err.signal === 'SIGTERM') {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
            return reject('cancelled');
          }
          return reject(stderr?.trim() || err.message);
        }
        if (!fs.existsSync(filePath)) return reject('Download completed but file not found');
        try { await embedThumbnail(format, filePath, thumbnailUrl); } catch (_) {}
        resolve({ path: filePath });
      });
      _activePlaylistDownloadProc = proc;
    });
  });

  ipcMain.handle('playlist:cancelPlaylistDownload', async () => {
    if (_activePlaylistDownloadProc) {
      _activePlaylistDownloadProc.kill('SIGTERM');
      _activePlaylistDownloadProc = null;
    }
    return { ok: true };
  });

  ipcMain.handle('playlist:deleteDownload', async (_event, _playlistId, filePaths) => {
    const dirs = new Set();
    for (const fp of (filePaths || [])) {
      try {
        if (fs.existsSync(fp)) {
          fs.unlinkSync(fp);
          dirs.add(path.dirname(fp));
        }
      } catch (_) {}
    }
    // Remove immediate parent folder if empty (e.g. album or playlist folder)
    for (const dir of dirs) {
      try {
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch (_) {}
    }
    return { ok: true };
  });

  ipcMain.handle('fs:fileExists', async (_event, filePath) => {
    return fs.existsSync(filePath);
  });

  // song:saveTo — replaces upstream's MP3-only handler (was in ytmusic.js) with
  // a multi-format + thumbnail-embedding version. Backwards compatible: when
  // `format` and `thumbnailUrl` are omitted (old 3-arg signature), defaults to mp3.
  ipcMain.handle('song:saveTo', async (_event, videoUrl, title, artist, thumbnailUrl, format) => {
    const { mt } = require('./i18n');
    format = format || 'mp3';
    const ext = getAudioExtension(format);
    const safeName = `${title || 'track'}${artist ? ' - ' + artist : ''}`.replace(/[/\\?%*:|"<>]/g, '_');
    const result = await dialog.showSaveDialog(ctx.mainWindow, {
      title: mt ? mt('dialog.saveSong') : 'Save song',
      defaultPath: safeName + ext,
      filters: [{ name: `${format.toUpperCase()} Audio`, extensions: [ext.slice(1)] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    const ytdlpErr = await new Promise((resolve) => {
      execFile(getYtDlpPath(), [
        ...getAudioFormatArgs(format),
        '--no-part', '--no-warnings', '--no-playlist', '--no-check-certificates',
        '-o', result.filePath,
        videoUrl,
      ], { timeout: 300000 }, (err, _stdout, stderr) => {
        if (err) return resolve(stderr?.trim() || err.message);
        resolve(null);
      });
    });
    if (ytdlpErr) return { error: ytdlpErr };

    try { await embedThumbnail(format, result.filePath, thumbnailUrl); } catch (_) {}

    return { success: true, filePath: result.filePath };
  });

  ipcMain.handle('song:saveToFolder', async (_event, videoUrl, title, artist, thumbnailUrl, folderPath, format) => {
    format = format || 'mp3';
    const ext = getAudioExtension(format);
    const safeName = `${title || 'track'}${artist ? ' - ' + artist : ''}`.replace(/[/\\?%*:|"<>]/g, '_');
    const filePath = path.join(folderPath, safeName + ext);

    fs.mkdirSync(folderPath, { recursive: true });

    const ytdlpErr = await new Promise((resolve) => {
      execFile(getYtDlpPath(), [
        ...getAudioFormatArgs(format),
        '--no-part', '--no-warnings', '--no-playlist', '--no-check-certificates',
        '-o', filePath,
        videoUrl,
      ], { timeout: 300000 }, (err, _stdout, stderr) => {
        if (err) return resolve(stderr?.trim() || err.message);
        resolve(null);
      });
    });
    if (ytdlpErr) return { error: ytdlpErr };

    try { await embedThumbnail(format, filePath, thumbnailUrl); } catch (_) {}

    return { success: true, filePath };
  });

  ipcMain.handle('config:pickDownloadFolder', async () => {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      title: 'Choose download folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('config:getDefaultMusicDir', () => {
    return path.join(app.getPath('music'), 'Snowify');
  });

  ipcMain.handle('shell:showInFolder', (_event, filePath) => {
    if (!filePath || typeof filePath !== 'string') return { error: 'Invalid path' };
    try {
      shell.showItemInFolder(filePath);
      return { ok: true };
    } catch (err) {
      console.warn('showInFolder error:', err.message);
      return { error: err.message };
    }
  });
}

module.exports = { register };
