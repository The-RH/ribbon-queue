# Ribbon Queue · 飄帶領號

給獨立店家的匿名現場領號系統。店家設定活動、款式、名額與時間，參加者掃 QR Code 選款領號，工作人員叫號並掃碼核銷。

**一店一主機、各自保存資料，不需要共用中央帳號，也不收參加者的姓名、電話或 Email。**

## 直接使用

下載 [最新版本與完整安裝檔](https://github.com/The-RH/ribbon-queue/releases/latest)：

- [Windows 安裝版](https://github.com/The-RH/ribbon-queue/releases/download/v1.0.0/Ribbon-Queue-1.0.0-Windows-Setup.exe)
- [Windows 免安裝版](https://github.com/The-RH/ribbon-queue/releases/download/v1.0.0/Ribbon-Queue-1.0.0-Windows-Portable.exe)
- [Android APK](https://github.com/The-RH/ribbon-queue/releases/download/v1.0.0/Ribbon-Queue-1.0.0-android.apk)
- [完整原始碼 ZIP（含 iOS 原生專案）](https://github.com/The-RH/ribbon-queue/releases/download/v1.0.0/Ribbon-Queue-1.0.0-source.zip)

Windows 發行檔尚未使用商業程式碼簽章；Android APK 已以本專案的私有發行金鑰簽署。Android 相機與各店家網路仍需實機測試，請先用測試場次驗收。SHA-256 校驗碼列於 Release 附件。

| 平台 | 使用方式 | 發佈狀態 |
| --- | --- | --- |
| Windows 10/11 x64 | 安裝 Setup.exe，或直接開啟 Portable.exe；不必另外安裝 Node.js | 可在 Windows 建置與驗證 |
| Android 8.0 以上 | 安裝 APK，連接店家的 Windows／HTTPS 主機 | 原生 App，可側載安裝 |
| iPhone／iPad（iOS 15 以上） | iOS 原生專案位於 `ios/`，由 Xcode 簽署後安裝 | 需要 macOS、Xcode 與簽署；沒有 Apple Developer 會員時不能公開發佈 TestFlight／App Store 安裝版 |
| 手機與電腦瀏覽器 | 打開店家提供的活動網址；參加者不必安裝 App | 可直接使用 |

Windows 主機負責保存資料並發號，手機 App 是同步操作端。**手機 App 本身不會取代主機；主機關閉時，手機無法新增領號或核銷。** 若不使用 Windows 主機，可自行部署 Docker／Node.js 伺服器。

### 店家第一次操作

1. 開啟 Windows App，填寫店名、主機網址與至少 10 字元的工作人員通行碼。
2. 建立活動：活動名稱、領號開始／結束時間、票券失效時間、各款名稱與名額。款式照片可自行上傳，不附帶其他店家的照片。
3. 後台開啟本場 QR Code，列印海報或下載圖片，讓參加者掃碼。
4. 手機 App 與主機連同一個 Wi-Fi，到「店家設定／手機連線」掃連線 QR，再輸入工作人員通行碼。
5. 入場時掃參加者的票券 QR，確認款式，再按「確認入場」。只有出現核銷成功才放行。

區網網址通常像 `http://192.168.1.10:3210`。`127.0.0.1` 和 `localhost` 只能在主機自己使用，不能印給其他人的手機。Windows 防火牆若詢問網路權限，請由店家自行確認私人網路設定；本程式不會替你變更防火牆。

需要按現場隊伍順序發號時，請工作人員一次讓一人掃碼，看到號碼後再換下一位。公開 QR 的自助模式會依成功送出順序發號，不能辨識實體排隊先後。

## 功能

- 自訂店名、品牌色、時區與參加者可開啟的主機網址。
- 同時管理多場活動；每場、每款名額獨立，號碼由 001 開始。
- 排程開放、提早開放、暫停／恢復；延長結束與失效時間時保留原票。
- 每張票只能選一款，未核銷前可成功改選一次；額滿改選失敗不消耗機會。
- 增加或減少未領出的名額，送出前顯示前後數量；已領票券不會被減量取消。
- 同一操作重送不重複增減；同一領號代碼重送取得原票。
- 工作人員核銷一票一次，款式變更後必須重新查驗。
- 款式照片同頁放大、票券圖片儲存、海報列印、設定匯出。
- 相機無法啟用時，可貼上票券 QR 連結查驗。

## 時間、數量與資料

- 由**主機時間**決定開放及票券失效；各裝置顯示店家設定的時區。請讓主機系統時間正確。
- 「待入場」是已領、尚未核銷且未取消的票數，不能自動偵測實際現場人數。
- 已核銷及取消的票仍消耗本場名額；取消不會補發號碼。
- 活動停止發號後，票券失效前仍可核銷、改款與調整名額；調整名額不會自動重新開放領號。
- 票券失效立即依伺服器規則生效；匿名票券資料會在主機的每分鐘清理，或下一次啟動時刪除。主機關閉時不執行背景刪除。
- 清除瀏覽資料、換瀏覽器或換裝置可能失去原票；請先儲存圖片，並使用原瀏覽器操作。
- 隨機瀏覽器代碼能降低重複領號，不能保證一個自然人只領一次；清除資料或換裝置仍可能繞過。

## 從原始碼一鍵啟動

先安裝 **Node.js 22.21.1 以上**，下載原始碼後雙擊 `Start.cmd`。第一次會安裝相依套件及建置介面，之後直接啟動桌面 App。

開發者也可以：

```sh
npm ci
npm run build
npm test
npm run desktop
```

不開桌面視窗、只執行主機：`npm start`。第一次設定連結只會印在主機的啟動輸出，**不要把這個 owner-only 連結公開**。

## 自行部署

```sh
docker compose up -d --build
```

首次設定連結：`docker compose logs ribbon-queue`。請先依 [部署說明](docs/DEPLOYMENT.md) 設定 `PUBLIC_URL`。

公開網路請使用 HTTPS 反向代理。HTTP 僅供受信任的區域網路，傳輸本身未加密。原生 App 支援連接店家區網主機；瀏覽器相機需 HTTPS 或 localhost，區網 HTTP 下請用原生 App 或貼上票券連結。

## 建置與開源

- [各平台建置](docs/BUILD.md)：Windows 安裝包、Android 簽署 APK、iOS Xcode／CI。
- [操作手冊](docs/USER_GUIDE.md)：店家、工作人員及參加者流程。
- [安全與漏洞回報](SECURITY.md)、[隱私說明](PRIVACY.md)、[第三方授權](THIRD_PARTY_NOTICES.md)。
- [開源發佈檢查](docs/RELEASING.md)：先執行 `npm run release:check`，確認資料、通行碼與簽署檔不在公開版本。
- MIT 授權，歡迎其他店家使用、修改及自行部署。相依套件及原生掃碼函式庫保留各自授權。

本專案不附帶任何店家的真實活動資料、私有部署 ID、通行碼或品牌照片。Android／Windows 安裝包若未使用商業信任的簽章服務，作業系統可能顯示來源提示；請核對正式 Release 的 SHA-256，並依裝置的正常安裝流程處理。
