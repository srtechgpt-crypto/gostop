"use strict";

const VERSION = "58226b75113f";
const FILES = {
  ".nojekyll": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "fonts/BlackHanSans.woff2": "022fad8d34afabcca74e26a8be5e5c3f167ebe368f9688bbd1b95666839690dc",
  "fonts/OFL.txt": "c324192c8b3a988bae45a9a7e4ac1258b684739003bda114e0523423440457c9",
  "icons/icon-192.png": "f05ba63c2710e0d319dbe8777802581a456fc3fb24db4c422bd64932f453acb9",
  "icons/icon-512.png": "c1c5795d98fea16ab4825d63beab2e31b85cafa35c55e75c67e7ca23ca7e9541",
  "icons/icon-maskable-512.png": "e2402c529cd055c0f0775aa8c3f979d4d30ec6948afa8ef8dc1a2d9a831f0a52",
  "index.html": "f8ffd4cb69745ca3a2c5ac0ae8de69e70306216509dffe8293cb97e32555c432",
  "manifest.webmanifest": "48b8f8411cd4466d2de322c255ddf0b3a108120e51c05a988d0b57ff1855f84f"
};
const CACHE_NAME = "gostop-" + VERSION;
const fileURL = name => new URL(name, self.registration.scope).href;
let firstInstall = false;

self.addEventListener("install", event => {
  firstInstall = !self.registration.active;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      // Sequential writes ensure no unfinished fetch can recreate a failed cache.
      for (const [name, expected] of Object.entries(FILES)) {
        const url = fileURL(name);
        const response = await fetch(url, {cache: "reload"});
        if (!response.ok || response.type === "opaque" || response.url !== url) {
          throw new Error("파일 응답 실패: " + name);
        }
        const digest = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
        const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        if (actual !== expected) throw new Error("SHA-256 불일치: " + name);
        await cache.put(url, response);
      }
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("gostop-") && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    if (firstInstall) await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(event.request.mode === "navigate" ? fileURL("index.html") : event.request);
    return response || fetch(event.request);
  })());
});

self.addEventListener("message", event => {
  const reply = data => {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(data);
  };
  if (event.data === "status") {
    event.waitUntil((async () => {
      try {
        let ready = await caches.has(CACHE_NAME);
        if (ready) {
          const cache = await caches.open(CACHE_NAME);
          for (const name of Object.keys(FILES)) {
            if (!await cache.match(fileURL(name))) { ready = false; break; }
          }
        }
        reply({ready, version: VERSION});
      } catch (_) {
        reply({ready: false, version: VERSION});
      }
    })());
  } else if (event.data === "apply") {
    event.waitUntil((async () => {
      try {
        // A waiting worker controls no windows yet, so include uncontrolled
        // clients and count only windows inside this registration's scope.
        const windows = (await self.clients.matchAll({type: "window", includeUncontrolled: true}))
          .filter(client => client.url.startsWith(self.registration.scope));
        if (windows.length !== 1) {
          reply({applied: false, reason: "window-count", windows: windows.length});
          return;
        }
        await self.skipWaiting();
        reply({applied: true, version: VERSION});
      } catch (_) {
        reply({applied: false, reason: "apply-failed"});
      }
    })());
  }
});
