import { Capacitor, CapacitorHttp } from "@capacitor/core";
export const native = Capacitor.isNativePlatform();
let base = native ? localStorage.getItem("rq.server") || "" : location.origin,
  staffToken = "";
export function serverBase() {
  return base;
}
export function setServer(value: string) {
  const u = new URL(value);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw Error("請輸入主機網址，不含路徑或帳密");
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
    /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(u.hostname) ||
    u.hostname.endsWith(".local");
  if (u.protocol !== "https:" && !local)
    throw Error("公開網路主機請使用 HTTPS；HTTP 僅供區域網路使用");
  base = u.origin;
  staffToken = "";
  localStorage.setItem("rq.server", base);
}
export function loginToken(token: string) {
  staffToken = token;
}
export function isLoggedIn() {
  return !!staffToken;
}
export function randomToken(bytes = 32) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function storageKey(value: string) {
  return "rq:" + base + ":" + value;
}
export function visitor() {
  const key = storageKey("visitor");
  let value = localStorage.getItem(key);
  if (!value || !/^[a-f0-9]{64}$/.test(value)) {
    value = randomToken();
    localStorage.setItem(key, value);
  }
  return value;
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
  extra: Record<string, string> = {},
): Promise<T> {
  if (!base) throw Error("請先連接店家的主機");
  const headers: Record<string, string> = {
    "X-Ribbon-Client": "1",
    "X-Visitor-Token": visitor(),
    ...extra,
  };
  if (staffToken) headers.Authorization = "Bearer " + staffToken;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let status: number, data: any;
  if (native) {
    const response = await CapacitorHttp.request({
      url: base + "/api" + path,
      method: method || (body === undefined ? "GET" : "POST"),
      headers,
      data: body,
      responseType: "json",
      connectTimeout: 10000,
      readTimeout: 15000,
    });
    status = response.status;
    data = response.data;
  } else {
    const request = () =>
      fetch(base + "/api" + path, {
        method: method || (body === undefined ? "GET" : "POST"),
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
    let r: Response;
    try {
      r = await request();
    } catch (error) {
      if (
        !["/claim", "/ticket", "/capacity"].some((action) =>
          path.endsWith(action),
        )
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
      r = await request();
    }
    status = r.status;
    try {
      data = await r.json();
    } catch {
      throw Error("主機回應格式不正確，請確認連線網址");
    }
  }
  if (status < 200 || status >= 300) {
    if (status === 401) staffToken = "";
    throw Object.assign(new Error(data?.error || "連線失敗，請稍後重試"), {
      status,
    });
  }
  return data as T;
}
