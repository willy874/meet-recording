# Meet · 逐字稿轉換工具

將音訊／影片上傳後，使用 [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 進行語音辨識，並透過 SSE 將段落即時串流回前端。

- **後端**：FastAPI + faster-whisper（CTranslate2）
- **前端**：Vite + React 19 + TypeScript
- **傳輸**：`multipart/form-data` 上傳 → `text/event-stream` 逐段回傳

## 專案結構

```
meet/
├── backend/
│   ├── main.py            FastAPI app（/api/health、/api/transcribe）
│   ├── cli.py             CLI 進入點（rich TUI + JSON 模式）
│   ├── meet-cli           CLI 啟動腳本
│   ├── requirements.txt
│   └── run.sh             啟動 uvicorn（reload 模式，預設 PORT=7001）
└── frontend/
    ├── src/
    │   ├── App.tsx        上傳、SSE 解析、轉錄結果顯示
    │   ├── App.css
    │   └── main.tsx
    ├── vite.config.ts     /api proxy 至 :8000
    └── package.json
```

## 環境需求

- Python 3.10+
- Node.js 18+
- `ffmpeg`（faster-whisper 解碼音訊用）

> 用 [Claude Code](https://claude.com/claude-code) 的夥伴可直接執行 `/init`，會檢查依賴、建立 `backend/.venv` 並裝好 frontend `node_modules`。

## 啟動

### 後端

首次需建立虛擬環境並安裝依賴：

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
./run.sh                          # http://localhost:7001
```

可選環境變數：

| 變數 | 預設 | 說明 |
|------|------|------|
| `WHISPER_MODEL` | `medium` | `tiny` / `base` / `small` / `medium` / `large-v3` |
| `WHISPER_DEVICE` | `cpu` | 有 CUDA 時可用 `cuda` |
| `WHISPER_COMPUTE` | `int8` | GPU 建議 `float16` |
| `PORT` | `7001` | 後端監聽 port |

範例：

```bash
WHISPER_MODEL=large-v3 WHISPER_DEVICE=cuda WHISPER_COMPUTE=float16 ./run.sh
```

### 前端

```bash
cd frontend
npm install
npm run dev                       # http://localhost:7002
```

Vite dev server 已將 `/api` proxy 至 `http://localhost:7001`，因此前端不需要處理 CORS。

production build：`npm run build`，產物在 `frontend/dist/`。

## 使用流程

1. 同時啟動後端與前端
2. 開啟 `http://localhost:7002`
3. 選擇音訊／影片檔
4. 選語言（預設 zh-TW 繁體中文；亦可選 zh-CN／英／日／韓或自動偵測）；可切換 VAD 過濾靜音
5. 點「開始轉錄」，段落會即時串流出現；可隨時「中止」
6. 結束後可「複製全文」或下載 `.txt`

## Web-driven 模式（`--serve`）

只想用 CLI 啟一鍵環境，再回到瀏覽器選檔／開直播？

```bash
./meet-cli --serve --outputs-dir ./outputs            # 印出 banner，自己點 URL
./meet-cli --serve --outputs-dir ./outputs --open     # 啟動完自動開瀏覽器
# 預設同時拉前端：http://localhost:7002
```

啟動完成後 CLI 會印一個 banner，列出 Web UI / Backend / Outputs 三個 URL，在支援 OSC-8 的終端機（iTerm2、Warp、新版 Terminal.app、VS Code…）可以直接 Cmd-Click 開啟。`--open` 旗標會自動用系統預設瀏覽器打開 Web UI（其它模式只要加 `--web` 一起，也吃 `--open`）。

CLI 在 `--serve` 模式下不會建立任何 job，只負責：

- 啟動後端（將 `--outputs-dir` 寫入 `MEET_OUTPUTS_DIR`，所有 `outputs/{job_id}.txt` 都會落到這個資料夾）
- 啟動前端（dev server）
- Ctrl-C 時一起收掉

之後上傳檔案、切到「OBS 直播」分頁、暫停／取消／下載逐字稿都從 Web UI 操作。CLI 與 Web 共享同一個 backend，從 `meet-cli ./file.mp3` 建立的任務也會出現在側欄。

## OBS 即時直播轉錄

後端可作為 ffmpeg 監聽端，接收 OBS 推來的串流並做滾動轉錄。預設監聽 `tcp://0.0.0.0:9999?listen=1`（MPEG-TS over TCP，OBS／ffmpeg 不需要額外伺服器）。

啟動方式（任選一）：

- **前端**：左側「+ 新轉錄」→ 切到「OBS 直播」分頁 → 確認/修改監聽 URL → 「開始監聽」。
- **CLI**：`./meet-cli --live` 會建立直播任務並進入 TUI。可加 `--listen-url`、`--chunk-seconds`、`--label`。
- **API**：`POST /api/live`（form：`listen_url` / `language` / `vad` / `beam_size` / `chunk_seconds` / `label`）。

OBS 設定（最簡單）：

1. 設定 → 輸出 → 輸出模式：**進階** → 錄製 → 類型：**自訂輸出 (FFmpeg)**
2. 「檔案路徑或 URL」填 `tcp://127.0.0.1:9999`（OBS 端不要 `?listen=1`）
3. 容器格式選 `mpegts`，音訊位元率隨意；視訊可關閉
4. 後端／CLI／前端先「開始監聽」，再到 OBS 按「開始錄製」

也支援其他協定，調 `--listen-url`／`MEET_LIVE_LISTEN_URL` 即可，例如：

- SRT：`srt://0.0.0.0:9999?mode=listener`（OBS 直播分頁原生支援 SRT）
- UDP：`udp://0.0.0.0:9999?listen=1`

事件型別與檔案模式相同，多一筆 `listening`（模型載入完、ffmpeg 已開始監聽）。逐字稿仍會寫到 `outputs/{job_id}.txt`，可隨時下載。直播模式以固定秒數切 chunk（預設 6 秒），段落邊界可能會切到字，可改 `chunk_seconds` 微調。

## CLI

`./meet-cli` 提供 TUI 即時面板與 `--json` 機器可讀模式，並會在後端未啟動時自動拉起、結束時清理。完整說明見 [`CLI.md`](./CLI.md)（en-US，給 AI 閱讀）。

```bash
# 互動面板
./meet-cli ./meeting.mp3 -l zh

# 給 AI / script 用的 line-delimited JSON
./meet-cli ./meeting.mp3 -l zh --json -o transcript.txt
```

事件型別：`estimate` → `info` → `segment*` → `done | error`。

## API

### `GET /api/health`

回傳目前載入的模型設定：

```json
{ "ok": true, "model": "medium", "device": "cpu", "compute": "int8" }
```

### `POST /api/transcribe`

`multipart/form-data` 欄位：

| 欄位 | 型別 | 預設 | 說明 |
|------|------|------|------|
| `file` | File | — | 音訊／影片檔（必填） |
| `language` | string | `zh-TW` | `zh-TW`／`zh-CN`／`zh`／`en`／`ja`／`ko` …，傳空字串或省略則為 zh-TW；前端可選「自動偵測」會傳空字串。`zh-TW`／`zh-CN` 會自動帶 Traditional／Simplified 的 `initial_prompt` 偏好繁／簡輸出 |
| `vad` | bool | `true` | 是否啟用 VAD 靜音過濾 |
| `beam_size` | int | `5` | beam search 大小 |

回傳 `text/event-stream`，每筆 `data:` 行為一個 JSON：

```jsonc
{ "type": "estimate", "duration_seconds": 754.3, "eta_seconds": 452.6,
  "model": "medium", "device": "cpu", "compute": "int8" }
{ "type": "info",     "language": "zh", "language_probability": 0.99, "duration": 754.3 }
{ "type": "segment",  "start": 0.0, "end": 3.2, "text": "……" }
{ "type": "done" }
{ "type": "error",    "message": "..." }
```

`estimate` 為上傳後 `ffprobe` 取出音檔時長 × 模型 RTF 的粗估，最先送出。

前端取消請求時直接 `AbortController.abort()` 即可，後端會在串流結束時清除暫存檔。

## 備註

- 模型在第一次呼叫 `/api/transcribe` 時才會載入並常駐記憶體；首次請求較慢屬正常。
- 後端 `CORSMiddleware` 目前設為 `*`，若部署到公開環境請收斂來源。
- 暫存檔放在系統 `tempfile`，請求結束會自動刪除。
