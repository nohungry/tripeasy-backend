// firebase.js：第一次用到才初始化，缺少金鑰時不會讓整個 server 在載入時 crash
const admin = require('firebase-admin');

let bucket;

function getBucket() {
  if (bucket) return bucket;

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT environment variable');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
  bucket = admin.storage().bucket();
  return bucket;
}

module.exports = { getBucket };
