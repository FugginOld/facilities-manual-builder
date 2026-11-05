/* Photos and logos. Images live in this browser's IndexedDB (local storage is
 * too small for them); records hold only their ids. Images are shrunk before
 * saving so a phone photo is a few hundred KB. */
(function (F) {
  "use strict";

  const DB = "fmb-files", STORE = "files";
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("This browser can't store photos (IndexedDB is unavailable).")); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("This browser blocked photo storage (private window?)."));
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(st, (v) => { out = v; })).catch(reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error && t.error.name === "QuotaExceededError"
        ? new Error("The browser is out of storage space for photos. Remove some photos or export a backup and clear old buildings.")
        : t.error || new Error("Couldn't save the photo."));
    });
  };
  const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  F.files = {
    /** rec: {blob, name, type, w, h} -> id */
    put: (rec) => { const id = rec.id || uid(); return tx("readwrite", (st) => st.put({ ...rec, id, createdAt: rec.createdAt || new Date().toISOString() })).then(() => id); },
    get: (id) => tx("readonly", async (st, done) => done(await req(st.get(id)))),
    remove: (id) => tx("readwrite", (st) => st.delete(id)),
    all: () => tx("readonly", async (st, done) => done(await req(st.getAll()))),
    keys: () => tx("readonly", async (st, done) => done(await req(st.getAllKeys()))),
  };

  /** Shrink an image File to at most `max` px on its long side. PNG stays PNG (logos keep transparency). */
  F.prepareImage = async (file, max = 1600) => {
    if (!/^image\/(jpeg|png|gif|webp|bmp|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(file.name)) {
      throw new Error(`${file.name} isn't an image.`);
    }
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (e) {
      try { bmp = await createImageBitmap(file); }
      catch (e2) { throw new Error(`Couldn't read ${file.name}. iPhone HEIC photos may need to be saved as JPEG first (Settings → Camera → Formats → Most Compatible).`); }
    }
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const type = /png/i.test(file.type) ? "image/png" : "image/jpeg";
    const blob = await new Promise((resolve) => c.toBlob(resolve, type, 0.82));
    return { blob, type, w, h, name: file.name };
  };

  // object URLs for <img data-file="id"> placeholders; revoked on the next hydrate
  let urls = [];
  F.hydrateImages = async (root = document) => {
    const old = urls; urls = [];
    for (const img of root.querySelectorAll("img[data-file]")) {
      try {
        const f = await F.files.get(img.dataset.file);
        if (!f) { img.alt = "Photo missing (saved in another browser?)"; img.classList.add("missing"); continue; }
        const u = URL.createObjectURL(f.blob);
        urls.push(u);
        img.src = u;
      } catch (e) { img.alt = e.message; img.classList.add("missing"); }
    }
    old.forEach((u) => URL.revokeObjectURL(u));
  };

  /** Delete stored images nothing refers to any more. */
  F.cleanupFiles = async () => {
    try {
      const refs = F.store.fileRefs();
      for (const k of await F.files.keys()) if (!refs.has(k)) await F.files.remove(k);
    } catch (e) { /* best effort */ }
  };

  // backup helpers: Blob <-> base64
  F.blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  F.base64ToBlob = (b64, type) => {
    const bin = atob(b64), a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type });
  };
})(window.FMB);
