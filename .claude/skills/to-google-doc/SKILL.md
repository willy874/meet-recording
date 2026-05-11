---
name: to-google-doc
description: 將 Meet 專案的某筆轉錄結果整理成 Markdown 摘要與 Skymove 品牌的 .docx 會議紀錄,並提供後續分享動作(打開資料夾 / 上傳 Google Drive / 發送 Slack)。觸發情境:使用者說「把這份轉錄整理成 google doc」「轉成會議紀錄」「summary + docx」「to google doc」「把 outputs 裡那場會議整理一下」等。
---

# to-google-doc

把 `outputs/{YYYYMMDDHHmmss}-{idx}/` 底下的轉錄結果一條龍處理為:
1. `summary.md` — 條列式輕量摘要(本 skill 自己產)
2. `{YYYY-MM-DD_項目_對象_vN}.docx` — 委派 `skymove-mom` 產出的 Skymove 品牌正式 MoM

兩份內容不必一致:`summary.md` 是快速大綱,`.docx` 是正式紀錄,**分歧時以 `.docx` 為準**。

> 平台:本 skill 假設 macOS(使用 `osascript` / `open`)。

---

## Step 0 — 解析 outputs 目錄

按下列順序決定 `{OUTPUTS_ROOT}`,第一個有效者勝出:

1. 環境變數 `$MEET_OUTPUTS_DIR`(`Bash` 讀:`echo "${MEET_OUTPUTS_DIR}"`)
2. 後端 API:`curl -s http://127.0.0.1:8000/api/config | jq -r .default_outputs_dir`(後端有跑時)
3. Git repo root 下的 `outputs/`:`git rev-parse --show-toplevel` 後 append `/outputs`

三者皆無或目錄不存在 → 回報「找不到 outputs 目錄」並停止。

---

## Step 1 — 選擇要處理的轉錄資料夾

掃描 `{OUTPUTS_ROOT}` 底下符合 `{YYYYMMDDHHmmss}-{idx}/` 命名的子資料夾,**依時間倒序**(最新在最上面)。每個資料夾內應該存在 `transcript.md`(舊版可能為 `transcript.txt`)。

- 資料夾數量 = 0 → 回報並停止。
- 資料夾數量 = 1 → 直接採用,**不**呼叫 `AskUserQuestion`(`AskUserQuestion` 至少要 2 個 options)。
- 資料夾數量 ≥ 2 → 用 `AskUserQuestion` 問使用者:
  - `question`: 「要把哪一個轉錄整理成 summary + docx?」
  - `header`: 「Transcript」
  - `options`: 最多 4 個最新的資料夾(label = 資料夾名稱,description = 轉錄檔大小 / 修改時間 / 前幾行預覽)
  - `multiSelect`: false
- 若使用者已在對話中明確指定資料夾路徑(絕對路徑或相對 `{OUTPUTS_ROOT}` 的名稱),跳過提問直接採用。

選定的資料夾記為 `{OUTPUT_DIR}`,後續所有產物都寫入此資料夾。

---

## Step 2 — 產出 `summary.md`

1. `Read` `{OUTPUT_DIR}/transcript.md`(若不存在則 fallback `transcript.txt`);長檔可用 `offset` / `limit` 分段,**摘要必須涵蓋整份**。
2. 由本 skill **直接**(不調用 `skymove-mom`)在當前對話中產生繁體中文條列式摘要,涵蓋:
   - 會議主題 / 日期 / 參與者(可從內文推斷)
   - 主要討論議題(分項)
   - 決議事項
   - 待辦清單(含 owner,若有)
   - 待確認 / 開放問題
3. `Write` 到 `{OUTPUT_DIR}/summary.md`。

格式範例:

```markdown
# 會議摘要 — {推斷主題}

- 日期:…
- 參與者:…

## 討論議題
- …

## 決議事項
- …

## 待辦事項
- [ ] (owner) …

## 待確認
- …
```

---

## Step 3 — 產出 Skymove .docx

呼叫 `skymove-mom` skill,**並明確傳入 `output_dir={OUTPUT_DIR}`**,把 `{OUTPUT_DIR}/transcript.md` 的完整內容作為輸入。

- skymove-mom 已支援 caller 指定 `output_dir`(會跳過 `/mnt/user-data/outputs/` 與 `present_files`)。
- 命名仍遵循 `YYYY-MM-DD_項目_對象_vN.docx`;若 `{OUTPUT_DIR}` 已存在同名檔,**自動 bump `vN`**,不覆蓋。
- 若實際產物不在 `{OUTPUT_DIR}`(例如 skymove-mom 退回沙盒路徑),用 `Bash mv` 搬過來。

---

## Step 4 — 驗證並通知

### 4a. 驗證

`Bash` 執行 `ls -la "{OUTPUT_DIR}"`,確認以下檔案都存在:

- `transcript.md`(輸入)
- `summary.md`(Step 2 產物)
- `*.docx`(Step 3 產物)

任一缺失 → 回報具體缺哪個並停止,**不要**進入 Step 4b。

### 4b. macOS 通知

```bash
osascript -e 'display notification "summary.md 與 .docx 已產出" with title "to-google-doc 完成" sound name "Glass"'
```

### 4c. 詢問下一步

用 `AskUserQuestion`:

- `question`: 「產出完成,接下來要做什麼?」
- `header`: 「Next」
- `multiSelect`: false
- `options`:
  1. label = 「打開資料夾」,description = 「在 Finder 開啟 {OUTPUT_DIR}」
  2. label = 「完成,不需要進一步動作」,description = 「結束本次流程」

> Google Drive 上傳與 Slack 發送目前**不在本 skill 範圍內**,即使環境中有 `mcp__claude_ai_Google_Drive__*` / `mcp__plugin_slack_slack__*` 工具,也不要主動呼叫。使用者若想要,讓他明確指示再用對應 skill 處理。

### 4d. 依選擇執行

- **打開資料夾**:`Bash` 執行 `open "{OUTPUT_DIR}"`。
- **完成**:回覆一句確認即可。

---

## 邊界與規則

- 所有檔案產物統一落在 `{OUTPUT_DIR}/`,不要散落到 repo 其他位置。
- `summary.md` 為**綜整大綱**,不是逐字稿,保留決策與行動點為主。
- 預設語言:繁體中文。檔案內標題與條列皆使用繁中。
- 若使用者明確跳過 Step 2 / Step 3 其中一項,記得 Step 4a 的驗證清單也要相應放寬。
- 平台限定 macOS(`osascript` / `open`);其他平台請改用對應指令或省略通知。
