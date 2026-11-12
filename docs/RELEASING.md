# 發布版本

1. 執行 `npm ci`、`npm test`、`npm run check`、`npm run build`。
2. 執行 `npm run package:windows` 與 `node scripts/build-android.mjs --release`。
3. 執行 `npm run release:check` 檢查 Git 追蹤檔案；只發布乾淨原始碼與 `release/` 的安裝檔。
4. 使用 `git archive` 產生原始碼 ZIP。不要直接壓縮整個工作資料夾。
5. 為每個發布檔產生 SHA-256，附於 GitHub Release。金鑰、店家資料、測試資料不隨發布。

Android 簽署金鑰需由維護者私下備份；公開原始碼不包含簽署金鑰。Windows 安裝檔尚未使用商業程式碼簽章。iOS 尚未產生可公開安裝的簽署版本，請勿以模擬器成品代替。

CI 會執行伺服器測試、型別檢查、Android debug 建置與 iOS 模擬器編譯。CI 成功不代表實機相機／不同區網已驗收，對外發布前應以實機連線、掃碼、核銷測試。
