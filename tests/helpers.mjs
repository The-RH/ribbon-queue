import { QueueStore } from "../src/server/store.mjs";
import { createApp } from "../src/server/app.mjs";
import { randomBytes } from "node:crypto";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
export const token = () => randomBytes(32).toString("hex"),
  requestId = () => randomBytes(16).toString("hex");
export async function parallelRequests(items, work, connections = 64) {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(connections, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        result[i] = await work(items[i], i);
      }
    }),
  );
  return result;
}
export const password = "local-tests-only-password";
export const initialNow = Date.parse("2026-11-13T14:00:00+08:00");
export async function fixture(t, { persistent = false } = {}) {
  let now = initialNow;
  const directory = path.resolve(".work", "tests", requestId());
  fs.mkdirSync(directory, { recursive: true });
  const store = await QueueStore.open({
    memory: !persistent,
    directory,
    clock: () => now,
  });
  store.setup({
    bootstrap: store.bootstrap,
    password,
    name: "示範店家",
    publicUrl: "http://127.0.0.1:3210",
  });
  let app;
  const server = http.createServer((req, res) => app(req, res));
  await new Promise((resolve) =>
    server.listen({ port: 0, host: "127.0.0.1", backlog: 2048 }, resolve),
  );
  const port = server.address().port;
  store.updateSettings({ publicUrl: `http://127.0.0.1:${port}` });
  app = createApp({
    store,
    port,
    uploadDirectory: path.join(directory, "uploads"),
  });
  const origin = `http://127.0.0.1:${port}`;
  class Client {
    visitor = token();
    staff = "";
    async request(endpoint, body, headers = {}, method) {
      const response = await fetch(origin + "/api" + endpoint, {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: {
          Origin: origin,
          "X-Ribbon-Client": "1",
          "X-Visitor-Token": this.visitor,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(this.staff ? { Authorization: "Bearer " + this.staff } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }).catch((error) => {
        throw new Error(
          "HTTP transport " +
            (error.cause?.code || error.cause?.message || error.message),
          { cause: error },
        );
      });
      let data;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      return { status: response.status, data, headers: response.headers };
    }
    async login() {
      const r = await this.request("/login", { password });
      if (r.status !== 200) throw Error(JSON.stringify(r));
      this.staff = r.data.token;
      return this;
    }
  }
  const worker = await new Client().login();
  const makeEvent = (overrides = {}) =>
    store.createEvent({
      title: "週末飄帶",
      start: now - 1000,
      end: now + 3600000,
      expires: now + 7200000,
      products: [
        { name: "款式 A", length: "67cm", capacity: 15 },
        { name: "款式 B", capacity: 15 },
        { name: "款式 C", capacity: 15 },
        { name: "蝴蝶結", capacity: 8 },
      ],
      ...overrides,
    });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    const relative = path.relative(path.resolve(".work/tests"), directory);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative))
      fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    store,
    worker,
    Client,
    origin,
    directory,
    makeEvent,
    setNow(value) {
      now = value;
    },
    get now() {
      return now;
    },
  };
}
