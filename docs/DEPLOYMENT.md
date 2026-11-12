# 主機部署與備份

## Windows 現場主機

資料位於使用者 AppData 的 `Ribbon Queue/host-data`（實際路徑由 Electron 使用者資料目錄決定）。免安裝版也將資料保存在使用者資料目錄，關閉程式不會清空。

一間店只執行一個主機程序。手機 App 及其他工作人員瀏覽器連接這一台主機。程式包含資料夾寫入鎖，避免兩個主機同時覆寫同一份資料。

同 Wi-Fi 連線前，先確認手機可開啟店家設定中的 `http://區網IP:3210`。本程式不會自動修改路由器、防火牆或 Windows 安全設定。

## Node.js / Docker

環境變數：

| 變數 | 用途 |
| --- | --- |
| `PORT` | 監聽埠，預設 3210 |
| `HOST` | 監聽介面，預設 0.0.0.0 |
| `RIBBON_DATA_DIR` | 私有資料目錄，預設 `data/` |
| `PUBLIC_URL` | 手機可開啟的根網址，例如 `https://queue.example.com` |

`PUBLIC_URL` 不包含路徑、查詢參數或帳密。HTTP 只允許 localhost／私人區網；公開主機需要 HTTPS。每家店部署自己的 instance 與資料 volume。

Docker 第一次啟動後，用 `docker compose logs ribbon-queue` 找到 owner-only 首次設定連結。若從其他電腦開啟，將連結的 localhost 部分換成已設定的公開 HTTPS 主機，保留 `/#/setup?token=...`，不要公開該連結。

反向代理只轉送到同一個主機 instance；本版本為單程序 SQLite 主機，不支援多個副本共用一份 volume。代理應限制 request body、設置 HTTPS，且不要把 Owner 設定連結記入公開文件。

範例 Caddy：

```caddy
queue.example.com {
    reverse_proxy 127.0.0.1:3210
}
```

## 備份與更新

1. 正常關閉主機。
2. 備份 `queue.sqlite`、`host-secret.json` 與 `uploads/`；三者應一起保留。`server.lock` 不需要備份。
3. 安裝新版本，再啟動主機。

`host-secret.json` 是私人金鑰，不能放到公開 GitHub、分享 QR 或寄給參加者。遺失主機金鑰會使原票驗證失效。匯出活動設定只包含店家與款式設定，不是完整票券資料備份。

店家通行碼以 scrypt 雜湊保存，不能從資料庫讀回明碼。忘記時請關閉主機，依 `node scripts/reset-admin.mjs --data <資料目錄>` 的本機提示重設；重設會讓全部既有工作人員登入失效。
