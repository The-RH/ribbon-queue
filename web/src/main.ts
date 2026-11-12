import "./style.css";
import QRCode from "qrcode";
import jsQR from "jsqr";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerTypeHint,
  CapacitorBarcodeScannerCameraDirection,
} from "@capacitor/barcode-scanner";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import {
  api,
  native,
  serverBase,
  setServer,
  loginToken,
  isLoggedIn,
  randomToken,
  storageKey,
} from "./api";
import type { Shop, Product, EventState, Ticket, AdminData } from "./types";
const app = document.querySelector<HTMLDivElement>("#app")!,
  modal = document.querySelector<HTMLDialogElement>("#modal")!;
const labels = {
  waiting: "等待入場",
  admitted: "已入場・已核銷",
  cancelled: "已取消",
};
let shop: Shop = {
    name: "Ribbon Queue",
    timezone: "Asia/Taipei",
    publicUrl: "",
    accent: "#15564b",
    setupRequired: false,
  },
  events: EventState[] = [],
  adminData: AdminData | null = null,
  event: EventState | null = null,
  ticket: Ticket | null = null,
  ticketToken = "",
  inspected: Ticket | null = null,
  inspectionToken = "",
  bootstrap = "",
  pageSerial = 0,
  busy = false,
  selectedAdmin = "",
  changing = false,
  scannerStop: (() => void) | null = null;
let pendingAdjustment: {
  eventId: string;
  productId: string;
  delta: number;
  requestId: string;
} | null = null;
const $ = <T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
) => parent.querySelector<T>(selector);
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const pad = (value: number) => String(value).padStart(3, "0");
const dt = (value: number) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: shop.timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
const localInput = (value: number) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const productName = (id: string, e = event) => {
  const p = e?.products.find((p) => p.id === id);
  return p ? p.name + (p.length ? " · " + p.length : "") : "款式已變更";
};
const eventLink = (id: string) => shop.publicUrl + "/#/event/" + id;
const ticketLink = (id: string, token: string) =>
  shop.publicUrl + "/#/ticket/" + id + "/" + token;
const btn = (label: string, action: string, extra = "", className = "") =>
  `<button type="button" class="button ${className}" data-action="${action}" ${extra}>${label}</button>`;
function toast(message: string) {
  const node = $("#toast")!;
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 5500);
}
function shell(content: string, narrow = false) {
  document.documentElement.style.setProperty("--accent", shop.accent);
  app.innerHTML = `<header><a href="#/" class="brand"><strong>Ribbon Queue</strong><small>${esc(shop.name)}</small></a><nav><a href="#/">活動領號</a><a href="#/admin">工作人員</a>${native ? '<a href="#/connect">連接主機</a>' : ""}${isLoggedIn() ? '<button class="text-button" data-action="logout">登出</button>' : ""}</nav></header><main class="${narrow ? "narrow" : ""}">${content}</main><footer><span>Ribbon Queue · 每一場，有序相遇</span><span>不需姓名、電話或 Email</span></footer>`;
  void fillQrs();
}
async function fillQrs() {
  for (const node of document.querySelectorAll<HTMLImageElement>(
    "img[data-qr]",
  )) {
    try {
      const value = node.dataset.qr!;
      const src = await QRCode.toDataURL(value, {
        width: 720,
        margin: 4,
        errorCorrectionLevel: "M",
        color: { dark: "#173e34", light: "#ffffff" },
      });
      if (node.isConnected && node.dataset.qr === value) node.src = src;
    } catch {
      node.alt = "QR Code 產生失敗，請使用下方網址";
    }
  }
}
function route() {
  const u = new URL(location.hash.slice(1) || "/", location.origin);
  return {
    parts: u.pathname
      .split("/")
      .filter(Boolean)
      .map((x) => decodeURIComponent(x)),
    query: u.searchParams,
  };
}
function navigate(value: string) {
  if (location.hash === "#" + value) void loadPage();
  else location.hash = value;
}
function heading(title: string, description: string) {
  return `<div class="hero"><span class="eyebrow">ANONYMOUS EVENT QUEUE</span><h1>${esc(title)}</h1><p class="muted">${esc(description)}</p></div>`;
}
function phaseText(e: EventState) {
  return e.phase === "ended"
    ? "票券已失效"
    : e.phase === "settling"
      ? "已停止領號"
      : e.phase === "upcoming"
        ? "尚未開始"
        : e.paused
          ? "領號暫停中"
          : e.remaining === 0
            ? "本場已額滿"
            : "正在開放領號";
}
function productsView(e: EventState, name = "product") {
  return `<fieldset><legend>每人擇一，各款名額如下</legend><div class="products">${e.products.map((p) => `<div class="product ${p.remaining === 0 ? "sold-out" : ""}">${p.image ? `<button type="button" class="photo" data-action="photo" data-image="${esc(p.image)}" data-name="${esc(p.name)}"><img src="${esc(serverBase() + p.image)}" alt="${esc(p.name)}" loading="lazy"><span>點開放大 · 留在本頁</span></button>` : '<div class="no-photo">RIBBON SELECTION</div>'}<label class="product-label"><input type="radio" name="${name}" value="${p.id}" ${p.remaining === 0 ? "disabled" : ""}><span><strong>${esc(p.name)}</strong><small>${esc(p.length)}</small><em data-quota="${p.id}">${p.remaining === 0 ? "本款已額滿" : `剩餘 ${p.remaining} / ${p.capacity}`}</em></span></label></div>`).join("")}</div></fieldset>`;
}
function eventStatus(e: EventState) {
  return `<div class="alert"><strong>${esc(phaseText(e))}</strong><br>領號 ${dt(e.start)}–${dt(e.end)}<br>票券於 ${dt(e.expires)} 失效${e.earlyAt && e.earlyAt < e.start ? " · 已提早開放領號" : ""}</div>`;
}
function statCards(e: EventState) {
  return `<div class="stats">${[
    ["已領號", e.issued, " / " + e.capacity],
    ["剩餘可領", e.remaining, " 張"],
    ["待入場", e.waiting, " 人"],
    ["已核銷", e.admitted, " 人"],
    ["已取消", e.cancelled, " 張"],
  ]
    .map(
      ([label, n, unit]) =>
        `<div class="stat"><span>${label}</span><strong>${n}<small>${unit}</small></strong></div>`,
    )
    .join("")}</div>`;
}
function balances(e: EventState) {
  return `<div class="balance-grid">${e.products.map((p) => `<div class="balance"><strong>${esc(p.name)}</strong><span>剩餘 ${p.remaining} 名</span><small>已選 ${p.issued} / ${p.capacity} · 已核銷 ${p.admitted}</small></div>`).join("")}</div>`;
}
function privacy() {
  return `<p class="privacy">不要求姓名、電話、Email；使用隨機代碼保留票券及限制重複領號。<br>請使用原瀏覽器，並儲存票券圖片；清除瀏覽資料可能無法找回。<br>未核銷票數不等於現場實際人數，離隊者請由工作人員取消票券。</p>`;
}
function renderHome() {
  shell(
    heading(shop.name, "掃碼選款領號，現場依序領取。") +
      (shop.setupRequired
        ? '<section class="card"><h2>店家主機尚未完成設定</h2><p class="muted">請主辦單位先在 Windows 主機完成首次設定。</p></section>'
        : events.length
          ? events
              .map(
                (e) =>
                  `<a class="card event-card" href="#/event/${e.id}"><span class="pill">${esc(phaseText(e))}</span><h2>${esc(e.title)}</h2><p class="muted">${dt(e.start)}–${dt(e.end)}</p><p>剩餘 ${e.remaining} / ${e.capacity} 個名額 →</p></a>`,
              )
              .join("")
          : '<section class="card empty">目前沒有可領號的活動，請依店家現場公告。</section>') +
      privacy(),
    true,
  );
}
function renderConnect() {
  shell(
    `<section class="card connection"><div class="icon">R</div><h1>連接店家主機</h1><p class="muted">讓手機與 Windows 主機連上同一個 Wi-Fi，掃描後台的「手機連線 QR」，或輸入店家提供的 HTTPS 網址。</p><form id="connect-form"><label>主機網址</label><input name="server" type="url" required placeholder="http://192.168.1.10:3210" value="${esc(serverBase())}"><p class="help">http 區域網路連線未加密；公開網路請使用 https 主機。</p><button class="button primary full" type="submit">連接主機</button></form><div class="button-row">${btn("掃描連線 QR Code", "connect-scan")}</div></section>`,
    true,
  );
}
function renderSetup() {
  shell(
    `<section class="card"><span class="eyebrow">FIRST-TIME SETUP</span><h1>建立你的店家</h1><p class="muted">這台主機的活動與資料由你管理。請設定工作人員共用的登入通行碼。</p><form id="setup-form"><label>店家名稱</label><input name="name" required maxlength="80" value="${esc(shop.name === "Ribbon Queue" ? "" : shop.name)}" placeholder="你的店名"><label>參加者可開啟的主機網址</label><input name="publicUrl" type="url" required value="${esc(shop.publicUrl || serverBase())}"><p class="help">使用同 Wi-Fi 的手機，請填主機的區域網路位址，不要填 127.0.0.1。</p>${bootstrap ? "" : `<label>主機首次設定代碼</label><input name="bootstrap" required type="password" autocomplete="off">`}<label>工作人員通行碼（至少 10 字元）</label><input name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password"><label>再輸入一次通行碼</label><input name="confirm" type="password" required minlength="10" autocomplete="new-password"><button class="button primary full" type="submit">完成設定，進入後台</button></form></section>`,
    true,
  );
}
function renderLogin() {
  shell(
    `<section class="card"><span class="eyebrow">STAFF ACCESS</span><h1>工作人員登入</h1><p class="muted">管理活動、增減名額及入場核銷。</p><form id="login-form"><label>工作人員通行碼</label><input name="password" required type="password" autocomplete="current-password"><button type="submit" class="button primary full">登入後台</button></form>${shop.setupRequired ? '<p class="help">首次使用請在 Windows 主機開啟設定連結。</p>' : ""}</section>`,
    true,
  );
}
function renderEvent() {
  const e = event!;
  shell(
    heading(e.title, shop.name) +
      `<div id="event-status">${eventStatus(e)}</div><div class="guest-layout"><section class="card"><h2>選一款，領取你的號碼</h2><p class="muted">每人每場限領一張，入場前可成功改選一次。</p><form id="claim-form">${productsView(e)}<button class="button primary full" id="claim-button" type="submit" ${!e.open || e.remaining === 0 ? "disabled" : ""}>${e.open ? (e.remaining > 0 ? "選好了，領取號碼牌" : "本場已額滿") : esc(phaseText(e))}</button></form></section><aside><section class="card"><span class="eyebrow">LIVE QUEUE</span><div id="guest-stats">${statCards(e)}</div><p class="muted">目前叫到</p><div class="big-call" id="called-number">${e.called ? pad(e.called) : "—"}</div><p class="help" id="sync-time">每 4 秒更新 · ${dt(e.serverNow)}</p></section><section class="card"><h3>領號後請保留票券</h3><p class="muted">看到號碼才算領號成功。入場時出示票券 QR Code，由工作人員查驗並核銷。</p></section></aside></div>` +
      privacy(),
  );
}
function renderTicket() {
  const e = event!,
    t = ticket!;
  shell(
    heading(e.title, shop.name) +
      `<div class="guest-layout"><section class="card"><p class="muted center">你的入場號碼</p><div class="ticket-number">${pad(t.no)}</div><div class="ticket-status">${labels[t.status]}</div><div class="ticket-product"><span class="eyebrow">YOUR SELECTION</span><strong>${esc(productName(t.productId))}</strong><small>${t.changes ? "已使用一次改選" : "入場前可改選一次"}</small></div><p class="help center">${dt(e.expires)} 票券失效</p>${t.status === "waiting" && t.changes === 0 ? (changing ? `<form id="change-form">${productsView(e, "change-product")}<button type="submit" class="button primary full">確認改選（僅限一次）</button>${btn("保留原選擇", "cancel-change", "", "full")}</form>` : btn("更換款式（僅限一次）", "start-change", "", "full")) : ""}<img class="qr" data-qr="${esc(ticketLink(e.id, ticketToken))}" alt="個人票券 QR Code"><p class="muted center">入場請出示此 QR Code<br>一票一次，請勿轉傳。</p>${btn("儲存號碼牌圖片", "save-ticket", "", "full primary")}</section><aside><section class="card">${eventStatus(e)}<p class="muted">票券款式與使用狀態以現場查驗結果為準。已核銷或取消的票不能重複入場。</p></section><a class="button full" href="#/event/${e.id}">返回本場活動</a></aside></div>` +
      privacy(),
  );
}
function productEditor(index: number) {
  return `<div class="product-editor"><div class="title-row"><strong>款式 ${index}</strong>${index > 1 ? '<button type="button" class="text-button danger" data-action="remove-product-row">移除此欄</button>' : ""}</div><div class="field-grid"><div><label>款式名稱</label><input name="pname" required maxlength="80" placeholder="例如：經典飄帶"></div><div><label>名額</label><input name="pcapacity" required type="number" min="0" max="10000" value="15"></div><div><label>長度／規格（可留白）</label><input name="plength" maxlength="32" placeholder="例如：67cm"></div><div><label>款式圖片（可留白，最大 5 MB）</label><input name="pimage" type="file" accept="image/jpeg,image/png,image/webp"></div></div></div>`;
}
function timeFields(
  start = Date.now() + 1800000,
  end = Date.now() + 5400000,
  expires = end + 3600000,
) {
  return `<p class="help">輸入時間依此裝置時區：${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}。所有裝置以主機時間判斷開放。</p><div class="field-grid"><div><label>開始領號</label><input name="start" type="datetime-local" required value="${localInput(start)}"></div><div><label>停止領號</label><input name="end" type="datetime-local" required value="${localInput(end)}"></div><div class="wide"><label>停止領號後幾分鐘失效／清除票券</label><input name="ttl" type="number" required min="1" max="10080" value="${Math.round((expires - end) / 60000)}"></div></div>`;
}
function newEventForm() {
  return `<section class="card"><h2>建立新活動</h2><form id="new-event-form"><label>活動名稱</label><input name="title" required maxlength="100" placeholder="例如：週末飄帶領取・下午場">${timeFields()}<div id="product-editors">${productEditor(1)}</div><div class="button-row">${btn("＋ 新增一款", "add-product-row")}<button type="submit" class="button primary">建立活動</button></div></form></section>`;
}
function quotaForm(e: EventState) {
  return `<section class="card"><h2>調整本場名額</h2><p class="muted">增加或減少未領出的名額，已發票券和號碼會保留。</p><form id="quota-form"><fieldset ${e.phase === "ended" ? "disabled" : ""}><label>調整方式</label><select name="operation"><option value="increase">增加名額</option><option value="decrease">減少未領名額</option></select><label>調整哪一款</label><select name="productId">${e.products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select><label>要增加／減少幾張（不是修改成幾張）</label><input name="amount" type="number" inputmode="numeric" required min="1" max="1000" value="1"><p class="help" id="quota-preview"></p><button type="submit" class="button primary full" id="quota-submit">確認調整名額</button></fieldset></form></section>`;
}
function adminEvent(e: EventState) {
  return `<div class="card-title"><div><span class="eyebrow">EVENT CONTROL</span><h1>${esc(e.title)}</h1></div><span class="pill" id="admin-phase">${esc(phaseText(e))}</span></div><div id="admin-stats">${statCards(e)}</div><div class="grid"><section class="card"><h2>現場檢票</h2><p class="muted">先掃碼確認，再按「確認入場」。未顯示核銷成功前請勿放行。</p><div class="button-row">${btn("開啟相機掃碼", "scan-ticket", "", "primary")}${btn("關閉相機", "stop-scan")}</div><div id="scanner"></div><form id="inspect-form" class="scan-manual"><label>或貼上參加者的票券 QR 連結</label><input name="link" required placeholder="https://…/#/ticket/…"><button class="button full" type="submit">查驗票券</button></form><div id="inspection"></div></section><section class="card"><h2>領號控制與叫號</h2><p class="help">領號於 ${dt(e.end)} 結束；票券於 ${dt(e.expires)} 失效。</p><div class="button-row">${btn(e.paused ? "恢復領號" : "暫停領號", "toggle-pause", e.phase === "ended" ? "disabled" : "")}${btn("現在提早開放", "early-open", e.phase === "upcoming" ? "" : "disabled")}</div><p class="help">本場已領 ${e.issued} 張，號碼會持續累加，不會重編號。</p><div class="big-call" id="called-number">${e.called ? pad(e.called) : "—"}</div>${btn("叫下一號", "call-next", e.phase === "ended" ? "disabled" : "", "primary full")}<p class="help">叫號不會自動核銷。離隊者可在下方清單取消，取消後不補名額。</p></section></div><section class="card"><div class="card-title"><h2>各款名額</h2><span class="pill">本場總額 <span id="capacity-number">${e.capacity}</span></span></div><div id="product-balances">${balances(e)}</div></section><div class="grid">${quotaForm(e)}<section class="card"><h2>本場領號 QR Code</h2><img class="qr" data-qr="${esc(eventLink(e.id))}" alt="本場公開領號 QR Code"><p class="url-text">${esc(eventLink(e.id))}</p><div class="button-row">${btn("放大／列印海報", "poster", "", "primary")}${btn("下載 QR 圖片", "save-event-qr")}</div><p class="help">按隊伍順序發號時，請一次只讓一人完成領號，再換下一位。</p></section></div><section class="card"><h2>號碼牌清單</h2><div class="button-row">${btn("待入場", "filter-tickets", 'data-filter="waiting"')}${btn("已核銷", "filter-tickets", 'data-filter="admitted"')}${btn("全部", "filter-tickets", 'data-filter="all"')}</div><div id="ticket-list"></div></section><section class="card"><details><summary>調整活動名稱與時間（票券號碼會保留）</summary><form id="edit-event-form"><label>活動名稱</label><input name="title" required maxlength="100" value="${esc(e.title)}">${timeFields(e.start, e.end, e.expires)}<button class="button primary full" type="submit">儲存活動時間</button></form></details><details><summary>在本場新增款式</summary><form id="add-product-form">${productEditor(1)}<button class="button primary full" type="submit">新增款式與名額</button></form></details></section>`;
}
let ticketFilter = "waiting";
function renderAdmin() {
  const data = adminData!;
  shop = data.shop;
  event = data.events.find((e) => e.id === selectedAdmin) || null;
  const sidebar = `<aside class="sidebar"><button class="button ${!selectedAdmin ? "active" : ""}" data-action="new-event">＋ 新活動</button>${data.events.map((e) => `<button class="button ${e.id === selectedAdmin ? "active" : ""}" data-action="select-event" data-id="${e.id}">${esc(e.title)}<br><small>${esc(phaseText(e))}</small></button>`).join("")}<button class="button" data-action="shop-settings">店家設定／手機連線</button></aside>`;
  shell(
    `<div class="sidebar-layout">${sidebar}<div>${event ? adminEvent(event) : newEventForm()}</div></div>`,
  );
  updateQuotaPreview();
  if (event) void refreshTickets();
}
function renderSettings() {
  const data = adminData!;
  shell(
    heading("店家設定", shop.name) +
      `<div class="grid"><section class="card"><h2>品牌與連線</h2><form id="settings-form"><label>店家名稱</label><input name="name" required maxlength="80" value="${esc(shop.name)}"><label>參加者可開啟的主機網址</label><input name="publicUrl" type="url" required value="${esc(shop.publicUrl)}"><p class="help">Windows 主機目前的區網位址：${data.network.addresses.map((x) => esc(x)).join("、") || "未偵測到區域網路"}。手機須能開啟這個網址。</p><label>顯示時區</label><input name="timezone" required value="${esc(shop.timezone)}" placeholder="Asia/Taipei"><label>品牌色</label><input name="accent" type="color" value="${esc(shop.accent)}"><label>新通行碼（不修改請留白）</label><input name="newPassword" type="password" minlength="10" maxlength="128" autocomplete="new-password"><button class="button primary full" type="submit">儲存店家設定</button></form></section><section class="card"><h2>工作人員手機連線</h2><p class="muted">安裝 Android／iOS App 後，掃描這張 QR 連到本店主機，再輸入工作人員通行碼。</p><img class="qr" data-qr="${esc("ribbonqueue://connect?server=" + encodeURIComponent(shop.publicUrl))}" alt="手機 App 主機連線 QR Code"><p class="url-text">${esc(shop.publicUrl)}</p><p class="help">這張 QR 不包含登入通行碼。Windows 主機必須保持開啟，區網模式需連同一個 Wi-Fi。</p>${btn("匯出活動設定（不含票券與通行碼）", "export-config", "", "full")}${btn("返回活動後台", "back-admin", "", "full")}</section></div>`,
  );
}
function updateQuotaPreview() {
  const form = $<HTMLFormElement>("#quota-form");
  if (!form || !event) return;
  const data = new FormData(form),
    p = event.products.find((p) => p.id === data.get("productId"));
  if (!p) return;
  const amount = Number(data.get("amount")),
    delta = data.get("operation") === "decrease" ? -amount : amount;
  const valid =
    Number.isSafeInteger(amount) &&
    amount >= 1 &&
    amount <= 1000 &&
    p.capacity + delta >= p.issued &&
    p.capacity + delta <= 10000;
  const preview = $("#quota-preview")!;
  preview.textContent =
    `已領 ${p.issued} 張，尚未領出 ${p.remaining} 張。` +
    (pendingAdjustment
      ? "正在確認上一筆操作，重試不會重複增減。"
      : valid
        ? `調整後：本款 ${p.capacity + delta} 張、本場 ${event.capacity + delta} 張。`
        : "不能減到已發票券數以下，請調整數量。");
  $<HTMLButtonElement>("#quota-submit")!.disabled =
    busy || event.phase === "ended" || (!pendingAdjustment && !valid);
}
async function refreshTickets() {
  if (!event || !isLoggedIn()) return;
  const id = event.id;
  const { tickets } = await api<{ tickets: Ticket[] }>(
    "/admin/events/" + id + "/tickets",
  );
  if (event?.id !== id) return;
  const container = $("#ticket-list");
  if (!container) return;
  const filtered = tickets.filter(
    (t) => ticketFilter === "all" || t.status === ticketFilter,
  );
  container.innerHTML = filtered.length
    ? `<div class="table-wrap"><table><thead><tr><th>號碼</th><th>款式</th><th>狀態</th><th></th></tr></thead><tbody>${filtered.map((t) => `<tr><td class="table-number">${pad(t.no)}</td><td>${esc(productName(t.productId))}${t.changes ? "<small> · 已改選</small>" : ""}</td><td><span class="status ${t.status}">${labels[t.status]}</span></td><td>${t.status === "waiting" ? `<button class="text-button danger" data-action="cancel-ticket" data-id="${t.id}" data-no="${t.no}">取消</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
    : '<p class="empty">目前沒有此狀態的票券</p>';
}
function renderInspection() {
  const container = $("#inspection");
  if (!container) return;
  if (!inspected) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `<div class="inspection"><span>查驗結果</span><strong>${pad(inspected.no)}</strong><span class="status ${inspected.status}">${labels[inspected.status]}</span><h3>${esc(productName(inspected.productId))}</h3><p class="help">${inspected.changes ? "已改選一次" : "尚未改選"}</p>${inspected.status === "waiting" ? btn("確認入場・核銷此票", "admit", "", "primary full") : '<p class="help">此票不可再次放行</p>'}</div>`;
}
async function loadPublic() {
  const data = await api<{ shop: Shop; events: EventState[] }>("/public");
  shop = data.shop;
  events = data.events;
}
async function loadPage() {
  const serial = ++pageSerial;
  stopScanner();
  changing = false;
  inspected = null;
  const { parts, query } = route();
  try {
    if (parts[0] === "connect" || (native && !serverBase())) {
      renderConnect();
      return;
    }
    await loadPublic();
    if (serial !== pageSerial) return;
    if (parts[0] === "setup") {
      bootstrap = query.get("token") || bootstrap;
      if (query.has("token")) history.replaceState(null, "", "/#/setup");
      renderSetup();
      return;
    }
    if (parts[0] === "admin") {
      if (!isLoggedIn()) {
        renderLogin();
        return;
      }
      adminData = await api<AdminData>("/admin");
      if (serial !== pageSerial) return;
      if (parts[1] === "settings") {
        renderSettings();
        return;
      }
      if (!selectedAdmin)
        selectedAdmin =
          adminData.events.find((e) => e.phase === "open")?.id ||
          adminData.events.find((e) => e.phase !== "ended")?.id ||
          "";
      renderAdmin();
      return;
    }
    if (parts[0] === "event" && parts[1]) {
      const data = await api<{ shop: Shop; event: EventState }>(
        "/events/" + encodeURIComponent(parts[1]),
      );
      if (serial !== pageSerial) return;
      shop = data.shop;
      event = data.event;
      const stored = localStorage.getItem(storageKey("ticket:" + event.id));
      if (stored) {
        try {
          const owned = await api<{ ticket: Ticket }>(
            "/events/" + event.id + "/ticket",
            { token: stored },
          );
          ticket = owned.ticket;
          ticketToken = stored;
          navigate("/ticket/" + event.id + "/" + stored);
          return;
        } catch (e: any) {
          if (e.status === 410 || e.status === 404)
            localStorage.removeItem(storageKey("ticket:" + event.id));
          else throw e;
        }
      }
      renderEvent();
      return;
    }
    if (parts[0] === "ticket" && parts[1] && parts[2]) {
      const data = await api<{ shop: Shop; event: EventState; ticket: Ticket }>(
        "/events/" + encodeURIComponent(parts[1]) + "/ticket",
        { token: parts[2] },
      );
      if (serial !== pageSerial) return;
      shop = data.shop;
      event = data.event;
      ticket = data.ticket;
      ticketToken = parts[2];
      renderTicket();
      return;
    }
    renderHome();
  } catch (error: any) {
    if (serial !== pageSerial) return;
    if (error.status === 401) {
      renderLogin();
      return;
    }
    shell(
      heading("暫時無法開啟", error.message || "請確認主機與網路連線") +
        `<section class="card"><p class="muted">請保留已儲存的票券。未確認領號或核銷成功前，請勿重複操作或放行。</p><div class="button-row">${btn("重新連線", "retry-page", "", "primary")}<a class="button" href="#/">返回活動</a></div></section>`,
      true,
    );
  }
}
async function run(work: () => Promise<void>) {
  if (busy) return;
  busy = true;
  for (const b of document.querySelectorAll<HTMLButtonElement>(
    "button[type=submit]",
  ))
    b.disabled = true;
  try {
    await work();
  } catch (error: any) {
    toast(error.message || "操作失敗，請重試");
    if (error.status === 401) navigate("/admin");
  } finally {
    busy = false;
    for (const b of document.querySelectorAll<HTMLButtonElement>(
      "button[type=submit]",
    ))
      b.disabled = false;
    updateQuotaPreview();
    updatePublicAvailability();
  }
}
function updatePublicAvailability() {
  if (!event) return;
  const claim = $<HTMLButtonElement>("#claim-button");
  if (claim) {
    claim.disabled = busy || !event.open || event.remaining === 0;
    claim.textContent = event.open
      ? event.remaining > 0
        ? "選好了，領取號碼牌"
        : "本場已額滿"
      : phaseText(event);
  }
  for (const p of event.products) {
    const radio = $<HTMLInputElement>(
      `input[name=product][value="${p.id}"],input[name=change-product][value="${p.id}"]`,
    );
    if (radio) {
      radio.disabled = busy || p.remaining === 0;
      radio
        .closest(".product")
        ?.classList.toggle("sold-out", p.remaining === 0);
    }
    const label = $(`[data-quota="${p.id}"]`);
    if (label)
      label.textContent =
        p.remaining === 0
          ? "本款已額滿"
          : `剩餘 ${p.remaining} / ${p.capacity}`;
  }
}
async function upload(file: File | undefined) {
  if (!file || file.size === 0) return "";
  if (file.size > 5 * 1024 * 1024) throw Error("圖片請小於 5 MB");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("僅接受 JPEG、PNG、WebP 圖片");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(Error("圖片讀取失敗"));
    reader.readAsDataURL(file);
  });
  return (await api<{ image: string }>("/admin/upload", { data })).image;
}
async function readProducts(form: HTMLFormElement) {
  const data = new FormData(form),
    names = data.getAll("pname"),
    capacities = data.getAll("pcapacity"),
    lengths = data.getAll("plength"),
    images = [...form.querySelectorAll<HTMLInputElement>("[name=pimage]")];
  const result = [];
  for (let i = 0; i < names.length; i++)
    result.push({
      name: String(names[i]),
      capacity: Number(capacities[i]),
      length: String(lengths[i] || ""),
      image: await upload(images[i]?.files?.[0]),
    });
  return result;
}
function readTimes(form: HTMLFormElement) {
  const data = new FormData(form),
    start = new Date(String(data.get("start"))).getTime(),
    end = new Date(String(data.get("end"))).getTime(),
    ttl = Number(data.get("ttl"));
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    !Number.isInteger(ttl) ||
    ttl < 1
  )
    throw Error("請確認開始、停止領號與票券失效時間");
  return {
    title: String(data.get("title")),
    start,
    end,
    expires: end + ttl * 60000,
  };
}
async function reloadAdmin() {
  adminData = await api<AdminData>("/admin");
  event = adminData.events.find((e) => e.id === selectedAdmin) || null;
  renderAdmin();
}
document.addEventListener("submit", (eventObject) => {
  const form = eventObject.target as HTMLFormElement;
  if (!form.id) return;
  eventObject.preventDefault();
  void run(async () => {
    const data = new FormData(form);
    if (form.id === "connect-form") {
      setServer(String(data.get("server")).trim());
      await loadPublic();
      navigate("/admin");
      return;
    }
    if (form.id === "setup-form") {
      if (data.get("password") !== data.get("confirm"))
        throw Error("兩次輸入的通行碼不同");
      const password = String(data.get("password"));
      await api(
        "/setup",
        { name: data.get("name"), publicUrl: data.get("publicUrl"), password },
        "POST",
        { "X-Setup-Token": bootstrap || String(data.get("bootstrap")) },
      );
      bootstrap = "";
      const session = await api<{ token: string }>("/login", { password });
      loginToken(session.token);
      navigate("/admin");
      return;
    }
    if (form.id === "login-form") {
      const session = await api<{ token: string }>("/login", {
        password: data.get("password"),
      });
      loginToken(session.token);
      await loadPage();
      return;
    }
    if (form.id === "claim-form") {
      if (!event) throw Error("活動資料尚未載入");
      const productId = String(data.get("product") || "");
      if (!productId) throw Error("請先選擇一款");
      const key = storageKey("ticket:" + event.id);
      let token = localStorage.getItem(key);
      if (!token) {
        token = randomToken();
        localStorage.setItem(key, token);
        if (localStorage.getItem(key) !== token)
          throw Error("無法保留票券，請允許瀏覽器儲存功能");
      }
      const result = await api<{ ticket: Ticket }>(
        "/events/" + event.id + "/claim",
        { token, productId },
      );
      ticket = result.ticket;
      ticketToken = token;
      navigate("/ticket/" + event.id + "/" + token);
      return;
    }
    if (form.id === "change-form") {
      if (!event) throw Error("活動資料尚未載入");
      const productId = String(data.get("change-product") || "");
      if (!productId) throw Error("請選擇要更換的款式");
      if (!confirm("確定使用唯一一次改選機會？")) return;
      const r = await api<{ ticket: Ticket; event: EventState }>(
        "/events/" + event.id + "/choose",
        { token: ticketToken, productId },
      );
      ticket = r.ticket;
      event = r.event;
      changing = false;
      renderTicket();
      toast("款式已更新");
      return;
    }
    if (form.id === "new-event-form") {
      const products = await readProducts(form);
      const created = await api<EventState>("/admin/events", {
        ...readTimes(form),
        products,
      });
      selectedAdmin = created.id;
      await reloadAdmin();
      toast("活動已建立，掃碼即可依時段領號");
      return;
    }
    if (form.id === "edit-event-form") {
      if (!event) return;
      await api("/admin/events/" + event.id, readTimes(form), "PUT");
      await reloadAdmin();
      toast("時間已更新，既有票券與號碼保留");
      return;
    }
    if (form.id === "add-product-form") {
      if (!event) return;
      const products = await readProducts(form);
      await api("/admin/events/" + event.id + "/products", products[0]);
      await reloadAdmin();
      toast("本場新款式已加入");
      return;
    }
    if (form.id === "quota-form") {
      if (!event) return;
      let adjustment = pendingAdjustment;
      if (!adjustment) {
        const productId = String(data.get("productId")),
          amount = Number(data.get("amount")),
          delta = data.get("operation") === "decrease" ? -amount : amount,
          p = event.products.find((p) => p.id === productId);
        if (
          !p ||
          !Number.isInteger(amount) ||
          amount < 1 ||
          amount > 1000 ||
          p.capacity + delta < p.issued
        )
          throw Error("請確認數量，不能減少已發出的名額");
        if (
          !confirm(
            `確定${delta < 0 ? "減少" : "增加"}「${p.name}」${amount} 張？\n本款 ${p.capacity} → ${p.capacity + delta} 張\n本場 ${event.capacity} → ${event.capacity + delta} 張\n已領票券不變。`,
          )
        )
          return;
        adjustment = {
          eventId: event.id,
          productId,
          delta,
          requestId: randomToken(16),
        };
        pendingAdjustment = adjustment;
      }
      form.querySelector("fieldset")!.disabled = true;
      try {
        await api(
          "/admin/events/" + adjustment.eventId + "/capacity",
          adjustment,
        );
        pendingAdjustment = null;
        await reloadAdmin();
        toast("名額已調整，既有票券不受影響");
      } catch (error: any) {
        if ([400, 409, 410].includes(error.status)) pendingAdjustment = null;
        throw error;
      } finally {
        const fields = form.querySelector("fieldset");
        if (fields) fields.disabled = !!pendingAdjustment;
      }
      return;
    }
    if (form.id === "inspect-form") {
      await inspectLink(String(data.get("link")));
      return;
    }
    if (form.id === "settings-form") {
      const input: any = {
        name: data.get("name"),
        publicUrl: data.get("publicUrl"),
        timezone: data.get("timezone"),
        accent: data.get("accent"),
      };
      if (data.get("newPassword")) input.newPassword = data.get("newPassword");
      shop = await api<Shop>("/admin/settings", input, "PUT");
      if (input.newPassword) {
        loginToken("");
        toast("通行碼已更新，請重新登入");
        navigate("/admin");
      } else {
        adminData = await api<AdminData>("/admin");
        renderSettings();
        toast("店家設定已儲存");
      }
      return;
    }
  });
});
document.addEventListener("input", (eventObject) => {
  if ((eventObject.target as HTMLElement).closest("#quota-form"))
    updateQuotaPreview();
});
document.addEventListener("change", (eventObject) => {
  if ((eventObject.target as HTMLElement).closest("#quota-form"))
    updateQuotaPreview();
});
document.addEventListener("click", (eventObject) => {
  const target = (eventObject.target as HTMLElement).closest<HTMLElement>(
    "[data-action]",
  );
  if (!target) return;
  const action = target.dataset.action!;
  if (action === "stop-scan") {
    stopScanner();
    return;
  }
  if (action === "photo") {
    showPhoto(target.dataset.image!, target.dataset.name!);
    return;
  }
  if (action === "close-modal") {
    modal.close();
    return;
  }
  if (action === "zoom-photo") {
    const image = $<HTMLImageElement>(".full-photo", modal);
    if (image)
      image.style.width = image.style.width === "100%" ? "180%" : "100%";
    return;
  }
  if (action === "add-product-row") {
    const rows = $("#product-editors")!;
    if (rows.children.length >= 20) {
      toast("每場最多 20 款");
      return;
    }
    rows.insertAdjacentHTML(
      "beforeend",
      productEditor(rows.children.length + 1),
    );
    return;
  }
  if (action === "remove-product-row") {
    target.closest(".product-editor")?.remove();
    return;
  }
  if (action === "start-change") {
    changing = true;
    renderTicket();
    return;
  }
  if (action === "cancel-change") {
    changing = false;
    renderTicket();
    return;
  }
  if (action === "filter-tickets") {
    ticketFilter = target.dataset.filter!;
    void refreshTickets().catch((e) => toast(e.message));
    return;
  }
  void run(async () => {
    if (action === "retry-page") {
      await loadPage();
      return;
    }
    if (action === "connect-scan") {
      const result = await scanNative();
      const u = new URL(result);
      setServer(
        u.protocol === "ribbonqueue:"
          ? u.searchParams.get("server") || ""
          : u.origin,
      );
      await loadPublic();
      navigate("/admin");
      return;
    }
    if (action === "logout") {
      await api("/logout", {});
      loginToken("");
      adminData = null;
      selectedAdmin = "";
      navigate("/admin");
      return;
    }
    if (action === "select-event") {
      selectedAdmin = target.dataset.id!;
      pendingAdjustment = null;
      stopScanner();
      await reloadAdmin();
      return;
    }
    if (action === "new-event") {
      selectedAdmin = "";
      pendingAdjustment = null;
      renderAdmin();
      return;
    }
    if (action === "shop-settings") {
      navigate("/admin/settings");
      return;
    }
    if (action === "back-admin") {
      navigate("/admin");
      return;
    }
    if (action === "scan-ticket") {
      if (native) await inspectLink(await scanNative());
      else await startWebScanner();
      return;
    }
    if (action === "admit") {
      if (!event || !inspected) return;
      const expected = inspected;
      try {
        const r = await api<{ ticket: Ticket }>(
          "/admin/events/" + event.id + "/admit",
          {
            token: inspectionToken,
            productId: expected.productId,
            changes: expected.changes,
          },
        );
        inspected = r.ticket;
        renderInspection();
        toast("✓ " + pad(r.ticket.no) + " 號核銷成功，可以放行");
        await pollAdmin();
      } catch (error) {
        inspected = null;
        renderInspection();
        throw error;
      }
      return;
    }
    if (action === "toggle-pause") {
      if (!event) return;
      if (
        !confirm(
          event.paused
            ? "確定恢復領號？仍依排定時間自動結束。"
            : "確定暫停領號？已領票仍可核銷。",
        )
      )
        return;
      await api("/admin/events/" + event.id + "/pause", {
        paused: !event.paused,
      });
      await reloadAdmin();
      return;
    }
    if (action === "early-open") {
      if (!event) return;
      if (!confirm("現在提早開放本場領號？名額及結束時間維持原設定。")) return;
      await api("/admin/events/" + event.id + "/early-open", {});
      await reloadAdmin();
      return;
    }
    if (action === "call-next") {
      if (!event) return;
      await api("/admin/events/" + event.id + "/call", {});
      await pollAdmin();
      return;
    }
    if (action === "cancel-ticket") {
      if (!event) return;
      if (
        !confirm(
          "取消 " +
            pad(Number(target.dataset.no)) +
            " 號？取消後不能入場，也不會補發名額。",
        )
      )
        return;
      await api("/admin/events/" + event.id + "/cancel", {
        ticketId: target.dataset.id,
      });
      await pollAdmin();
      return;
    }
    if (action === "poster") {
      if (!event) return;
      const e = event;
      shell(
        `<section class="poster card"><span class="eyebrow">SCAN TO JOIN</span><h1>${esc(shop.name)}</h1><h2>${esc(e.title)}</h2><img class="qr" data-qr="${esc(eventLink(e.id))}" alt="活動領號 QR"><p>手機掃碼 → 款式擇一 → 出示票券入場</p><p>領號 ${dt(e.start)}–${dt(e.end)}<br>票券於 ${dt(e.expires)} 失效</p><strong>本場共 ${e.capacity} 個名額，發完為止</strong><p class="help">不需姓名、電話或 Email</p><p class="url-text">${esc(eventLink(e.id))}</p><div class="button-row no-print">${btn("列印海報", "print", "", "primary")}${btn("返回後台", "back-admin")}</div></section>`,
      );
      return;
    }
    if (action === "print") {
      window.print();
      return;
    }
    if (action === "save-event-qr") {
      if (!event) return;
      await download(
        await QRCode.toDataURL(eventLink(event.id), {
          width: 1200,
          margin: 4,
          errorCorrectionLevel: "M",
        }),
        "Ribbon-Queue-Event-" + event.id + ".png",
      );
      return;
    }
    if (action === "save-ticket") {
      await saveTicket();
      return;
    }
    if (action === "export-config") {
      const data = await api("/admin/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const encoded = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
      await download(encoded, "Ribbon-Queue-設定.json");
      return;
    }
  });
});
function showPhoto(image: string, name: string) {
  if (!/^\/uploads\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(image)) return;
  modal.innerHTML = `<div class="modal-head"><h2>${esc(name)}</h2>${btn("關閉", "close-modal")}</div>${btn("放大／縮小", "zoom-photo")}<div class="photo-viewport"><img class="full-photo" src="${esc(serverBase() + image)}" alt="${esc(name)}" style="width:100%"></div>`;
  modal.showModal();
}
function parseTicketLink(value: string) {
  const url = new URL(value);
  const match = url.hash.match(/^#\/ticket\/([a-f0-9-]{36})\/([a-f0-9]{64})$/);
  if (!match) throw Error("不是有效的 Ribbon Queue 票券 QR Code");
  return { eventId: match[1], token: match[2] };
}
async function inspectLink(value: string) {
  if (!event) throw Error("請先選擇活動");
  const parsed = parseTicketLink(value);
  if (parsed.eventId !== event.id)
    throw Error("這是另一場活動的票券，請先切換對應場次");
  stopScanner();
  const result = await api<{ ticket: Ticket }>(
    "/admin/events/" + event.id + "/inspect",
    { token: parsed.token },
  );
  inspected = result.ticket;
  inspectionToken = parsed.token;
  renderInspection();
}
async function scanNative() {
  if (!native) throw Error("請用手機 App 掃描連線 QR，或直接輸入主機網址");
  const result = await CapacitorBarcodeScanner.scanBarcode({
    hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
    cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
    scanInstructions: "將 QR Code 放入畫面",
    cancelButtonAccessibilityLabel: "取消掃描",
    torchButtonOnAccessibilityLabel: "開啟照明",
    torchButtonOffAccessibilityLabel: "關閉照明",
  });
  return result.ScanResult;
}
function stopScanner() {
  scannerStop?.();
  scannerStop = null;
  const box = $("#scanner");
  if (box) box.innerHTML = "";
}
async function startWebScanner() {
  stopScanner();
  if (!window.isSecureContext)
    throw Error("瀏覽器相機需 HTTPS；區網模式請用手機 App，或貼上票券連結查驗");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  });
  const box = $("#scanner");
  if (!box) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  const video = document.createElement("video");
  video.className = "camera";
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  box.append(video);
  await video.play();
  const canvas = document.createElement("canvas");
  let ended = false,
    timer = 0;
  scannerStop = () => {
    ended = true;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
  };
  const tick = () => {
    if (ended) return;
    if (video.readyState >= 2) {
      const scale = Math.min(1, 720 / video.videoWidth);
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(pixels.data, canvas.width, canvas.height, {
          inversionAttempts: "dontInvert",
        });
        if (found) {
          stopScanner();
          void run(() => inspectLink(found.data));
          return;
        }
      }
    }
    timer = window.setTimeout(tick, 180);
  };
  tick();
}
async function download(src: string, name: string) {
  if (native) {
    const data = src.split(",")[1];
    if (!data) throw Error("檔案格式不正確");
    const file = await Filesystem.writeFile({
      path: name,
      data,
      directory: Directory.Cache,
    });
    await Share.share({
      title: "Ribbon Queue",
      files: [file.uri],
      dialogTitle: "儲存或分享檔案",
    });
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = src;
  anchor.download = name;
  anchor.click();
}
async function saveTicket() {
  if (!event || !ticket) return;
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 1420;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#f7f5ef";
  context.fillRect(0, 0, 1000, 1420);
  context.fillStyle = shop.accent;
  context.textAlign = "center";
  context.font = "36px sans-serif";
  context.fillText(shop.name, 500, 100, 900);
  context.font = "30px sans-serif";
  context.fillText(event.title, 500, 165, 900);
  context.font = "bold 170px Georgia";
  context.fillText(pad(ticket.no), 500, 355);
  context.font = "32px sans-serif";
  context.fillText(productName(ticket.productId), 500, 425, 900);
  const image = new Image();
  image.src = await QRCode.toDataURL(ticketLink(event.id, ticketToken), {
    width: 540,
    margin: 4,
  });
  await image.decode();
  context.drawImage(image, 230, 470, 540, 540);
  context.font = "26px sans-serif";
  context.fillText("票券失效：" + dt(event.expires), 500, 1080);
  context.fillText("一票一次，入場請出示此 QR Code", 500, 1150);
  context.fillText("款式與狀態以工作人員查驗為準", 500, 1210);
  context.font = "22px sans-serif";
  context.fillText("請勿轉傳票券。離隊請告知現場人員。", 500, 1290);
  await download(
    canvas.toDataURL("image/png"),
    "Ribbon-Queue-" + event.id + "-" + pad(ticket.no) + ".png",
  );
}
async function pollAdmin() {
  if (!isLoggedIn()) return;
  const serial = pageSerial,
    id = selectedAdmin;
  const data = await api<AdminData>("/admin");
  if (serial !== pageSerial || id !== selectedAdmin || !isLoggedIn()) return;
  adminData = data;
  shop = data.shop;
  const selected = data.events.find((e) => e.id === selectedAdmin);
  if (!selected || !$("#admin-stats")) return;
  event = selected;
  $("#admin-stats")!.innerHTML = statCards(selected);
  $("#product-balances")!.innerHTML = balances(selected);
  $("#capacity-number")!.textContent = String(selected.capacity);
  $("#admin-phase")!.textContent = phaseText(selected);
  $("#called-number")!.textContent = selected.called
    ? pad(selected.called)
    : "—";
  updateQuotaPreview();
  await refreshTickets();
}
let polling = false;
async function poll() {
  if (polling || busy || document.hidden || modal.open) return;
  polling = true;
  try {
    const { parts } = route();
    if (parts[0] === "admin" && isLoggedIn()) {
      await pollAdmin();
      return;
    }
    if (parts[0] === "event" && event) {
      const id = event.id;
      const result = await api<{ event: EventState }>("/events/" + id);
      if (route().parts[0] !== "event" || event.id !== id) return;
      event = result.event;
      $("#event-status")!.innerHTML = eventStatus(event);
      $("#guest-stats")!.innerHTML = statCards(event);
      $("#called-number")!.textContent = event.called ? pad(event.called) : "—";
      $("#sync-time")!.textContent = "每 4 秒更新 · " + dt(event.serverNow);
      updatePublicAvailability();
      return;
    }
    if (parts[0] === "ticket" && event && ticket) {
      const previous = JSON.stringify(ticket),
        serial = pageSerial,
        token = ticketToken;
      const result = await api<{ ticket: Ticket; event: EventState }>(
        "/events/" + event.id + "/ticket",
        { token },
      );
      if (
        serial !== pageSerial ||
        token !== ticketToken ||
        route().parts[0] !== "ticket"
      )
        return;
      ticket = result.ticket;
      event = result.event;
      if (JSON.stringify(ticket) !== previous) renderTicket();
      else updatePublicAvailability();
    }
  } catch (error: any) {
    if (error.status === 401) {
      loginToken("");
      navigate("/admin");
    } else if (error.status === 410) {
      await loadPage();
    } else {
      const sync = $("#sync-time");
      if (sync) sync.textContent = "連線中斷，請保留票券並稍後重試";
    }
  } finally {
    polling = false;
  }
}
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.close();
});
window.addEventListener("hashchange", () => void loadPage());
window.addEventListener("beforeunload", stopScanner);
window.addEventListener("visibilitychange", () => {
  if (!document.hidden) void poll();
});
setInterval(() => void poll(), 4000);
if (
  !native &&
  "serviceWorker" in navigator &&
  (location.protocol === "https:" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "localhost")
)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
void loadPage();
