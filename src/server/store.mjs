import initSqlJs from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  randomBytes,
  randomUUID,
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
const require = createRequire(import.meta.url);
const HEX = /^[a-f0-9]{64}$/;
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function demand(condition, status, message) {
  if (!condition) throw new AppError(status, message);
}
function text(value, max, label) {
  demand(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= max,
    400,
    label + "格式不正確",
  );
  return value.trim();
}
function integer(value, min, max, label) {
  demand(
    Number.isSafeInteger(value) && value >= min && value <= max,
    400,
    label + "必須是 " + min + "–" + max + " 的整數",
  );
  return value;
}
function safeEqual(a, b) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  return salt + ":" + scryptSync(password, salt, 32).toString("hex");
}
function validPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 10 &&
    password.length <= 128
  );
}
export function normalizePublicUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new AppError(400, "主機網址不正確");
  }
  demand(
    ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      (u.pathname === "/" || u.pathname === ""),
    400,
    "請輸入 http 或 https 主機網址，不含路徑、帳密或參數",
  );
  const local =
    u.hostname === "localhost" ||
    u.hostname === "127.0.0.1" ||
    u.hostname === "[::1]" ||
    /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(u.hostname) ||
    u.hostname.endsWith(".local");
  demand(
    u.protocol === "https:" || local,
    400,
    "公開網路主機請使用 HTTPS；HTTP 僅供區域網路使用",
  );
  return u.origin;
}
function dates(input) {
  const start = integer(input.start, 0, 8640000000000000, "開始時間"),
    end = integer(input.end, 0, 8640000000000000, "結束時間"),
    expires = integer(input.expires, 0, 8640000000000000, "失效時間");
  demand(
    end > start &&
      end - start <= 14 * 86400000 &&
      expires > end &&
      expires - end <= 7 * 86400000,
    400,
    "活動結束須晚於開始，票券失效須晚於結束",
  );
  return { start, end, expires };
}
function phaseOf(event, now) {
  const opening = event.early_at ?? event.start;
  return now < opening
    ? "upcoming"
    : now < event.end
      ? "open"
      : now < event.expires
        ? "settling"
        : "ended";
}
export class QueueStore {
  static async open({
    directory,
    clock = Date.now,
    defaultPublicUrl = "http://127.0.0.1:3210",
    memory = false,
  } = {}) {
    const SQL = await initSqlJs({
      wasmBinary: fs.readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm")),
    });
    const store = new QueueStore();
    Object.assign(store, {
      SQL,
      clock,
      memory,
      directory: directory || path.resolve("data"),
    });
    if (!memory)
      fs.mkdirSync(store.directory, { recursive: true, mode: 0o700 });
    store.filename = path.join(store.directory, "queue.sqlite");
    const secretPath = path.join(store.directory, "host-secret.json");
    if (!memory && fs.existsSync(secretPath)) {
      const config = JSON.parse(fs.readFileSync(secretPath, "utf8"));
      demand(
        HEX.test(config.secret) && HEX.test(config.bootstrap),
        500,
        "主機金鑰檔案損壞；請還原資料備份",
      );
      store.secret = config.secret;
      store.bootstrap = config.bootstrap;
    } else {
      store.secret = randomBytes(32).toString("hex");
      store.bootstrap = randomBytes(32).toString("hex");
      if (!memory)
        fs.writeFileSync(
          secretPath,
          JSON.stringify({ secret: store.secret, bootstrap: store.bootstrap }),
          { mode: 0o600, flag: "wx" },
        );
    }
    store.db = new SQL.Database(
      !memory && fs.existsSync(store.filename)
        ? fs.readFileSync(store.filename)
        : undefined,
    );
    store.db.exec(`PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),name TEXT NOT NULL,timezone TEXT NOT NULL,public_url TEXT NOT NULL,accent TEXT NOT NULL,password_hash TEXT);
   CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,title TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,expires INTEGER NOT NULL,early_at INTEGER,paused INTEGER NOT NULL DEFAULT 0,called INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),name TEXT NOT NULL,length TEXT NOT NULL DEFAULT '',image TEXT NOT NULL DEFAULT '',capacity INTEGER NOT NULL CHECK(capacity>=0 AND capacity<=10000));
   CREATE INDEX IF NOT EXISTS product_events ON products(event_id);
   CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),no INTEGER NOT NULL,claim_hash TEXT NOT NULL UNIQUE,browser_hash TEXT NOT NULL,product_id TEXT NOT NULL REFERENCES products(id),changes INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'waiting',UNIQUE(event_id,no),UNIQUE(event_id,browser_hash));
   CREATE INDEX IF NOT EXISTS ticket_product ON tickets(product_id);
   CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,kind TEXT NOT NULL,payload_hash TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL);
   PRAGMA user_version=1;`);
    if (!store.one("SELECT id FROM settings"))
      store.run("INSERT INTO settings VALUES(1,?,?,?,?,NULL)", [
        "Ribbon Queue",
        "Asia/Taipei",
        normalizePublicUrl(defaultPublicUrl),
        "#15564b",
      ]);
    store.persist();
    return store;
  }
  all(sql, args = []) {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(args);
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }
  one(sql, args = []) {
    return this.all(sql, args)[0] || null;
  }
  run(sql, args = []) {
    this.db.run(sql, args);
    return this.db.getRowsModified();
  }
  hash(value) {
    return createHmac("sha256", this.secret).update(value).digest("hex");
  }
  persist() {
    if (this.memory) return;
    const file = this.filename + ".tmp";
    const handle = fs.openSync(file, "w", 0o600);
    try {
      fs.writeFileSync(handle, Buffer.from(this.db.export()));
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(file, this.filename);
  }
  transaction(fn) {
    const before = this.db.export();
    this.db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      this.persist();
      return result;
    } catch (error) {
      this.db.close();
      this.db = new this.SQL.Database(before);
      this.db.exec("PRAGMA foreign_keys=ON");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  settings() {
    const s = this.one(
      "SELECT name,timezone,public_url,accent,password_hash FROM settings WHERE id=1",
    );
    return {
      name: s.name,
      timezone: s.timezone,
      publicUrl: s.public_url,
      accent: s.accent,
      setupRequired: !s.password_hash,
    };
  }
  setup({ bootstrap, password, name, publicUrl }) {
    demand(this.settings().setupRequired, 409, "主機已完成設定，請登入");
    demand(
      typeof bootstrap === "string" && safeEqual(bootstrap, this.bootstrap),
      403,
      "請使用主機畫面提供的首次設定連結",
    );
    demand(validPassword(password), 400, "通行碼請設定為 10–128 個字元");
    return this.transaction(() => {
      this.run(
        "UPDATE settings SET name=?,public_url=?,password_hash=? WHERE id=1",
        [
          text(name, 80, "店名"),
          normalizePublicUrl(publicUrl),
          passwordHash(password),
        ],
      );
      return this.settings();
    });
  }
  updateSettings(input) {
    return this.transaction(() => {
      const previous = this.settings();
      const timezone = input.timezone ?? previous.timezone;
      try {
        new Intl.DateTimeFormat("zh-TW", { timeZone: timezone });
      } catch {
        throw new AppError(400, "時區不正確");
      }
      const accent = input.accent ?? previous.accent;
      demand(/^#[a-f0-9]{6}$/i.test(accent), 400, "品牌色格式不正確");
      this.run(
        "UPDATE settings SET name=?,timezone=?,public_url=?,accent=? WHERE id=1",
        [
          text(input.name ?? previous.name, 80, "店名"),
          timezone,
          normalizePublicUrl(input.publicUrl ?? previous.publicUrl),
          accent,
        ],
      );
      if (input.newPassword !== undefined) {
        demand(
          validPassword(input.newPassword),
          400,
          "通行碼請設定為 10–128 個字元",
        );
        this.run("UPDATE settings SET password_hash=? WHERE id=1", [
          passwordHash(input.newPassword),
        ]);
        this.run("DELETE FROM sessions");
      }
      return this.settings();
    });
  }
  login(password) {
    demand(
      typeof password === "string" && password.length <= 128,
      401,
      "通行碼不正確",
    );
    const saved = this.one(
      "SELECT password_hash FROM settings WHERE id=1",
    )?.password_hash;
    demand(saved, 409, "請先完成主機設定");
    const salt = saved.split(":")[0];
    demand(safeEqual(passwordHash(password, salt), saved), 401, "通行碼不正確");
    const token = randomBytes(32).toString("hex");
    this.transaction(() =>
      this.run("INSERT INTO sessions VALUES(?,?)", [
        this.hash("staff:" + token),
        this.clock() + 8 * 3600000,
      ]),
    );
    return { token, expires: this.clock() + 8 * 3600000 };
  }
  authorized(token) {
    return (
      typeof token === "string" &&
      HEX.test(token) &&
      !!this.one("SELECT 1 FROM sessions WHERE token_hash=? AND expires>?", [
        this.hash("staff:" + token),
        this.clock(),
      ])
    );
  }
  logout(token) {
    if (typeof token === "string")
      this.transaction(() =>
        this.run("DELETE FROM sessions WHERE token_hash=?", [
          this.hash("staff:" + token),
        ]),
      );
  }
  event(id) {
    const event = this.one("SELECT * FROM events WHERE id=?", [id]);
    demand(event, 404, "找不到此活動");
    return event;
  }
  product(eventId, productId) {
    const product = this.one(
      "SELECT * FROM products WHERE event_id=? AND id=?",
      [eventId, productId],
    );
    demand(product, 400, "請選擇此活動的款式");
    return product;
  }
  overview(id) {
    const event = this.event(id),
      phase = phaseOf(event, this.clock()),
      expired = phase === "ended";
    const counts = expired
      ? []
      : this.all(
          "SELECT product_id,COUNT(*) issued,SUM(status='waiting') waiting,SUM(status='admitted') admitted,SUM(status='cancelled') cancelled FROM tickets WHERE event_id=? GROUP BY product_id",
          [id],
        );
    const products = this.all(
      "SELECT id,name,length,image,capacity FROM products WHERE event_id=? ORDER BY rowid",
      [id],
    ).map((p) => {
      const c = counts.find((x) => x.product_id === p.id) || {
        issued: 0,
        waiting: 0,
        admitted: 0,
        cancelled: 0,
      };
      return {
        ...p,
        issued: c.issued,
        waiting: c.waiting,
        admitted: c.admitted,
        cancelled: c.cancelled,
        remaining: Math.max(0, p.capacity - c.issued),
      };
    });
    const sum = (field) => products.reduce((n, p) => n + p[field], 0);
    return {
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      expires: event.expires,
      earlyAt: event.early_at,
      phase,
      open: phase === "open" && !event.paused,
      paused: !!event.paused,
      called: expired ? 0 : event.called,
      capacity: sum("capacity"),
      issued: sum("issued"),
      remaining: sum("remaining"),
      waiting: sum("waiting"),
      admitted: sum("admitted"),
      cancelled: sum("cancelled"),
      products,
      serverNow: this.clock(),
    };
  }
  listEvents() {
    return this.all("SELECT id FROM events ORDER BY start DESC LIMIT 100").map(
      (e) => this.overview(e.id),
    );
  }
  productInput(input) {
    const image = input.image || "";
    demand(
      image === "" || /^\/uploads\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(image),
      400,
      "圖片網址不正確",
    );
    return {
      name: text(input.name, 80, "款式名稱"),
      length:
        typeof input.length === "string"
          ? input.length.trim().slice(0, 32)
          : "",
      image,
      capacity: integer(input.capacity, 0, 10000, "名額"),
    };
  }
  createEvent(input) {
    const date = dates(input);
    demand(
      Array.isArray(input.products) &&
        input.products.length >= 1 &&
        input.products.length <= 20,
      400,
      "每場請設定 1–20 款",
    );
    const products = input.products.map((p) => this.productInput(p)),
      id = randomUUID();
    return this.transaction(() => {
      this.run(
        "INSERT INTO events(id,title,start,end,expires,created) VALUES(?,?,?,?,?,?)",
        [
          id,
          text(input.title, 100, "活動名稱"),
          date.start,
          date.end,
          date.expires,
          this.clock(),
        ],
      );
      for (const p of products)
        this.run("INSERT INTO products VALUES(?,?,?,?,?,?)", [
          randomUUID(),
          id,
          p.name,
          p.length,
          p.image,
          p.capacity,
        ]);
      return this.overview(id);
    });
  }
  updateEvent(id, input) {
    const e = this.event(id),
      date = dates({ ...e, ...input });
    return this.transaction(() => {
      this.run("UPDATE events SET title=?,start=?,end=?,expires=? WHERE id=?", [
        text(input.title ?? e.title, 100, "活動名稱"),
        date.start,
        date.end,
        date.expires,
        id,
      ]);
      return this.overview(id);
    });
  }
  addProduct(id, input) {
    const e = this.event(id);
    demand(phaseOf(e, this.clock()) !== "ended", 409, "此活動票券已失效");
    demand(
      this.one("SELECT COUNT(*) n FROM products WHERE event_id=?", [id]).n < 20,
      400,
      "每場最多 20 款",
    );
    const p = this.productInput(input);
    return this.transaction(() => {
      this.run("INSERT INTO products VALUES(?,?,?,?,?,?)", [
        randomUUID(),
        id,
        p.name,
        p.length,
        p.image,
        p.capacity,
      ]);
      return this.overview(id);
    });
  }
  operate(eventId, kind, requestId, payload, fn) {
    demand(
      typeof requestId === "string" && /^[a-f0-9]{32}$/.test(requestId),
      400,
      "操作代碼不正確，請重試",
    );
    const fingerprint = this.hash(JSON.stringify({ eventId, kind, payload }));
    return this.transaction(() => {
      const previous = this.one("SELECT * FROM operations WHERE id=?", [
        requestId,
      ]);
      if (previous) {
        demand(
          previous.event_id === eventId &&
            previous.kind === kind &&
            previous.payload_hash === fingerprint,
          409,
          "此操作代碼已使用",
        );
        return JSON.parse(previous.result);
      }
      const result = fn();
      this.run("INSERT INTO operations VALUES(?,?,?,?,?,?)", [
        requestId,
        eventId,
        kind,
        fingerprint,
        JSON.stringify(result),
        this.clock(),
      ]);
      return result;
    });
  }
  adjust(id, { productId, delta, requestId }) {
    const event = this.event(id);
    demand(phaseOf(event, this.clock()) !== "ended", 409, "此活動票券已失效");
    integer(delta, -1000, 1000, "調整數量");
    demand(delta !== 0, 400, "數量不能為 0");
    this.operate(id, "capacity", requestId, { productId, delta }, () => {
      const p = this.product(id, productId),
        issued = this.one("SELECT COUNT(*) n FROM tickets WHERE product_id=?", [
          productId,
        ]).n,
        newCapacity = p.capacity + delta;
      demand(
        newCapacity >= issued && newCapacity >= 0 && newCapacity <= 10000,
        409,
        "只能減少未領出的名額，不能低於已發票券數",
      );
      const total = this.one(
        "SELECT SUM(capacity) n FROM products WHERE event_id=?",
        [id],
      ).n;
      const last = this.one(
        "SELECT COALESCE(MAX(no),0) n FROM tickets WHERE event_id=?",
        [id],
      ).n;
      demand(total + delta >= last, 409, "本場總名額不能低於已發號碼");
      this.run("UPDATE products SET capacity=? WHERE id=?", [
        newCapacity,
        productId,
      ]);
      return { ok: true };
    });
    return this.overview(id);
  }
  setPaused(id, paused) {
    demand(typeof paused === "boolean", 400, "暫停設定格式不正確");
    const event = this.event(id);
    demand(phaseOf(event, this.clock()) !== "ended", 409, "活動已結束");
    return this.transaction(() => {
      this.run("UPDATE events SET paused=? WHERE id=?", [paused ? 1 : 0, id]);
      return this.overview(id);
    });
  }
  earlyOpen(id) {
    const event = this.event(id);
    demand(this.clock() < event.end, 409, "領號已結束，請先調整活動時間");
    return this.transaction(() => {
      this.run("UPDATE events SET early_at=?,paused=0 WHERE id=?", [
        Math.min(event.start, this.clock()),
        id,
      ]);
      return this.overview(id);
    });
  }
  visitorHash(eventId, visitor) {
    demand(
      typeof visitor === "string" && HEX.test(visitor),
      400,
      "瀏覽器識別碼無效，請重新整理",
    );
    return this.hash("visitor:" + eventId + ":" + visitor);
  }
  claimHash(eventId, token) {
    demand(typeof token === "string" && HEX.test(token), 400, "票券代碼不完整");
    return this.hash("claim:" + eventId + ":" + token);
  }
  ticketView(t) {
    return {
      id: t.id,
      eventId: t.event_id,
      no: t.no,
      productId: t.product_id,
      changes: t.changes,
      status: t.status,
    };
  }
  validTicket(eventId, token, visitor, staff = false) {
    const event = this.event(eventId);
    demand(this.clock() < event.expires, 410, "此票券已失效");
    const t = this.one(
      "SELECT * FROM tickets WHERE event_id=? AND claim_hash=?",
      [eventId, this.claimHash(eventId, token)],
    );
    demand(t, 404, "找不到票券，或票券已失效");
    if (!staff)
      demand(
        t.browser_hash === this.visitorHash(eventId, visitor),
        403,
        "請使用領號時的原瀏覽器；入場請向工作人員出示 QR Code",
      );
    return t;
  }
  getTicket(eventId, token, visitor, staff = false) {
    return this.ticketView(this.validTicket(eventId, token, visitor, staff));
  }
  claim(eventId, { token, productId }, visitor) {
    const browserHash = this.visitorHash(eventId, visitor),
      claimHash = this.claimHash(eventId, token);
    return this.transaction(() => {
      const event = this.event(eventId),
        existing = this.one("SELECT * FROM tickets WHERE claim_hash=?", [
          claimHash,
        ]);
      if (existing) {
        demand(this.clock() < event.expires, 410, "此票券已失效");
        demand(existing.browser_hash === browserHash, 403, "請使用原瀏覽器");
        return this.ticketView(existing);
      }
      demand(
        phaseOf(event, this.clock()) === "open" && !event.paused,
        409,
        "目前未開放領號，請確認活動時間",
      );
      demand(
        !this.one("SELECT 1 FROM tickets WHERE event_id=? AND browser_hash=?", [
          eventId,
          browserHash,
        ]),
        409,
        "本瀏覽器已領過本場號碼牌，請回原票券頁",
      );
      const product = this.product(eventId, productId),
        issued = this.one("SELECT COUNT(*) n FROM tickets WHERE product_id=?", [
          productId,
        ]).n;
      demand(issued < product.capacity, 409, "此款已額滿，請選擇其他款式");
      const no = this.one(
        "SELECT COALESCE(MAX(no),0)+1 n FROM tickets WHERE event_id=?",
        [eventId],
      ).n;
      const id = randomUUID();
      this.run(
        "INSERT INTO tickets(id,event_id,no,claim_hash,browser_hash,product_id,changes,status) VALUES(?,?,?,?,?,?,0,?)",
        [id, eventId, no, claimHash, browserHash, productId, "waiting"],
      );
      return this.ticketView(
        this.one("SELECT * FROM tickets WHERE id=?", [id]),
      );
    });
  }
  change(eventId, { token, productId }, visitor) {
    return this.transaction(() => {
      const t = this.validTicket(eventId, token, visitor),
        p = this.product(eventId, productId);
      demand(t.status === "waiting", 409, "票券已核銷或取消，不能改款");
      if (t.product_id === productId) return this.ticketView(t);
      demand(t.changes === 0, 409, "每張票只能成功改選一次");
      demand(
        this.one("SELECT COUNT(*) n FROM tickets WHERE product_id=?", [
          productId,
        ]).n < p.capacity,
        409,
        "目標款式已額滿，原票與改選機會保留",
      );
      this.run("UPDATE tickets SET product_id=?,changes=1 WHERE id=?", [
        productId,
        t.id,
      ]);
      return this.ticketView(
        this.one("SELECT * FROM tickets WHERE id=?", [t.id]),
      );
    });
  }
  admit(eventId, { token, productId, changes }) {
    return this.transaction(() => {
      const t = this.validTicket(eventId, token, null, true);
      demand(
        t.status === "waiting" &&
          t.product_id === productId &&
          t.changes === changes,
        409,
        "票券已使用、取消或改款，請重新查驗",
      );
      this.run("UPDATE tickets SET status='admitted' WHERE id=?", [t.id]);
      return this.ticketView({ ...t, status: "admitted" });
    });
  }
  cancel(eventId, ticketId) {
    return this.transaction(() => {
      demand(this.clock() < this.event(eventId).expires, 410, "本場已失效");
      const t = this.one("SELECT * FROM tickets WHERE id=? AND event_id=?", [
        ticketId,
        eventId,
      ]);
      demand(t && t.status === "waiting", 409, "只能取消尚未核銷的本場票券");
      this.run("UPDATE tickets SET status='cancelled' WHERE id=?", [ticketId]);
      return { ok: true };
    });
  }
  callNext(id) {
    return this.transaction(() => {
      const event = this.event(id);
      demand(this.clock() < event.expires, 410, "本場已失效");
      const next = this.one(
        "SELECT MIN(no) n FROM tickets WHERE event_id=? AND status='waiting' AND no>?",
        [id, event.called],
      );
      if (next?.n)
        this.run("UPDATE events SET called=? WHERE id=?", [next.n, id]);
      return this.overview(id);
    });
  }
  tickets(id) {
    const e = this.event(id);
    return this.clock() >= e.expires
      ? []
      : this.all("SELECT * FROM tickets WHERE event_id=? ORDER BY no", [
          id,
        ]).map((t) => this.ticketView(t));
  }
  purgeExpired() {
    const expired = this.one(
      "SELECT COUNT(*) n FROM tickets WHERE event_id IN(SELECT id FROM events WHERE expires<=?)",
      [this.clock()],
    ).n;
    const oldSessions = this.one(
      "SELECT COUNT(*) n FROM sessions WHERE expires<=?",
      [this.clock()],
    ).n;
    if (!expired && !oldSessions) return;
    this.transaction(() => {
      this.run(
        "DELETE FROM tickets WHERE event_id IN(SELECT id FROM events WHERE expires<=?)",
        [this.clock()],
      );
      this.run("DELETE FROM sessions WHERE expires<=?", [this.clock()]);
      this.run(
        "DELETE FROM operations WHERE event_id IN(SELECT id FROM events WHERE expires<=?)",
        [this.clock() - 86400000],
      );
    });
  }
  exportConfiguration() {
    return {
      format: "ribbon-queue-config-v1",
      shop: this.settings(),
      events: this.listEvents().map((e) => ({
        title: e.title,
        start: e.start,
        end: e.end,
        expires: e.expires,
        products: e.products.map((p) => ({
          name: p.name,
          length: p.length,
          capacity: p.capacity,
        })),
      })),
    };
  }
}
