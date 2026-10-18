// storage adapter：依 STORAGE_DRIVER 切換 local / firebase（預設 firebase，維持原本行為）
const drivers = {
  local: () => require('./local'),
  firebase: () => require('./firebase'),
};

function driver() {
  const name = process.env.STORAGE_DRIVER || 'firebase';
  const load = drivers[name];
  if (!load) throw new Error(`Unknown STORAGE_DRIVER: ${name}`);
  return load();
}

module.exports = {
  upload: (buffer, key, contentType) => driver().upload(buffer, key, contentType),
  remove: (url) => driver().remove(url),
};
