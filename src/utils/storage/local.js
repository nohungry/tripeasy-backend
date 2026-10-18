// 本機儲存：寫入 UPLOAD_DIR，由 server.js 的 /uploads 提供靜態檔
const fs = require('fs/promises');
const path = require('path');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads'));

// 每一段路徑只保留安全字元，並移除 . 和 ..，避免寫到 UPLOAD_DIR 之外
function safeKey(key) {
  return key
    .split(/[\\/]+/)
    .map((part) => part.replace(/[^\w.\-一-龥]/g, '_'))
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

function resolveInside(rel) {
  const full = path.join(UPLOAD_DIR, rel);
  if (!full.startsWith(UPLOAD_DIR + path.sep)) throw new Error('非法的檔案路徑');
  return full;
}

async function upload(buffer, key) {
  const rel = safeKey(key);
  const full = resolveInside(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);

  const base = process.env.STORAGE_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${base}/uploads/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

async function remove(url) {
  const marker = '/uploads/';
  const i = url.indexOf(marker);
  if (i < 0) return false;
  const rel = safeKey(decodeURIComponent(url.slice(i + marker.length).split('?')[0]));
  try {
    await fs.unlink(resolveInside(rel));
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = { upload, remove, UPLOAD_DIR };
