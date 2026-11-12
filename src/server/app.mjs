import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { AppError } from "./store.mjs";
const mutating = new Set(["POST", "PUT", "DELETE", "PATCH"]);
const nativeOrigins = new Set([
  "capacitor://localhost",
  "https://localhost",
  "http://localhost",
]);
function addresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((x) => x && x.family === "IPv4" && !x.internal)
    .map((x) => x.address);
}
export function createApp({
  store,
  webDirectory = path.resolve("dist/client"),
  uploadDirectory = path.join(store.directory, "uploads"),
  port = 3210,
  extraOrigins = [],
} = {}) {
  const networkAddresses = addresses();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  const buckets = new Map();
  let lastSweep = 0;
  function limit(req, res, next) {
    const now = store.clock();
    if (now - lastSweep > 60000) {
      for (const [key, b] of buckets) if (b.until <= now) buckets.delete(key);
      lastSweep = now;
    }
    const login = req.path === "/login" || req.path === "/setup";
    const identity = req.get("X-Visitor-Token") || "";
    const keys = [
      [
        store.hash(
          "rate:" +
            req.socket.remoteAddress +
            ":" +
            (login ? "login" : "general"),
        ),
        login ? 60 : 12000,
      ],
      ...(identity
        ? [
            [
              store.hash("visitor-rate:" + identity + ":" + req.path),
              login ? 5 : req.path.endsWith("/claim") ? 8 : 150,
            ],
          ]
        : []),
    ];
    for (const [key, max] of keys) {
      let b = buckets.get(key);
      if (!b || b.until <= now) {
        if (buckets.size >= 10000)
          return res.status(429).json({ error: "系統忙碌，請稍後再試" });
        b = { count: 0, until: now + (login ? 15 * 60000 : 60000) };
        buckets.set(key, b);
      }
      if (++b.count > max) {
        res.set("Retry-After", String(Math.ceil((b.until - now) / 1000)));
        return res.status(429).json({ error: "操作過於頻繁，請稍後重試" });
      }
    }
    next();
  }
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    if (req.secure) res.set("Strict-Transport-Security", "max-age=31536000");
    const publicOrigin = new URL(store.settings().publicUrl).origin;
    const origin = req.get("Origin");
    const allowed =
      !origin ||
      origin === publicOrigin ||
      nativeOrigins.has(origin) ||
      extraOrigins.includes(origin) ||
      origin === `http://127.0.0.1:${port}` ||
      origin === `http://localhost:${port}`;
    const host = req.get("Host");
    const allowedHosts = new Set([
      new URL(publicOrigin).host,
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      ...networkAddresses.map((a) => `${a}:${port}`),
    ]);
    if (!host || !allowedHosts.has(host))
      return res
        .status(403)
        .json({ error: "主機網址未授權，請在主機設定正確網址" });
    if (req.path.startsWith("/api/")) {
      res.set("Cache-Control", "no-store");
      if (!allowed) return res.status(403).json({ error: "已拒絕跨網站存取" });
      if (origin) {
        res.set("Access-Control-Allow-Origin", origin);
        res.vary("Origin");
        res.set(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, X-Visitor-Token, X-Ribbon-Client, X-Setup-Token",
        );
        res.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
      }
      if (req.method === "OPTIONS") return res.sendStatus(204);
      if (mutating.has(req.method) && req.get("X-Ribbon-Client") !== "1")
        return res.status(403).json({ error: "請從 Ribbon Queue 操作" });
      if (
        mutating.has(req.method) &&
        !/^application\/json(?:\s*;.*)?$/i.test(req.get("Content-Type") || "")
      )
        return res.status(415).json({ error: "請使用 JSON 格式" });
    }
    next();
  });
  app.use("/api", limit);
  app.use("/api/admin", (req, res, next) => {
    const token = (req.get("Authorization") || "").replace(/^Bearer /, "");
    if (!store.authorized(token)) {
      req.resume();
      return res.status(401).json({ error: "請先登入工作人員後台" });
    }
    next();
  });
  app.use("/api/admin/upload", express.json({ limit: "7mb" }));
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", (req, res, next) => {
    if (
      mutating.has(req.method) &&
      (!req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body) ||
        Object.keys(req.body).length > 20)
    )
      return res.status(400).json({ error: "請提供正確的資料物件" });
    next();
  });
  const wrap = (fn) => (req, res, next) => {
    try {
      const result = fn(req, res);
      if (result && typeof result.then === "function") result.catch(next);
    } catch (error) {
      next(error);
    }
  };
  const bearer = (req) =>
    (req.get("Authorization") || "").replace(/^Bearer /, "");
  const admin = (req, res, next) =>
    store.authorized(bearer(req))
      ? next()
      : res.status(401).json({ error: "請先登入工作人員後台" });
  app.get("/api/health", (req, res) =>
    res.json({ ok: true, version: "1.0.0" }),
  );
  app.get(
    "/api/public",
    wrap((req, res) => {
      const shop = store.settings();
      const events = store
        .listEvents()
        .filter((e) => e.phase !== "ended")
        .sort((a, b) => a.start - b.start);
      res.json({ shop, events, serverNow: store.clock() });
    }),
  );
  app.post(
    "/api/setup",
    wrap((req, res) =>
      res.json(
        store.setup({ ...req.body, bootstrap: req.get("X-Setup-Token") }),
      ),
    ),
  );
  app.post(
    "/api/login",
    wrap((req, res) => res.json(store.login(req.body.password))),
  );
  app.post(
    "/api/logout",
    admin,
    wrap((req, res) => {
      store.logout(bearer(req));
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/events/:eventId",
    wrap((req, res) =>
      res.json({
        shop: store.settings(),
        event: store.overview(req.params.eventId),
      }),
    ),
  );
  for (const [action, method] of [
    ["claim", "claim"],
    ["ticket", "getTicket"],
    ["choose", "change"],
  ])
    app.post(
      "/api/events/:eventId/" + action,
      wrap((req, res) => {
        const visitor = req.get("X-Visitor-Token");
        const ticket =
          method === "getTicket"
            ? store.getTicket(req.params.eventId, req.body.token, visitor)
            : store[method](req.params.eventId, req.body, visitor);
        res.json({
          ticket,
          event: store.overview(req.params.eventId),
          shop: store.settings(),
        });
      }),
    );
  app.use("/api/admin", admin);
  app.get(
    "/api/admin",
    wrap((req, res) =>
      res.json({
        shop: store.settings(),
        events: store.listEvents(),
        network: {
          addresses: addresses().map((a) => `http://${a}:${port}`),
          local: `http://127.0.0.1:${port}`,
        },
      }),
    ),
  );
  app.put(
    "/api/admin/settings",
    wrap((req, res) => res.json(store.updateSettings(req.body))),
  );
  app.post(
    "/api/admin/events",
    wrap((req, res) => res.status(201).json(store.createEvent(req.body))),
  );
  app.put(
    "/api/admin/events/:eventId",
    wrap((req, res) =>
      res.json(store.updateEvent(req.params.eventId, req.body)),
    ),
  );
  app.post(
    "/api/admin/events/:eventId/products",
    wrap((req, res) =>
      res.status(201).json(store.addProduct(req.params.eventId, req.body)),
    ),
  );
  app.get(
    "/api/admin/events/:eventId/tickets",
    wrap((req, res) =>
      res.json({ tickets: store.tickets(req.params.eventId) }),
    ),
  );
  app.post(
    "/api/admin/events/:eventId/capacity",
    wrap((req, res) => res.json(store.adjust(req.params.eventId, req.body))),
  );
  app.post(
    "/api/admin/events/:eventId/pause",
    wrap((req, res) =>
      res.json(store.setPaused(req.params.eventId, req.body.paused)),
    ),
  );
  app.post(
    "/api/admin/events/:eventId/early-open",
    wrap((req, res) => res.json(store.earlyOpen(req.params.eventId))),
  );
  app.post(
    "/api/admin/events/:eventId/call",
    wrap((req, res) => res.json(store.callNext(req.params.eventId))),
  );
  app.post(
    "/api/admin/events/:eventId/inspect",
    wrap((req, res) =>
      res.json({
        ticket: store.getTicket(req.params.eventId, req.body.token, null, true),
        event: store.overview(req.params.eventId),
      }),
    ),
  );
  app.post(
    "/api/admin/events/:eventId/admit",
    wrap((req, res) =>
      res.json({ ticket: store.admit(req.params.eventId, req.body) }),
    ),
  );
  app.post(
    "/api/admin/events/:eventId/cancel",
    wrap((req, res) =>
      res.json(store.cancel(req.params.eventId, req.body.ticketId)),
    ),
  );
  app.get(
    "/api/admin/export",
    wrap((req, res) => {
      res.attachment("ribbon-queue-config.json");
      res.json(store.exportConfiguration());
    }),
  );
  app.post(
    "/api/admin/upload",
    wrap((req, res) => {
      const { data } = req.body;
      let bytes;
      try {
        if (typeof data !== "string" || data.length > 7 * 1024 * 1024)
          throw Error();
        bytes = Buffer.from(data, "base64");
      } catch {
        throw new AppError(400, "圖片內容無效");
      }
      if (bytes.length > 5 * 1024 * 1024)
        throw new AppError(413, "圖片請小於 5 MB");
      const extension = bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "png"
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? "jpg"
          : bytes.toString("ascii", 0, 4) === "RIFF" &&
              bytes.toString("ascii", 8, 12) === "WEBP"
            ? "webp"
            : null;
      if (!extension) throw new AppError(400, "僅接受 PNG、JPEG 或 WebP 圖片");
      fs.mkdirSync(uploadDirectory, { recursive: true, mode: 0o700 });
      const name =
        createHash("sha256").update(bytes).digest("hex") + "." + extension;
      fs.writeFileSync(path.join(uploadDirectory, name), bytes, {
        mode: 0o600,
      });
      res.json({ image: "/uploads/" + name });
    }),
  );
  app.use(
    "/uploads",
    express.static(uploadDirectory, {
      dotfiles: "deny",
      immutable: true,
      maxAge: "1d",
      setHeaders: (res) => res.set("X-Content-Type-Options", "nosniff"),
    }),
  );
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "找不到此操作" }),
  );
  app.use(
    express.static(webDirectory, {
      dotfiles: "deny",
      setHeaders: (res, file) =>
        res.set(
          "Cache-Control",
          file.endsWith("index.html") ? "no-store" : "public, max-age=3600",
        ),
    }),
  );
  app.get("/", (req, res) =>
    res.sendFile(path.join(webDirectory, "index.html")),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      error instanceof AppError
        ? error.status
        : error.type === "entity.too.large"
          ? 413
          : error instanceof SyntaxError
            ? 400
            : 500;
    if (status >= 500) console.error("Request failed:", error.message);
    res
      .status(status)
      .json({
        error:
          status >= 500
            ? "服務暫時無法使用，請保留畫面並重試"
            : error instanceof AppError
              ? error.message
              : status === 413
                ? "資料超過允許大小"
                : "內容格式不正確",
      });
  });
  return app;
}
