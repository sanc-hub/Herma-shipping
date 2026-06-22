const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

const defaultStore = {
  users: [],
  vessels: [],
  folders: [],
  files: []
};

function loadStore() {
  try {
    if (!fs.existsSync(DB_PATH)) return { ...defaultStore };
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      vessels: Array.isArray(parsed.vessels) ? parsed.vessels : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      files: Array.isArray(parsed.files) ? parsed.files : []
    };
  } catch (err) {
    console.error('Failed to load data store, falling back to empty state', err);
    return { ...defaultStore };
  }
}

function saveStore(store) {
  try {
    const tempPath = DB_PATH + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tempPath, DB_PATH);
    return true;
  } catch (err) {
    console.error('Failed to save data store', err);
    return false;
  }
}

let store = loadStore();

function sendError(res, message, code = 400) {
  return res.status(code).json({ ok: false, error: message });
}

function sendSuccess(res, data = {}) {
  return res.json({ ok: true, ...data });
}

function validatePayload(body) {
  if (!body || typeof body !== 'object') return false;
  if (typeof body.action !== 'string') return false;
  return true;
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

app.post('/api', (req, res) => {
  if (!validatePayload(req.body)) return sendError(res, 'Invalid request payload', 400);

  const { action, ...payload } = req.body;
  switch (action) {
    case 'login':
      return handleLogin(req, res, payload);
    case 'register':
      return handleRegister(req, res, payload);
    case 'getAllData':
      return handleGetAllData(req, res);
    case 'saveVessels':
      return handleSaveVessels(req, res, payload);
    case 'saveFolders':
      return handleSaveFolders(req, res, payload);
    case 'saveFileMeta':
      return handleSaveFileMeta(req, res, payload);
    case 'deleteFile':
      return handleDeleteFile(req, res, payload);
    default:
      return sendError(res, 'Unknown action: ' + action, 400);
  }
});

function handleLogin(req, res, payload) {
  const username = normalizeUsername(payload.username);
  const password = String(payload.password || '');
  if (!username || !password) return sendError(res, 'Missing username or password', 400);

  const user = store.users.find(u => u.username === username);
  if (!user) return sendError(res, 'Invalid credentials', 401);

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return sendError(res, 'Invalid credentials', 401);

  return sendSuccess(res, { name: user.full_name, role: user.role });
}

function handleRegister(req, res, payload) {
  const username = normalizeUsername(payload.username);
  const password = String(payload.password || '');
  const fullName = String(payload.fullName || '').trim();
  const role = String(payload.role || 'viewer').trim() || 'viewer';

  if (!username || !password || !fullName) return sendError(res, 'Missing registration fields', 400);
  if (password.length < 4) return sendError(res, 'Password must be at least 4 characters', 400);

  const existing = store.users.some(u => u.username === username);
  if (existing) return sendError(res, 'Username already taken', 409);

  const password_hash = bcrypt.hashSync(password, 10);
  store.users.push({
    username,
    password_hash,
    full_name: fullName,
    role,
    created_at: Date.now()
  });

  saveStore(store);
  return sendSuccess(res, {});
}

function handleGetAllData(req, res) {
  return sendSuccess(res, {
    vessels: store.vessels.map(v => ({
      id: v.id,
      name: v.name,
      imo: v.imo,
      type: v.type,
      flag: v.flag,
      year: v.year,
      imageUrl: v.image_url || v.imageUrl || '',
      created_at: v.created_at || Date.now()
    })),
    folders: store.folders.map(f => ({
      id: f.id,
      name: f.name,
      vesselId: f.vessel_id || f.vesselId || '',
      parentId: f.parent_id || f.parentId || null,
      createdBy: f.created_by || f.createdBy || '',
      created_at: f.created_at || Date.now()
    })),
    files: store.files.map(f => ({
      key: f.key,
      folderId: f.folder_id || f.folderId || '',
      vesselId: f.vessel_id || f.vesselId || '',
      name: f.name,
      size: f.size,
      by: f.created_by || f.by || '',
      at: f.created_at || f.at || Date.now(),
      driveFileId: f.drive_file_id || f.driveFileId || '',
      excelDriveFileId: f.excel_drive_file_id || f.excelDriveFileId || ''
    }))
  });
}

function handleSaveVessels(req, res, payload) {
  if (!Array.isArray(payload.vessels)) return sendError(res, 'Missing vessels payload', 400);
  store.vessels = payload.vessels.map(item => ({
    id: item.id,
    name: item.name || '',
    imo: item.imo || '',
    type: item.type || '',
    flag: item.flag || '',
    year: item.year || '',
    image_url: item.imageUrl || item.image_url || '',
    created_at: item.created_at || Date.now()
  }));
  saveStore(store);
  return sendSuccess(res, {});
}

function handleSaveFolders(req, res, payload) {
  if (!Array.isArray(payload.folders)) return sendError(res, 'Missing folders payload', 400);
  store.folders = payload.folders.map(item => ({
    id: item.id,
    name: item.name || '',
    vessel_id: item.vesselId || item.vessel_id || '',
    parent_id: item.parentId || item.parent_id || null,
    created_by: item.createdBy || item.created_by || '',
    created_at: item.created_at || Date.now()
  }));
  saveStore(store);
  return sendSuccess(res, {});
}

function handleSaveFileMeta(req, res, payload) {
  if (!Array.isArray(payload.files)) return sendError(res, 'Missing files payload', 400);
  store.files = payload.files.map(item => ({
    key: item.key,
    folder_id: item.folderId || item.folder_id || '',
    vessel_id: item.vesselId || item.vessel_id || '',
    name: item.name || '',
    size: item.size || '',
    created_by: item.by || item.created_by || '',
    created_at: item.at || item.created_at || Date.now(),
    drive_file_id: item.driveFileId || item.drive_file_id || '',
    excel_drive_file_id: item.excelDriveFileId || item.excel_drive_file_id || ''
  }));
  saveStore(store);
  return sendSuccess(res, {});
}

function handleDeleteFile(req, res, payload) {
  const driveFileId = String(payload.driveFileId || '').trim();
  if (!driveFileId) return sendError(res, 'Missing driveFileId', 400);
  store.files = store.files.filter(f => {
    const driveId = f.drive_file_id || f.driveFileId || '';
    const excelId = f.excel_drive_file_id || f.excelDriveFileId || '';
    return driveId !== driveFileId && excelId !== driveFileId;
  });
  saveStore(store);
  return sendSuccess(res, {});
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
