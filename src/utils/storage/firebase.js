// Firebase Storage：沿用原本 firebaseUpload.js 的上傳方式與 URL 格式
const { getBucket } = require('../../config/firebase');

async function upload(buffer, key, contentType) {
  const bucket = getBucket();
  const blob = bucket.file(key);

  await new Promise((resolve, reject) => {
    const stream = blob.createWriteStream({
      metadata: {
        contentType,
        metadata: { firebaseStorageDownloadTokens: new Date().toISOString() },
      },
    });
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(buffer);
  });

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(key)}?alt=media`;
}

async function remove(url) {
  const parts = url.split('/o/');
  if (parts.length < 2) throw new Error('無效的 Firebase Storage URL');
  const filePath = decodeURIComponent(parts[1].split('?')[0]);
  await getBucket().file(filePath).delete();
  return true;
}

module.exports = { upload, remove };
