# Meet · 逐字稿轉換工具

把音訊／影片轉成逐字稿，或讓 OBS 推串流進來做**即時轉錄**。前端用瀏覽器看段落即時跳出來，CLI 提供一鍵啟動與機器可讀模式。

- **後端**：FastAPI + [faster-whisper](https://github.com/SYSTRAN/faster-whisper)（CTranslate2，CPU/CUDA 都能跑）
- **前端**：Vite + React 19 + TypeScript
- **傳輸**：`multipart/form-data` 上傳（檔案）或 ffmpeg listener（直播）→ `text/event-stream` 逐段回傳

## 功能總覽

- 🗂 **檔案轉錄**：拖檔上傳，逐段 SSE 回傳；可暫停／繼續／中止；複製全文或下載 `.txt`
- 🔴 **OBS 即時直播轉錄**：meet 跑 ffmpeg listener、OBS 推 TCP/UDP 過來，每 N 秒一段地轉
- 🎬 **同步保留影片檔**：直播時可勾選同時把原串流 stream-copy 一份成 `mkv`/`mp4`/`ts`，**不重編、零 CPU 開銷**
- 🧠 **多語言**：`zh-TW`／`zh-CN`／`zh`／`en`／`ja`／`ko` 等，或 `auto` 自動偵測；繁／簡會自動帶 initial prompt 偏好正確字形
- 🖥 **CLI 一鍵啟動**：`./meet-cli --serve --open` 把 backend + frontend 拉起來、自動開瀏覽器
- 🔁 **CLI 與 Web 共享 jobs**：CLI 建立的任務在側欄看得到、可從 Web 控制；反之亦然
- 🤖 **機器可讀模式**：`--json` 把 SSE 事件以 NDJSON 印到 stdout，方便接 agent / pipeline

---

## 環境需求

| 工具 | 版本 | 用途 |
|------|------|------|
| **Python** | 3.10+ | 後端 + Whisper |
| **Node.js** | 18+ | 前端 dev server / build |
| **ffmpeg** | 任意現代版本 | 解碼上傳檔案；直播模式做 listener 與錄影 muxing |

macOS（Homebrew）一行裝完：

```bash
brew install python@3.13 node ffmpeg
```

> 用 [Claude Code](https://claude.com/claude-code) 的話可直接執行 `/init`，會檢查依賴並裝好 `backend/.venv` 與 `frontend/node_modules`。

---

## 下載與初始化

```bash
# 1. 取下來
git clone <repo-url> meet
cd meet

# 2. 後端 venv + 依賴
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..

# 3. 前端依賴
cd frontend
npm install
cd ..

# 4.（可選）想全域用 meet-cli，把 repo 根加到 PATH
export PATH="$PWD:$PATH"          # 暫時；寫進 ~/.zshrc 永久
# 或做 symlink
# ln -sf "$PWD/meet-cli" /usr/local/bin/meet-cli
```

**首次跑 Whisper 會下載模型**（預設 `medium`，約 1.5 GB），模型快取在 `~/.cache/huggingface/`。模型可以**逐一任務選擇**——Web UI 的「模型」下拉選單、CLI 的 `--model`；沒指定就用 `WHISPER_MODEL`。哪些已經下載好了，UI 會直接標示，也可以打 `GET /api/models` 查。詳見 [選擇模型](#選擇模型)。

---

## 啟動

### 方式一：CLI 一鍵（推薦）

```bash
./meet-cli --serve --outputs-dir ./outputs --open
```

CLI 會：
1. 起 backend（uvicorn reload，預設 `:7001`），把 `--outputs-dir` 寫進 `MEET_OUTPUTS_DIR`，所有逐字稿／錄影檔都會落到這個資料夾
2. 起 frontend（Vite dev server，預設 `:7002`）
3. 印 banner、自動用系統預設瀏覽器開 Web UI（`--open`）
4. Ctrl-C 時把兩個一起收掉

Banner 長這樣（在支援 OSC-8 的終端機裡 URL 可 Cmd-Click）：

```
╭──────────────── Meet · ready ────────────────╮
│  Web UI  http://localhost:7002              │
│ Backend  http://127.0.0.1:7001              │
│ Outputs  /Users/you/code/meet/outputs       │
│          serve mode — Ctrl-C to stop        │
╰─────────────────────────────────────────────╯
```

### 方式二：手動分開啟動

```bash
# Terminal A — 後端
cd backend
./run.sh                          # http://localhost:7001
# 自訂環境變數例：
# WHISPER_MODEL=large-v3 WHISPER_DEVICE=cuda WHISPER_COMPUTE=float16 ./run.sh
# MEET_OUTPUTS_DIR=/path/to/outputs ./run.sh

# Terminal B — 前端
cd frontend
npm run dev                       # http://localhost:7002
```

Vite 已將 `/api` proxy 到 `http://localhost:7001`，前端不需處理 CORS。  
Production build：`npm run build`，產物在 `frontend/dist/`。

---

## 使用流程

### A. 檔案轉錄

1. 開 `http://localhost:7002`
2. 左欄「+ 新轉錄」→ 上方分頁停在「**檔案上傳**」
3. 選音訊／影片檔（任何 ffmpeg 認得的格式都行：mp3 / m4a / wav / mp4 / mkv …）
4. 選語言（預設**繁體中文**）、視需要開關 VAD 過濾靜音
5. 「開始轉錄」→ 段落即時冒出，可隨時 ⏸ 暫停、▶ 繼續、⏹ 終止
6. 完成後「複製全文」或「下載 .txt」；檔案落在 `outputs/{job_id}.txt`

### B. OBS 即時直播轉錄

> 重點順序：**先在 meet 按「開始監聽」，再去 OBS 按「開始錄製」**。  
> meet 是 listener、OBS 是 connector，meet 沒先聽好，OBS 一接就 `Connection refused`。

#### B-1. meet 端

1. 「+ 新轉錄」→ 切到「**OBS 直播**」分頁
2. 「監聽 URL」維持預設 `tcp://0.0.0.0:9999?listen=1`（後端會自動補 `?listen=1`，少打也沒關係）
3. 語言、chunk 秒數（預設 6）、視需要勾「**☑ 同步保留影片檔**」並選格式
4. 按「**開始監聽**」
5. 任務出現在左欄，看到 `🔴 直播模式 · 已就緒` 就是 ffmpeg 已 listen 在 9999

#### B-2. OBS 端（一次設定即可）

打開 OBS → 設定 → 輸出：

| 欄位 | 設定值 |
|------|--------|
| 輸出模式 | **進階** |
| 分頁 | **錄製** |
| 類型 | **自訂輸出 (FFmpeg)** |
| FFmpeg 輸出類型 | **輸出到 URL** |
| 檔案路徑或 URL | `tcp://127.0.0.1:9999`　← **`tcp://`，不要加 `?listen=1`** |
| 容器格式 | `mpegts` |
| 視訊編碼器 | `libx264`（或留預設） |
| 音訊編碼器 | `aac` |
| 音訊位元率 | `128` 以上 |
| 音訊軌道 | 勾你要的（通常是 1） |

> 如果只想轉語音、節省 CPU，可在「視訊位元率」改低（例 500），或乾脆只勾音訊軌、視訊不編。

按確定。

#### B-3. 開錄

OBS 主視窗右下「**開始錄製**」（不是「開始直播」，因為設定在「錄製」分頁）。回到瀏覽器：逐字稿一段一段冒出來。

結束時：
- 想保留逐字稿與錄影：**先在 OBS 按「停止錄製」**，meet 那邊串流結束會自動進入 `done`，影片會 mux 完整
- 直接喊停：在 meet 頁面按「**⏹ 停止監聽**」也行（但若有錄影、用 mp4 容器可能 moov atom 沒寫完整 → 用 mkv 較安全）

#### B-4. 驗證連線（可選）

在 terminal：

```bash
lsof -nP -iTCP:9999
```

應該看到兩條 `ESTABLISHED`：

```
ffmpeg  ...  127.0.0.1:9999->127.0.0.1:NNNNN (ESTABLISHED)
obs     ...  127.0.0.1:NNNNN->127.0.0.1:9999 (ESTABLISHED)
```

#### B-5. 進階：其他協定

只要 ffmpeg 編譯時有對應 protocol，就能換：

| 協定 | meet 端監聽 URL | OBS 端輸出 URL | 備註 |
|------|------------|------------|------|
| TCP MPEG-TS（預設） | `tcp://0.0.0.0:9999?listen=1` | `tcp://127.0.0.1:9999` | 最相容，零依賴 |
| UDP MPEG-TS | `udp://0.0.0.0:9999?listen=1` | `udp://127.0.0.1:9999` | 封包丟失不重傳，僅同機建議 |
| SRT | `srt://0.0.0.0:9999?mode=listener` | `srt://127.0.0.1:9999`（OBS「直播」分頁） | 需要 ffmpeg 編入 libsrt（`ffmpeg -protocols \| grep '^srt$'` 確認） |

換協定方法：在 meet 表單改 URL，或啟動時帶 `MEET_LIVE_LISTEN_URL`／CLI `--listen-url`。

---

## 選擇模型

模型是**每個任務各自決定**的：Web UI「新轉錄」表單裡的「模型」下拉（檔案轉錄與 OBS 直播都有），CLI 用 `--model`。後端的 `WHISPER_MODEL` 只決定預設值。

下拉選單會標示哪些模型還沒下載（含檔案大小）；選了沒下載的模型，任務開頭會先卡在下載，UI 會事先提醒。

以下數字實測於 Apple Silicon、CPU + `int8`、`beam_size=5`、開 VAD、中文語音。`rtf` 是「處理 1 秒音訊要花幾秒」，**超過 1.0 就代表比實時還慢**：

| 模型 | 大小 | rtf | 轉檔案 | 直播（`--live`） |
|------|------|-----|--------|------------------|
| `tiny` | 75 MB | ~0.08 | 最快，準度低 | ✅ chunk 4s 以上 |
| `base` | 145 MB | ~0.12 | 快 | ✅ chunk 5s 以上 |
| `small` | 480 MB | ~0.25 | 折衷 | ✅ chunk 8s 以上 |
| `medium` | 1.5 GB | ~0.6 | **預設** | ✅ **chunk 15s 以上** |
| `large-v2` | 2.9 GB | ~1.7 | 高準度 | ❌ 比實時慢 |
| `large-v3` | 2.9 GB | ~1.9 | **最準** | ❌ 比實時慢 |

**簡單講：直播用 `medium`，事後轉檔案用 `large-v3`。**

### 直播的 chunk 秒數怎麼選

每個 chunk 必須在下一個 chunk 到齊前轉完，所以關鍵比值是「處理時間 ÷ chunk 秒數」，得低於 1.0。chunk 太短會輸，因為每段都有固定成本（載入呼叫、VAD、prompt），攤在越少音訊上越不划算。`medium` 實測：

| chunk 秒數 | 處理時間 | 比值 | 結果 |
|------------|----------|------|------|
| 6（原預設） | ~5.9s | 0.98 | ⚠️ 會落後 |
| 10 | ~7.1s | 0.71 | 勉強 |
| **15** | ~9.1s | 0.61 | ✅ 穩 |
| 20 | ~11.4s | 0.57 | ✅ 穩，但延遲高 |

代價是延遲：一段字幕最晚會在說完後一個 chunk 才出現。`medium` 用 **15 秒**最平衡。

這招救不了 `rtf > 1.0` 的模型。運算量隨音訊長度等比成長，所以 `large-v3` 不管 chunk 設 6/10/15/20 秒，比值都落在 1.83–2.14——延遲只會越積越多，不會收斂。CLI 會印 warning，Web UI 會跳紅色提示並提供一鍵換回 `medium`。

## 同步保留影片檔（直播模式）

勾「☑ 同步保留影片檔」後，後端用**單一 ffmpeg、雙 output** 完成：

```
ffmpeg -i tcp://0.0.0.0:9999?listen=1 \
  -map 0   -c copy   outputs/{job_id}.mkv     ← stream-copy，0% 重編
  -map 0:a -ac 1 -ar 16000 -f s16le pipe:1    ← 給 whisper
```

| 格式 | 適用 | 註記 |
|---|---|---|
| **mkv**（推薦） | 大多數情況 | 串流被中斷／你按停止監聽，檔案仍可播；最寬容 |
| mp4 | iPhone / QuickTime 相容性最好 | 若 ffmpeg 沒乾淨結束，moov atom 可能沒寫完整、需 `ffmpeg -i broken.mp4 -c copy fixed.mp4` 救 |
| ts | 適合進一步處理／串流分段 | 不適合直接給人看 |

完成（或中止）後 Web UI 會出現「下載錄影」按鈕；也可直接抓 `outputs/{job_id}.{mkv|mp4|ts}`。

---

## CLI 參數速查

完整給 AI／script 用的版本見 [`CLI.md`](./CLI.md)（en-US）。常用：

```bash
# 一鍵：起 backend + frontend，瀏覽器自動打開，逐字稿落到 ./outputs
./meet-cli --serve --outputs-dir ./outputs --open

# 跑單個檔案，TUI 面板顯示進度
./meet-cli ./meeting.mp3 -l zh-TW

# 給 agent / pipeline 用，stdout 就是 NDJSON
./meet-cli ./meeting.mp3 --json -o transcript.txt

# 直接從 CLI 開直播任務（也會顯示 TUI；OBS 那邊照同樣方式推）
./meet-cli --live --label "週會"
./meet-cli --live --listen-url 'srt://0.0.0.0:9999?mode=listener'
```

| 參數 | 用途 |
|---|---|
| `file` | 要轉的檔案；用 `--live` / `--serve` 時可省略 |
| `-l, --language CODE` | `zh-TW`／`zh-CN`／`zh`／`en`／`ja`／`ko` …／`auto`（預設 `zh-TW`） |
| `--no-vad` | 關 VAD 靜音過濾 |
| `--beam-size N` | beam search 大小（預設 5） |
| `-m, --model NAME` | 這個任務用哪個模型：`tiny`／`base`／`small`／`medium`／`large-v2`／`large-v3`（預設沿用後端的 `WHISPER_MODEL`）。詳見 [選擇模型](#選擇模型) |
| `-o, --output PATH` | 把終版逐字稿寫到指定文字檔 |
| `--live` | 直播模式 |
| `--listen-url URL` | 直播 listener URL（預設 `tcp://0.0.0.0:9999?listen=1`） |
| `--chunk-seconds N` | 直播 chunk 秒數（預設 6） |
| `--label TEXT` | 直播任務在側欄顯示的標籤 |
| `--serve` | servers-only；不建任何 job，由 Web UI 控制 |
| `--outputs-dir DIR` | 後端逐字稿／錄影輸出目錄（注入 `MEET_OUTPUTS_DIR`） |
| `--web` / `--web-port N` | 同時起前端 dev server |
| `--open` | 啟動完用系統預設瀏覽器開 Web UI（imply `--web`） |
| `--json` | NDJSON 輸出（取代 TUI） |
| `--host` / `--port` | 接到非預設 backend；可搭 `--no-autostart` |

---

## 環境變數

| 變數 | 預設 | 說明 |
|------|------|------|
| `WHISPER_MODEL` | `medium` | **預設**模型；每個任務都可用 UI 的「模型」下拉或 CLI `--model` 個別覆寫 |
| `WHISPER_DEVICE` | `cpu` | 有 NVIDIA GPU 可改 `cuda` |
| `WHISPER_COMPUTE` | `int8` | CPU 用 `int8` 最快；CUDA 建議 `float16` |
| `PORT` | `7001` | 後端 port |
| `MEET_HOST` | `127.0.0.1` | CLI 預設要連的 backend host |
| `MEET_PORT` | `7001` | CLI 預設要連的 backend port |
| `MEET_OUTPUTS_DIR` | `<repo>/outputs` | 後端寫逐字稿／錄影的目錄 |
| `MEET_LIVE_LISTEN_URL` | `tcp://0.0.0.0:9999?listen=1` | 直播 listener 預設 URL |
| `MEET_WEB_PORT` | `7002` | CLI `--web` 預設 port |

---

## API 參考

後端是 job-based。所有狀態、事件都繞著 `Job` 走。

### `GET /api/health`

```json
{
  "ok": true,
  "model": "medium", "device": "cpu", "compute": "int8",
  "models": ["tiny", "base", "small", "medium", "large-v2", "large-v3"],
  "outputs_dir": "/Users/you/code/meet/outputs",
  "default_live_listen_url": "tcp://0.0.0.0:9999?listen=1"
}
```

`model` 是**預設**模型；`models` 是可選清單。

### `GET /api/models` — 模型清單

```json
{
  "default": "medium", "device": "cpu", "compute": "int8",
  "models": [
    {
      "id": "medium", "params": "769M", "size": "1.5 GB",
      "note": "預設，直播用這個",
      "rtf": 0.6, "live_chunk": 15, "live_viable": true, "cached": true
    }
  ]
}
```

| 欄位 | 說明 |
|------|------|
| `rtf` | 處理 1 秒音訊要花幾秒（CPU int8 實測／推估） |
| `live_chunk` | 直播建議的最小 chunk 秒數 |
| `live_viable` | `false` = 比實時慢，直播無解，只適合轉檔案 |
| `cached` | 權重是否已下載完成（`false` 代表首次使用要先等下載） |

### `POST /api/jobs` — 建立檔案轉錄任務

`multipart/form-data`：

| 欄位 | 型別 | 預設 | 說明 |
|------|------|------|------|
| `file` | File | — | 必填 |
| `language` | string | （空）= `zh-TW` | `zh-TW`／`zh-CN`／`zh`／`en`／…／`auto`／空 |
| `vad` | bool | `true` | VAD 靜音過濾 |
| `beam_size` | int | `5` | beam search |
| `model` | string | 後端 `WHISPER_MODEL` | 這個任務用的模型；不在 `/api/models` 清單內回 400 |

回 `{"id": "<job_id>", "model": "medium"}`。

### `POST /api/live` — 建立直播任務

`multipart/form-data`：

| 欄位 | 型別 | 預設 | 說明 |
|------|------|------|------|
| `listen_url` | string | `tcp://0.0.0.0:9999?listen=1` | tcp/udp 缺 `?listen=1` 會自動補 |
| `language` | string | （同上） | |
| `vad` | bool | `true` | |
| `beam_size` | int | `5` | |
| `chunk_seconds` | float | `6.0` | 滾動 chunk 秒數 |
| `model` | string | 後端 `WHISPER_MODEL` | 這個任務用的模型；不在清單內回 400 |
| `label` | string | — | 顯示標籤 |
| `record` | bool | `false` | 是否同步保留影片檔 |
| `record_format` | string | `mkv` | `mkv` / `mp4` / `ts` / `flv` / `mov` |

回 `{"id": "...", "listen_url": "...", "chunk_seconds": ..., "record_path": "...", "model": "medium", "recommended_chunk_seconds": 15}`。

`recommended_chunk_seconds` 是該模型建議的最小 chunk；送出的 `chunk_seconds` 比它小就代表可能追不上串流。

### `GET /api/jobs`、`GET /api/jobs/{id}`

列表 / 詳細。詳細含 `estimate`／`info`／`segments`／`live`／`listen_url`／`record_path`。

### `GET /api/jobs/{id}/events` — SSE 串流

每筆 `data:` 行是一筆 JSON：

```jsonc
// 檔案模式才有：上傳後 ffprobe 取出時長 × 模型 RTF 的粗估
{ "type": "estimate", "duration_seconds": 754.3, "eta_seconds": 452.6,
  "model": "medium", "device": "cpu", "compute": "int8" }

// 直播模式才有：模型載入完、ffmpeg 已 listen
{ "type": "listening", "url": "tcp://0.0.0.0:9999?listen=1",
  "chunk_seconds": 6.0, "sample_rate": 16000, "record_path": null }

// 模型分析音訊 header 之後
{ "type": "info", "language": "zh", "language_probability": 0.99, "duration": 754.3 }

// 一段一筆
{ "type": "segment", "start": 0.0, "end": 3.2, "text": "…" }

// 任務狀態變化
{ "type": "state", "status": "running|paused|done|error|cancelled", "error": null }

// 終止
{ "type": "done" }
{ "type": "error", "message": "..." }
```

訂閱前已產生的事件會 **完整 replay**，可中途連入不漏資訊。

### 控制

| 端點 | 動作 |
|------|------|
| `POST /api/jobs/{id}/pause` | SIGSTOP worker process group（直播模式不建議用） |
| `POST /api/jobs/{id}/resume` | SIGCONT |
| `POST /api/jobs/{id}/cancel` | SIGTERM、status → `cancelled` |
| `GET /api/jobs/{id}/output` | 下載 `.txt` |
| `GET /api/jobs/{id}/recording` | 下載直播時的影片檔（須有勾 `record`） |

---

## 故障排除

| 症狀 | 原因 / 解法 |
|------|------|
| `Couldn't open 'http://127.0.0.1:9999', Connection refused` | OBS URL 開頭錯了，要 `tcp://` 不是 `http://` |
| `Couldn't open 'tcp://127.0.0.1:9999', Connection refused` | meet 還沒按「開始監聽」，listener 不在；先建任務再開 OBS |
| meet 任務直接 `error: ffmpeg exited rc=195` | meet 的監聽 URL 少了 `?listen=1`（後端已自動補；若還出現代表 URL 用了不能 listen 的協定，例如 SRT 沒 libsrt） |
| 直播段落都是空的或亂碼 | 麥克風沒進 OBS／視訊軌道沒勾／音訊位元率太低；用 OBS 內建「監聽」確認來源有聲音 |
| 段落邊界切到字 | `chunk_seconds` 過小（建議 5–10）；太短反而碎 |
| `outputs/` 沒看到檔案 | CLI 沒帶 `--outputs-dir` 或後端是別人起的；`/api/health` 看 `outputs_dir` 真實位置 |
| 想知道 OBS 有沒有「同時錄到本地」 | `pgrep -lf obs-ffmpeg-mux`；自訂 FFmpeg 「輸出到 URL」模式下不會跑 mux 程序、不會有本地檔 |
| Whisper 模型下載慢／斷 | 改小模型試（`WHISPER_MODEL=small`），或先手動 `huggingface-cli` 下載 |
| 前端打開 `localhost:7002` 沒回應 | vite 預設 bind `localhost`（IPv6）；CLI 已會 fallback `localhost`，但若用 `127.0.0.1` 連可能不通，改用 `localhost` |

---

## 專案結構

```
meet/
├── meet-cli              symlink → backend/meet-cli（從 repo 根直接跑用）
├── backend/
│   ├── main.py           FastAPI app（/api/health、/api/jobs、/api/live、SSE）
│   ├── worker.py         檔案轉錄子程序（NDJSON on stdout）
│   ├── live_worker.py    直播子程序：spawn ffmpeg listener、滾動 chunk → whisper、可同步寫影片檔
│   ├── cli.py            CLI 進入點（rich TUI、JSON、--serve、--live、--open）
│   ├── meet-cli          bash wrapper，自動找 .venv 與 cli.py
│   ├── requirements.txt
│   └── run.sh            uvicorn reload 模式啟動，預設 PORT=7001
├── frontend/
│   ├── src/
│   │   ├── App.tsx       側欄、檔案上傳、OBS 直播、SSE 解析、控制按鈕
│   │   ├── App.css
│   │   └── main.tsx
│   ├── vite.config.ts    /api proxy 至 :7001
│   └── package.json
├── inputs/               （建議放要轉的檔；內容 .gitignore 不會 commit）
├── outputs/              逐字稿 .txt + 直播影片檔 .mkv/.mp4 …（同上）
├── README.md             ← 你正在看
└── CLI.md                CLI 完整參考（給 AI agent 讀，en-US）
```

---

## 備註

- 模型在第一次呼叫轉錄時才會載入並常駐；首次請求較慢屬正常。第二次起就快。
- 後端 `CORSMiddleware` 預設 `*`，部署到公開環境請收斂來源。
- 上傳檔暫存在系統 `tempfile`，請求結束自動刪。直播任務不產生上傳暫存。
- 暫停／取消用 process group signals（killpg），所以連 ffmpeg 子程序也會跟著被收。
