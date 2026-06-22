const path = require('path');
const fs = require('fs');
const dns = require('dns');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { MongoClient, ServerApiVersion } = require('mongodb');

try {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
  console.log('Using public DNS servers for MongoDB SRV resolution');
} catch (err) {
  console.warn('Could not set DNS servers for SRV lookup:', err);
}

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data.json');
const MONGO_URI = process.env.MONGODB_URI || '';
const MONGO_DB_NAME = process.env.MONGODB_DB || 'vmms';

let dbClient = null;
let db = null;
let usersCol = null;
let vesselsCol = null;
let foldersCol = null;
let filesCol = null;

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

async function initializeDb() {
  if (!MONGO_URI) {
    console.warn('No MONGODB_URI provided; falling back to local JSON persistence.');
    return;
  }

  dbClient = new MongoClient(MONGO_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true
    },
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  await dbClient.connect();
  db = dbClient.db(MONGO_DB_NAME);
  usersCol = db.collection('users');
  vesselsCol = db.collection('vessels');
  foldersCol = db.collection('folders');
  filesCol = db.collection('files');

  await usersCol.createIndex({ username: 1 }, { unique: true });
  await vesselsCol.createIndex({ id: 1 }, { unique: true });
  await foldersCol.createIndex({ id: 1 }, { unique: true });
  await filesCol.createIndex({ key: 1 }, { unique: true });

  await seedFixedUsers();

  console.log('Connected to MongoDB Atlas database:', MONGO_DB_NAME);
}

async function seedFixedUsers() {
  if (!usersCol) return;
  const ops = FIXED_USERS.map(user => ({
    updateOne: {
      filter: { username: normalizeUsername(user.username) },
      update: {
        $set: {
          username: normalizeUsername(user.username),
          full_name: user.full_name,
          role: user.role,
          password_hash: bcrypt.hashSync(user.password, 10)
        }
      },
      upsert: true
    }
  }));
  if (ops.length) await usersCol.bulkWrite(ops);
  console.log('✓ Fixed login users seeded into database');
}

function useDb() {
  return !!db;
}

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

function toVesselDoc(item) {
  return {
    id: item.id,
    name: item.name || '',
    imo: item.imo || '',
    type: item.type || '',
    flag: item.flag || '',
    year: item.year || '',
    image_url: item.imageUrl || item.image_url || '',
    created_at: item.created_at || Date.now()
  };
}

function toFolderDoc(item) {
  return {
    id: item.id,
    name: item.name || '',
    vessel_id: item.vesselId || item.vessel_id || '',
    parent_id: item.parentId || item.parent_id || null,
    created_by: item.createdBy || item.created_by || '',
    created_at: item.created_at || Date.now()
  };
}

function toFileDoc(item) {
  return {
    key: item.key,
    folder_id: item.folderId || item.folder_id || '',
    vessel_id: item.vesselId || item.vessel_id || '',
    name: item.name || '',
    size: item.size || '',
    created_by: item.by || item.created_by || '',
    created_at: item.at || item.created_at || Date.now(),
    drive_file_id: item.driveFileId || item.drive_file_id || '',
    excel_drive_file_id: item.excelDriveFileId || item.excel_drive_file_id || ''
  };
}

function mapVesselDoc(doc) {
  return {
    id: doc.id,
    name: doc.name,
    imo: doc.imo,
    type: doc.type,
    flag: doc.flag,
    year: doc.year,
    imageUrl: doc.image_url || '',
    created_at: doc.created_at || Date.now()
  };
}

function mapFolderDoc(doc) {
  return {
    id: doc.id,
    name: doc.name,
    vesselId: doc.vessel_id,
    parentId: doc.parent_id || null,
    createdBy: doc.created_by || '',
    created_at: doc.created_at || Date.now()
  };
}

function mapFileDoc(doc) {
  return {
    key: doc.key,
    folderId: doc.folder_id,
    vesselId: doc.vessel_id,
    name: doc.name,
    size: doc.size,
    by: doc.created_by || '',
    at: doc.created_at || Date.now(),
    driveFileId: doc.drive_file_id || '',
    excelDriveFileId: doc.excel_drive_file_id || ''
  };
}

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

// Fixed application users. Registration is disabled from backend.
const FIXED_USERS = [
  { username: 'herma', password: 'ABS2026', full_name: 'Herma', role: 'admin' },
  { username: 'herma_shipping', password: 'ABS2026', full_name: 'Herma Shipping', role: 'user' }
];

function getFixedUser(username) {
  return FIXED_USERS.find(u => u.username === normalizeUsername(username));
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

async function handleLogin(req, res, payload) {
  const username = normalizeUsername(payload.username);
  const password = String(payload.password || '');
  if (!username || !password) return sendError(res, 'Missing username or password', 400);

  // Authenticate the two approved accounts before checking any database records.
  const fixedUser = getFixedUser(username);
  if (fixedUser) {
    if (password !== fixedUser.password) return sendError(res, 'Invalid credentials', 401);
    return sendSuccess(res, { name: fixedUser.full_name, role: fixedUser.role });
  }

  if (useDb()) {
    const user = await usersCol.findOne({ username });
    if (!user) return sendError(res, 'Invalid credentials', 401);
    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return sendError(res, 'Invalid credentials', 401);
    return sendSuccess(res, { name: user.full_name, role: user.role });
  }

  const user = store.users.find(u => u.username === username);
  if (!user) return sendError(res, 'Invalid credentials', 401);
  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return sendError(res, 'Invalid credentials', 401);
  return sendSuccess(res, { name: user.full_name, role: user.role });
}

async function handleRegister(req, res, payload) {
  return sendError(res, 'Registration is disabled. Please use the approved admin or user login.', 403);
}

async function handleGetAllData(req, res) {
  if (useDb()) {
    const [vessels, folders, files] = await Promise.all([
      vesselsCol.find().toArray(),
      foldersCol.find().toArray(),
      filesCol.find().toArray()
    ]);
    return sendSuccess(res, {
      vessels: vessels.map(mapVesselDoc),
      folders: folders.map(mapFolderDoc),
      files: files.map(mapFileDoc)
    });
  }

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

async function handleSaveVessels(req, res, payload) {
  if (!Array.isArray(payload.vessels)) return sendError(res, 'Missing vessels payload', 400);

  if (useDb()) {
    const ids = payload.vessels.map(item => item.id).filter(Boolean);
    const ops = payload.vessels.map(item => ({
      updateOne: {
        filter: { id: item.id },
        update: { $set: toVesselDoc(item) },
        upsert: true
      }
    }));
    if (ops.length) await vesselsCol.bulkWrite(ops);
    if (ids.length) {
      await vesselsCol.deleteMany({ id: { $nin: ids } });
    } else {
      await vesselsCol.deleteMany({});
    }
    console.log('✓ Vessels replaced in database:', payload.vessels.length);
    return sendSuccess(res, {});
  }

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

async function handleSaveFolders(req, res, payload) {
  if (!Array.isArray(payload.folders)) return sendError(res, 'Missing folders payload', 400);

  if (useDb()) {
    const ids = payload.folders.map(item => item.id).filter(Boolean);
    const ops = payload.folders.map(item => ({
      updateOne: {
        filter: { id: item.id },
        update: { $set: toFolderDoc(item) },
        upsert: true
      }
    }));
    if (ops.length) await foldersCol.bulkWrite(ops);
    if (ids.length) {
      await foldersCol.deleteMany({ id: { $nin: ids } });
    } else {
      await foldersCol.deleteMany({});
    }
    console.log('✓ Folders replaced in database:', payload.folders.length);
    return sendSuccess(res, {});
  }

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

async function handleSaveFileMeta(req, res, payload) {
  if (!Array.isArray(payload.files)) return sendError(res, 'Missing files payload', 400);

  if (useDb()) {
    const ops = payload.files.map(item => ({
      updateOne: {
        filter: { key: item.key },
        update: { $set: toFileDoc(item) },
        upsert: true
      }
    }));
    if (ops.length) await filesCol.bulkWrite(ops);
    console.log('✓ File metadata upserted in database:', payload.files.length);
    return sendSuccess(res, {});
  }

  const existing = store.files || [];
  payload.files.forEach(item => {
    const idx = existing.findIndex(f => f.key === item.key);
    const doc = {
      key: item.key,
      folder_id: item.folderId || item.folder_id || '',
      vessel_id: item.vesselId || item.vessel_id || '',
      name: item.name || '',
      size: item.size || '',
      created_by: item.by || item.created_by || '',
      created_at: item.at || item.created_at || Date.now(),
      drive_file_id: item.driveFileId || item.drive_file_id || '',
      excel_drive_file_id: item.excelDriveFileId || item.excel_drive_file_id || ''
    };
    if (idx >= 0) {
      existing[idx] = doc;
    } else {
      existing.push(doc);
    }
  });
  store.files = existing;
  saveStore(store);
  console.log('✓ File metadata upserted in local store:', payload.files.length);
  return sendSuccess(res, {});
}

async function handleDeleteFile(req, res, payload) {
  const driveFileId = String(payload.driveFileId || '').trim();
  if (!driveFileId) return sendError(res, 'Missing driveFileId', 400);

  if (useDb()) {
    await filesCol.deleteMany({
      $or: [
        { drive_file_id: driveFileId },
        { excel_drive_file_id: driveFileId }
      ]
    });
    return sendSuccess(res, {});
  }

  store.files = store.files.filter(f => {
    const driveId = f.drive_file_id || f.driveFileId || '';
    const excelId = f.excel_drive_file_id || f.excelDriveFileId || '';
    return driveId !== driveFileId && excelId !== driveFileId;
  });
  saveStore(store);
  return sendSuccess(res, {});
}

function startServer() {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

initializeDb().then(startServer).catch(err => {
  console.error('Failed to initialize MongoDB Atlas connection:', err);
  if (MONGO_URI) {
    console.error('MONGODB_URI is configured, aborting startup until the Atlas connection is fixed.');
    process.exit(1);
  }
  startServer();
});
