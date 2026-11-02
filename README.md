# 英文家教

看中文、用英文回答（打字或錄音），由 Gemini 批改文法並評發音。課文從 Google 雲端硬碟匯入（Google 文件、Word 檔），練習紀錄存在雲端硬碟的「英文家教資料.json」，手機和電腦同步。

```
手機/電腦 ──▶ 網頁（GitHub Pages，index.html）
                 │  帶通行碼呼叫
                 ▼
            Apps Script 後端（Code.gs）：金鑰、紀錄、讀雲端硬碟
                 ▼
            Gemini API
```

網頁要放在 GitHub Pages，是因為 Apps Script 的網頁不能使用麥克風。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 網頁（GitHub Pages） |
| `Code.gs` | 後端，貼到 Apps Script |
| `tests/run.js` | 離線測試（`node tests/run.js`），模擬 Google 服務，不是真實環境 |

網頁裡沒有金鑰、通行碼或雲端硬碟資料夾，這些都存在 Apps Script 或使用者的瀏覽器裡，所以這個儲存庫可以公開。

## 後端部署（Apps Script）

1. 打開英文家教的 Apps Script 專案，把 `程式碼.gs` 的內容全部換成 `Code.gs`，存檔。
2. 原本的 `Index.html` 檔可以刪掉（後端不再提供網頁）。
3. **產生通行碼**：上方函式選單選 `setupToken` → 按「執行」→ 下方「執行記錄」會顯示「你的通行碼：xxxx」，複製起來。
4. **部署 → 管理部署作業 → ✏️ 編輯**：
   - 版本：**新版本**
   - 執行身分：**我**
   - 誰可以存取：**任何人**（網頁在 GitHub 上，必須這樣才連得到；靠通行碼擋陌生人）
5. 部署後複製網址（結尾 `/exec`）。

## 網頁設定（每支手機、每台電腦第一次用時）

1. 打開 <https://lamp4615-design.github.io/english-tutor/>
2. 設定頁輸入 **通行碼** → 連線（後端網址已寫在 `index.html` 的 `DEFAULT_API_URL`；換部署網址時要改這裡）。
3. 手機可以「加到主畫面」。

## 之後更新

- 改 `index.html`：推到 GitHub，約 1 分鐘後生效。
- 改 `Code.gs`：貼到 Apps Script → 管理部署作業 → 編輯 → 新版本 → 部署。
- 通行碼外流時：重新執行 `setupToken`，各裝置重新輸入新的通行碼。

## 狀態（2026-11-02）

- Apps Script 版已在手機實測：匯入、批改、存檔正常；網頁內麥克風被 Apps Script 擋住，因此改成這個架構。
- 錄音分析：預設「仔細」（gemini-3.5-flash，約 10 秒，忙線時自動改 lite）；可切「快速」（gemini-3.5-flash-lite，約 3 秒）。回饋包含文法規則與例句、更自然的說法、四項發音分數、重音標記、語調、連音、逐字發音、練習建議。
- 真人語調語音：gemini-3.1-flash-tts-preview（備用 2.5），🔊 正常、🐢 慢速；產生過的存在雲端硬碟「英文家教語音」資料夾重複使用。失敗時改用瀏覽器語音。
- 測試：離線 97 項＋瀏覽器模擬 35 項通過；提示詞與語音已用真實 Gemini API 驗證（合成語音）。
- **尚未在真實手機驗證**：錄音（Android Chrome、iPhone Safari）、iPhone 上 🔊 播放。
