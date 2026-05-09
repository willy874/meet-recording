---
name: init
description: 為剛 clone 本專案的夥伴一鍵建立可運行的開發環境。檢查系統依賴（Python 3.10+、Node 18+、ffmpeg）、建立 backend 虛擬環境並安裝 requirements、執行 frontend `npm install`，最後給出啟動與驗證指令。觸發情境：使用者說「第一次 clone」「幫我把環境裝起來」「init 專案」「setup dev env」「跑不起來，幫我從頭設一次」等。
---

# init — Meet 專案首次環境建置

協助第一次拿到 repo 的人在最短時間內讓 backend / frontend 都能跑起來。流程要**冪等**：重複執行不應破壞現有狀態，而是檢測差異後補齊缺的部分。

## 適用情境

- 剛 clone 本 repo，尚未建立 `backend/.venv` 或 `frontend/node_modules`。
- 拉了新分支後依賴有變，要重新對齊環境。
- 環境壞了，想用一致流程從頭重建。

## 先決條件檢查（先做、不裝）

依序檢查並回報結果，缺什麼就**告訴使用者怎麼裝**，不要自己改系統設定。

| 工具 | 檢查指令 | 最低版本 | 缺少時建議 |
|------|----------|----------|------------|
| Python | `python3 --version` | 3.10 | macOS：`brew install python@3.11` |
| Node.js | `node --version` | 18 | macOS：`brew install node` 或用 `nvm` |
| npm | `npm --version` | 隨 Node | — |
| ffmpeg | `ffmpeg -version` | 任意 | macOS：`brew install ffmpeg` |
| git | `git --version` | 任意 | — |

把所有檢查結果**一次列出**（用單一 Bash call 平行跑），不要一個一個問。

## 建置流程

確認先決條件 OK 後，依序執行以下步驟。每一步成功才接下一步；失敗就停下來告訴使用者錯誤訊息與可能原因，**不要**靜默重試。

### 1. Backend：venv + 依賴

```bash
cd backend
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

注意事項：

- 已存在 `.venv` 就**不要重建**，直接用既有的跑 `pip install -r requirements.txt`（pip 自己會略過已安裝的套件）。
- `faster-whisper` 首次 import 會在執行時下載模型權重（預設 `medium`），這發生在第一次跑轉錄而不是 `pip install`。要主動提醒使用者：第一次轉錄會比較久。
- 若 pip 安裝過程出現 `ctranslate2` / `tokenizers` 編譯錯誤，通常是 Python 版本太舊或 macOS 缺 Xcode CLT，建議使用者執行 `xcode-select --install`。

### 2. Frontend：npm 依賴

```bash
cd frontend
npm install
```

- 若有 `package-lock.json`，優先用 `npm ci`（更快、更可重現）；沒有就退回 `npm install`。
- 看到 peer-dep warning 不必處理，僅當出現 `ERESOLVE` 失敗才需要介入。

### 3. 健康檢查（可選但建議）

啟動 backend 並驗證：

```bash
cd backend && ./run.sh &
sleep 3
curl -s http://localhost:7001/api/health
```

確認回傳 JSON 後再讓使用者自己決定是否保留這個 process。**不要**在背景留下使用者沒同意的長駐程序——驗證完就提醒怎麼關掉（或詢問是否保留）。

## 完成後要回報的內容

執行完畢後，給使用者一份簡短的「下一步」清單：

1. 啟動 backend：`cd backend && ./run.sh`（預設 `http://localhost:7001`）
2. 啟動 frontend：`cd frontend && npm run dev`（預設 `http://localhost:7002`）
3. 開瀏覽器到 `http://localhost:7002` 測試上傳
4. 想用 CLI：`backend/meet-cli ./your-audio.mp3 -l zh`
5. 想換模型：設定 `WHISPER_MODEL=large-v3`（細節見 `README.md`）

## 不要做的事

- **不要 `pip install` 到全域 Python**，一律走 `backend/.venv`。
- **不要**自己 `brew install` 任何東西；缺工具就回報並給指令，由使用者執行。
- **不要**動 `requirements.txt` 或 `package.json` 的版本——init 是還原環境，不是升級依賴。
- **不要**清掉 `.venv` 或 `node_modules` 來「重來一次」，除非使用者明確要求；先嘗試在既有狀態上補齊。
- **不要**啟動長駐 dev server 後就放著不管；驗證用的 process 要明確收尾或交還控制權給使用者。

## 失敗排查速查

| 症狀 | 常見原因 | 處理 |
|------|---------|------|
| `python3: command not found` | 沒裝 Python 3 | 請使用者裝，停下流程 |
| `pip install` 卡在 `ctranslate2` | Python 版本不符 / 缺編譯工具 | 升級 Python 或 `xcode-select --install` |
| `npm install` 出現 `ERESOLVE` | lock 與 package.json 衝突 | 刪掉 `node_modules` + `package-lock.json` 後重試（先問過使用者） |
| `./run.sh` 跑但 `/api/health` 連不上 | port 被占用 | 改 `PORT=7011 ./run.sh` 或找出占用 port 的 process |
| 前端 `/api/...` 502 | backend 沒起來或 port 不對 | 先確認 backend 健康，再看 `vite.config.ts` 的 proxy 設定 |
| ffmpeg 不在 PATH | 沒裝或裝在非標準位置 | `brew install ffmpeg` 或設 PATH |
