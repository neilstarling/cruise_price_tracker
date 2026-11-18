const CACHE_NAME = "cunard-queens-grill-v1";
const APP_ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json", "./icon.svg"];
const SHARE_DB_NAME = "cunard-queens-grill-share-inbox";
const SHARE_STORE_NAME = "shared-images";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("cunard-queens-grill-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method === "POST" && new URL(request.url).origin === self.location.origin) {
    event.respondWith(handleSharedFiles(request));
    return;
  }
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const offlinePage = await caches.match("./index.html");
        if (offlinePage) return offlinePage;
      }
      throw error;
    }
  })());
});

async function handleSharedFiles(request) {
  const formData = await request.formData();
  const files = formData.getAll("images").filter((entry) => entry instanceof File && entry.type.startsWith("image/"));
  if (!files.length) {
    return Response.redirect(new URL("./", self.registration.scope), 303);
  }

  await saveSharedFiles(files);
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  let client = clients[0];
  if (!client) client = await self.clients.openWindow(new URL("./", self.registration.scope).href);
  if (client) {
    client.postMessage({ type: "shared-images-ready" });
    if ("focus" in client) await client.focus();
  }
  return Response.redirect(new URL("./", self.registration.scope), 303);
}

function saveSharedFiles(files) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SHARE_STORE_NAME)) {
        request.result.createObjectStore(SHARE_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open the shared image inbox."));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(SHARE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(SHARE_STORE_NAME);
      files.forEach((file) => store.put({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file
      }));
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Could not save shared screenshots.")); };
      transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error("Could not save shared screenshots.")); };
    };
  });
}
