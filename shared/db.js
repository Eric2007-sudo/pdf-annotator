// IndexedDB 封装。数据库版本变更统一走 migrate()。
// 三张表：
//   documents   {id, type, title, url, meta, createdAt, lastOpenedAt}
//   annotations {id, docId, anchor, color, note, tags, quote, createdAt, updatedAt}
//   notes       {id, docId, locator, body, createdAt, updatedAt}

const DB_NAME = "pdf-annotator";
const DB_VERSION = 2;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const oldVersion = e.oldVersion;

      if (oldVersion < 1) {
        const docs = db.createObjectStore("documents", { keyPath: "id" });
        docs.createIndex("by_lastOpened", "lastOpenedAt");
        docs.createIndex("by_type", "type");

        const anns = db.createObjectStore("annotations", { keyPath: "id" });
        anns.createIndex("by_doc", "docId");

        const notes = db.createObjectStore("notes", { keyPath: "id" });
        notes.createIndex("by_doc", "docId");
      }
      if (oldVersion < 2) {
        // v2: 为 annotations 增加 quote 前缀索引（用于文本兜底匹配）
        const anns = req.transaction.objectStore("annotations");
        if (!anns.indexNames.contains("by_doc_quote")) {
          anns.createIndex("by_doc_quote", ["docId", "quote"]);
        }
      }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, stores, mode) {
  return db.transaction(stores, mode);
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(store, value) {
  const db = await openDB();
  return wrap(tx(db, store, "readwrite").objectStore(store).put(value));
}

export async function get(store, key) {
  const db = await openDB();
  return wrap(tx(db, store, "readonly").objectStore(store).get(key));
}

export async function del(store, key) {
  const db = await openDB();
  return wrap(tx(db, store, "readwrite").objectStore(store).delete(key));
}

export async function all(store) {
  const db = await openDB();
  return wrap(tx(db, store, "readonly").objectStore(store).getAll());
}

export async function byIndex(store, index, query) {
  const db = await openDB();
  return wrap(tx(db, store, "readonly").objectStore(store).index(index).getAll(query));
}

export async function clearStore(store) {
  const db = await openDB();
  return wrap(tx(db, store, "readwrite").objectStore(store).clear());
}

/* ---------- 领域操作 ---------- */

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

export async function getDocument(id) {
  return get("documents", id);
}

export async function listDocuments() {
  const docs = await all("documents");
  return docs.sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
}

export async function upsertDocument(doc) {
  const now = Date.now();
  const existing = await getDocument(doc.id);
  const merged = {
    createdAt: existing?.createdAt || now,
    ...existing,
    ...doc,
    lastOpenedAt: now,
  };
  await put("documents", merged);
  return merged;
}

export async function listAnnotations(docId) {
  return byIndex("annotations", "by_doc", docId);
}

export async function addAnnotation(a) {
  const now = Date.now();
  const ann = { id: a.id || uid(), createdAt: now, updatedAt: now, color: "yellow", note: "", tags: [], ...a };
  await put("annotations", ann);
  return ann;
}

export async function updateAnnotation(id, patch) {
  const existing = await get("annotations", id);
  if (!existing) return null;
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  await put("annotations", next);
  return next;
}

export async function removeAnnotation(id) {
  return del("annotations", id);
}

export async function listNotes(docId) {
  return byIndex("notes", "by_doc", docId);
}

export async function addNote(n) {
  const now = Date.now();
  const note = { id: n.id || uid(), createdAt: now, updatedAt: now, ...n };
  await put("notes", note);
  return note;
}

export async function updateNote(id, patch) {
  const existing = await get("notes", id);
  if (!existing) return null;
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  await put("notes", next);
  return next;
}

export async function removeNote(id) {
  return del("notes", id);
}
