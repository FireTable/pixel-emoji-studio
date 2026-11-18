const STORE = "generations";

export interface Generation {
  prompt: string;
  createdAt: number;
  pixels: Uint8ClampedArray<ArrayBuffer>[];
}

export interface HistoryEntry extends Generation {
  id: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("emoji-studio", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      let value: T;
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(transaction.error ?? new Error("History transaction stopped"));
      work(transaction.objectStore(STORE), (result) => { value = result; });
    });
  } finally {
    db.close();
  }
}

export function saveGeneration(entry: Generation): Promise<void> {
  return withStore("readwrite", (store, done) => {
    store.add(entry);
    done(undefined);
  });
}

export function readHistory(limit: number): Promise<HistoryEntry[]> {
  return withStore("readonly", (store, done) => {
    const entries: HistoryEntry[] = [];
    const request = store.openCursor(null, "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || entries.length >= limit) {
        done(entries);
        return;
      }
      entries.push(cursor.value);
      cursor.continue();
    };
  });
}
