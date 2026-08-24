/* ===========================================================================
   APUNTES-DB — IndexedDB para las fotos y PDF de apuntes.
   Los blobs NO viajan por el buzón de sincronización (v1): son pesados y el
   buzón tiene un tope de tamaño. Solo el TÍTULO y la fecha (registry:
   apuntesMeta) se sincronizan; el archivo en sí vive en cada aparato.
   =========================================================================== */

const DB_NOMBRE = 'meta-apuntes';
const DB_VERSION = 1;
const ALMACEN = 'blobs';

let dbProm = null;

function abrir() {
  if (dbProm) return dbProm;
  dbProm = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbProm;
}

export async function guardarBlob(id, blob, tipo) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ALMACEN, 'readwrite');
    tx.objectStore(ALMACEN).put({ id, blob, tipo });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function leerBlob(id) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ALMACEN, 'readonly');
    const req = tx.objectStore(ALMACEN).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function borrarBlob(id) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ALMACEN, 'readwrite');
    tx.objectStore(ALMACEN).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
