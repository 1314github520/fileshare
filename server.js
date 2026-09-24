const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 9999;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'files.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');

function readFiles() {
  try {
    const files = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const liveFiles = files.filter((file) => !file.storedName || fs.existsSync(path.join(UPLOAD_DIR, path.basename(file.storedName))));
    const normalized = liveFiles.map((file) => {
      const originalName = safeRelativeName(file.originalName || file.title);
      return {
        id: file.id,
        title: originalName,
        originalName,
        storedName: file.storedName,
        sizeBytes: file.sizeBytes || 0,
        size: file.size || formatBytes(file.sizeBytes || 0),
        downloads: file.downloads || 0,
        createdAt: file.createdAt
      };
    });
    if (JSON.stringify(normalized) !== JSON.stringify(files)) writeFiles(normalized);
    return normalized;
  } catch {
    return [];
  }
}

function writeFiles(files) {
  fs.writeFileSync(DB_FILE, JSON.stringify(files, null, 2));
}

function decodeFileName(value) {
  const raw = String(value || '');
  if (!raw || [...raw].some((character) => character.charCodeAt(0) > 255)) return raw;
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? raw : decoded;
}

function safeFileName(value) {
  return path.basename(String(value || 'download').replace(/\\/g, '/')).replace(/[\0\r\n]/g, '_').slice(0, 200) || 'download';
}

function safeRelativeName(value) {
  const parts = decodeFileName(value).replace(/\\/g, '/').split('/').filter((part) => part && part !== '.' && part !== '..');
  return parts.map((part) => safeFileName(part)).join('/') || 'download';
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').split('/').filter((part) => part && part !== '.' && part !== '..').map(safeFileName);
}

function listDirectory(files, requestedPath) {
  const pathParts = normalizePath(requestedPath);
  const currentPath = pathParts.join('/');
  const folders = new Map();
  const visibleFiles = [];

  files.forEach((file) => {
    const fileParts = safeRelativeName(file.originalName || file.title).split('/');
    const prefixMatches = pathParts.every((part, index) => fileParts[index] === part);
    if (!prefixMatches || fileParts.length <= pathParts.length) return;
    const remainder = fileParts.slice(pathParts.length);
    if (remainder.length > 1) {
      const folderName = remainder[0];
      const folderPath = [...pathParts, folderName].join('/');
      if (!folders.has(folderPath)) folders.set(folderPath, { type: 'folder', name: folderName, path: folderPath, sizeBytes: 0, createdAt: null });
      const folder = folders.get(folderPath);
      folder.sizeBytes += file.sizeBytes || 0;
      if (file.createdAt && (!folder.createdAt || file.createdAt > folder.createdAt)) folder.createdAt = file.createdAt;
    } else {
      visibleFiles.push({ ...file, type: 'file', name: remainder[0], path: currentPath });
    }
  });

  const entries = [];
  if (pathParts.length) {
    const parentPath = pathParts.slice(0, -1).join('/');
    entries.push({ type: 'parent', name: '..', path: parentPath });
  }
  entries.push(...[...folders.values()].map((f) => ({ ...f, size: formatBytes(f.sizeBytes) })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')));
  entries.push(...visibleFiles.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')));
  return entries;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const extension = path.extname(safeRelativeName(file.originalname)).toLowerCase().slice(0, 12);
    cb(null, `${crypto.randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  preservePath: true,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/files', (req, res) => {
  res.json(listDirectory(readFiles(), req.query.path));
});

app.post('/api/upload', upload.fields([
  { name: 'files', maxCount: 5000 }
]), (req, res) => {
  const incoming = req.files?.files || [];
  if (!incoming.length) return res.status(400).json({ error: '请选择文件或文件夹' });
  const files = readFiles();
  const createdAt = new Date().toISOString();
  const items = incoming.map((file) => {
    const originalName = safeRelativeName(file.originalname);
    return {
      id: crypto.randomUUID(),
      title: originalName,
      originalName,
      storedName: file.filename,
      sizeBytes: file.size,
      size: formatBytes(file.size),
      downloads: 0,
      createdAt
    };
  });
  files.unshift(...items);
  writeFiles(files);
  res.status(201).json({ items, count: items.length });
});

app.get('/download/:id', (req, res) => {
  const files = readFiles();
  const item = files.find((file) => file.id === req.params.id);
  if (!item) return res.status(404).send('文件不存在');
  const absolutePath = path.join(UPLOAD_DIR, item.storedName);
  if (!fs.existsSync(absolutePath)) return res.status(404).send('文件已被移除');
  item.downloads += 1;
  writeFiles(files);
  res.download(absolutePath, path.basename(item.originalName));
});

app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '文件不能超过 2GB' });
  }
  console.error(error);
  res.status(500).json({ error: '服务器暂时无法处理请求' });
});

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

app.listen(PORT, () => console.log(`Soft/Share is listening on http://localhost:${PORT}`));
