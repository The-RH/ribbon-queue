import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const root = path.resolve("dist/client");
const assets = fs
  .readdirSync(path.join(root, "assets"))
  .map((name) => "/assets/" + name);
const files = [
  "/",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  ...assets,
];
const hash = createHash("sha256")
  .update(files.join("|"))
  .digest("hex")
  .slice(0, 12);
fs.writeFileSync(
  path.join(root, "sw.js"),
  `const CACHE='ribbon-shell-${hash}',FILES=${JSON.stringify(files)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ribbon-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/')||!FILES.includes(u.pathname))return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request).then(r=>r||Response.error())));});`,
);
console.log(
  "Generated shell-only service worker; API and ticket data are never cached.",
);
