# 平台建置

## 共用檢查

Node.js 22.21.1 以上，執行 `npm ci`、`npm test`、`npm run check`、`npm run build`。

不要將店家 `data/`、Windows 使用者資料、`.env`、`.signing/`、憑證或原場次照片放入 Git。

## Windows

```sh
npm run package:windows
```

輸出在 `release/`，包含安裝版與免安裝版（x64）。包含 Electron 執行環境，使用者不需安裝 Node.js。

Windows 版本未設定商業程式碼簽章時屬未驗證發行者；這與 Android APK 簽章、iOS 簽署不同。請勿宣稱安裝檔已經 Microsoft 信任簽署。

## Android

需要 JDK 21、Android SDK Platform 36、Build Tools 36.0.0／35.0.0。App 最低 Android 8（API 26），原生掃碼使用官方 Capacitor Barcode Scanner。

設定 `JAVA_HOME`、`ANDROID_HOME` 後：

```sh
npm run android:build
```

預設產生 debug-signed APK，供開發測試，不上架商店。

發行 APK：

```sh
node scripts/build-android.mjs --release
```

若沒有提供 `RIBBON_KEYSTORE_PATH`／`RIBBON_KEYSTORE_PASSWORD`／`RIBBON_KEYSTORE_ALIAS`，腳本會在本機 `.signing/` 建立私有發行金鑰。**備份整個 `.signing/` 並保密；同一 App 後續更新需要同一把金鑰。** 它不會加入 Git，也不會包含在原始碼 ZIP。

GitHub Actions 可透過自己的 repository secrets 設定發行金鑰；預設 CI 只產出 debug APK，不會替任意 fork 共用私人金鑰。不同簽署者的 APK 不能直接覆蓋更新；fork 若要獨立發佈，請修改 `capacitor.config.ts`、Android applicationId 與 iOS bundle identifier。

## iOS

iOS 原生專案已包含在 `ios/`，採 Swift Package Manager。

```sh
npm ci
npm run build
npx cap sync ios
npx cap open ios
```

需在 macOS 使用 Xcode 26 以上開啟 `ios/App/App.xcodeproj`，選擇自己的 Development Team，再建立 Archive。

- GitHub Actions 的 macOS job 可以建置未簽署的 iOS Simulator `.app`，用於編譯驗證；**Simulator `.app` 不能裝到 iPhone。**
- 個人 Apple ID 在 Xcode 可作有限的個人裝置開發測試，不能取代對外公開發佈。
- TestFlight／App Store 的公開散佈需要 Apple Developer Program、有效憑證及 App Store Connect 設定。本專案不附帶任何人的簽署身分。

在沒有開發者會員或 macOS 建置結果時，應明確標示「iOS 原生專案已備妥，尚未產生可公開安裝的簽署版」，不可將未簽署 IPA 或網頁當作已完成的 iPhone 原生安裝版。

## 原生權限與連線

App 只要求掃碼用的相機及連接店家主機的區網存取。儲存／分享圖片使用 App 暫存目錄與系統分享面板，不要求聯絡人或定位。主機連線 QR 只包含網址，不包含工作人員通行碼。

區網 HTTP 需要原生網路例外；App 不載入遠端 JavaScript，UI 隨安裝包附帶。公開主機應使用 HTTPS，並由店家確認網路與存取範圍。
