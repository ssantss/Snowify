// Audio format helpers + thumbnail embedding for downloads.
// Used by both yt-dlp playlist downloads and single-song saves.

'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

function getAudioFormatArgs(format) {
  const map = { mp3: 'mp3', flac: 'flac', wav: 'wav', ogg: 'vorbis', m4a: 'm4a' };
  const fmt = map[format] || 'mp3';
  const args = ['-x', '--audio-format', fmt, '--embed-metadata'];
  if (['mp3', 'vorbis', 'm4a'].includes(fmt)) args.push('--audio-quality', '0');
  return args;
}

function getAudioExtension(format) {
  return '.' + (format || 'mp3');
}

function getThumbEmbedArgs(format, inputFile, thumbFile, outputFile) {
  const base = ['-y', '-i', inputFile, '-i', thumbFile, '-map', '0:a', '-map', '1:0'];
  switch (format) {
    case 'mp3':
      return [...base, '-c', 'copy', '-id3v2_version', '3',
        '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)',
        '-disposition:v', 'attached_pic', outputFile];
    case 'flac':
      return [...base, '-c:a', 'copy', '-disposition:v', 'attached_pic', outputFile];
    case 'm4a':
      return [...base, '-c:a', 'copy', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic', outputFile];
    default:
      return null; // OGG, WAV — skip embedding
  }
}

function downloadThumbnail(thumbnailUrl, tmpThumb) {
  return new Promise((resolve, reject) => {
    const mod = thumbnailUrl.startsWith('https') ? require('https') : require('http');
    mod.get(thumbnailUrl, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const rMod = res.headers.location.startsWith('https') ? require('https') : require('http');
        rMod.get(res.headers.location, (r2) => {
          const chunks = [];
          r2.on('data', (c) => chunks.push(c));
          r2.on('end', () => { fs.writeFileSync(tmpThumb, Buffer.concat(chunks)); resolve(); });
          r2.on('error', reject);
        }).on('error', reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { fs.writeFileSync(tmpThumb, Buffer.concat(chunks)); resolve(); });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function embedThumbnail(format, filePath, thumbnailUrl) {
  const ffmpegArgs = getThumbEmbedArgs(format, filePath, null, null);
  if (!ffmpegArgs || !thumbnailUrl) return;

  const tmpThumb = path.join(os.tmpdir(), `snowify_thumb_${Date.now()}.jpg`);
  try {
    await downloadThumbnail(thumbnailUrl, tmpThumb);
    const ext = getAudioExtension(format);
    const tmpOut = filePath + '.tmp' + ext;
    const args = getThumbEmbedArgs(format, filePath, tmpThumb, tmpOut);
    const ffmpegErr = await new Promise((resolve) => {
      execFile('ffmpeg', args, { timeout: 30000 }, (err, _stdout, stderr) => {
        if (err) return resolve(stderr?.trim() || err.message);
        resolve(null);
      });
    });
    if (!ffmpegErr && fs.existsSync(tmpOut)) {
      fs.renameSync(tmpOut, filePath);
    } else if (fs.existsSync(tmpOut)) {
      fs.unlinkSync(tmpOut);
    }
  } catch (_) {
    // Thumbnail download failed — file still saved without cover
  } finally {
    if (fs.existsSync(tmpThumb)) fs.unlinkSync(tmpThumb);
  }
}

module.exports = {
  getAudioFormatArgs,
  getAudioExtension,
  getThumbEmbedArgs,
  downloadThumbnail,
  embedThumbnail,
};
