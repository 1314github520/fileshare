const state = { entries: [], path: '', query: '' };
const $ = (selector) => document.querySelector(selector);
const fileList = $('#fileList');

async function loadDirectory(nextPath = state.path) {
  state.path = nextPath;
  const response = await fetch(`/api/files?path=${encodeURIComponent(state.path)}`);
  state.entries = response.ok ? await response.json() : [];
  render();
}

function render() {
  const visibleEntries = state.entries.filter((entry) => entry.type === 'parent' || fuzzyMatch(entry, state.query));
  fileList.innerHTML = visibleEntries.map((entry) => entry.type === 'file' ? fileRow(entry) : directoryRow(entry)).join('');
  $('#emptyState').classList.toggle('visible', visibleEntries.length === 0);
  const fileCount = visibleEntries.filter((entry) => entry.type === 'file').length;
  const folderCount = visibleEntries.filter((entry) => entry.type === 'folder').length;
  $('#listingSummary').textContent = `共 ${fileCount} 个文件，${folderCount} 个目录。`;
  renderBreadcrumb();
  fileList.querySelectorAll('[data-path]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    loadDirectory(link.dataset.path);
  }));
}

function renderBreadcrumb() {
  const parts = state.path ? state.path.split('/') : [];
  let html = `<a href="#" data-path="">/</a>`;
  let accumulated = '';
  for (const part of parts) {
    accumulated = accumulated ? `${accumulated}/${part}` : part;
    html += `<span class="sep">/</span><a href="#" data-path="${escapeHtml(accumulated)}">${escapeHtml(part)}</a>`;
  }
  $('#breadcrumb').innerHTML = html;
  $('#breadcrumb').querySelectorAll('[data-path]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    loadDirectory(link.dataset.path);
  }));
}

function directoryRow(entry) {
  const size = entry.type === 'folder' ? escapeHtml(entry.size || '—') : '-';
  const date = entry.type === 'folder' ? formatDate(entry.createdAt) : '—';
  return `<div class="file-row"><div class="name"><a class="folder-link" href="#" data-path="${escapeHtml(entry.path)}">${escapeHtml(entry.name)}${entry.type === 'folder' ? '/' : ''}</a></div><div class="size">${size}</div><div class="date">${date}</div></div>`;
}

function fileRow(file) {
  const displayName = file.name || file.originalName || file.title;
  return `<div class="file-row"><div class="name"><a class="file-link" href="/download/${encodeURIComponent(file.id)}">${escapeHtml(displayName)}</a></div><div class="size">${escapeHtml(file.size || '—')}</div><div class="date">${formatDate(file.createdAt)}</div></div>`;
}

function fuzzyMatch(entry, query) {
  if (!query) return true;
  const text = [entry.name, entry.path, entry.originalName].filter(Boolean).join(' ').toLocaleLowerCase();
  return text.includes(query.toLocaleLowerCase());
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char])); }

const dialog = $('#uploadDialog');
const fileInput = $('#fileInput');
const folderInput = $('#folderInput');

function chooseInput() {
  $('#formStatus').textContent = '';
  resetProgress();
  dialog.showModal();
}

$('#openUpload').addEventListener('click', (event) => { event.preventDefault(); chooseInput(); });
$('#closeUpload').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

$('#fileBtn').addEventListener('click', () => fileInput.click());
$('#folderBtn').addEventListener('click', () => folderInput.click());

fileInput.addEventListener('change', () => {
  $('#fileLabel').textContent = fileInput.files.length ? `${fileInput.files.length} 个文件` : '未选择任何文件';
});

folderInput.addEventListener('change', () => {
  $('#folderLabel').textContent = folderInput.files.length ? `${folderInput.files.length} 个文件` : '未选择任何文件';
});

function setProgress(percent) {
  $('#progressFill').style.width = `${percent}%`;
}

function resetProgress() {
  setProgress(0);
  $('#progressBar').classList.remove('visible');
}

$('#uploadForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const selectedFiles = [...fileInput.files, ...folderInput.files];
  if (!selectedFiles.length) {
    $('#formStatus').textContent = '请先选择文件或文件夹。';
    return;
  }
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  $('#formStatus').textContent = `正在上传 ${selectedFiles.length} 个文件 (${formatBytes(totalSize)})...`;
  $('#progressBar').classList.add('visible');
  setProgress(0);

  const formData = new FormData();
  selectedFiles.forEach((file) => formData.append('files', file, file.webkitRelativePath || file.name));

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
  });
  xhr.addEventListener('load', () => {
    let result;
    try { result = JSON.parse(xhr.responseText); } catch { result = { error: '上传失败' }; }
    if (xhr.status >= 200 && xhr.status < 300) {
      dialog.close();
      event.target.reset();
      $('#fileLabel').textContent = '未选择任何文件';
      $('#folderLabel').textContent = '未选择任何文件';
      resetProgress();
      loadDirectory(state.path);
    } else {
      $('#formStatus').textContent = result.error || '上传失败';
      resetProgress();
    }
  });
  xhr.addEventListener('error', () => {
    $('#formStatus').textContent = '网络错误，请重试';
    resetProgress();
  });
  xhr.addEventListener('abort', () => {
    $('#formStatus').textContent = '上传已取消';
    resetProgress();
  });
  xhr.send(formData);
});

$('#searchInput').addEventListener('input', (event) => {
  state.query = event.target.value.trim();
  render();
});

loadDirectory();
