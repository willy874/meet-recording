---
name: to-google-doc
description: 將 Meet 專案的某筆轉錄結果整理成 Markdown 摘要與 Skymove 品牌的 .docx 會議紀錄,並提供後續分享動作(打開資料夾 / 上傳 Google Drive / 發送 Slack)。觸發情境:使用者說「把這份轉錄整理成 google doc」「轉成會議紀錄」「summary + docx」「to google doc」「把 outputs 裡那場會議整理一下」等。
---

# to-google-doc

把 `outputs/{YYYYMMDDHHmmss}-{idx}/` 底下的轉錄結果一條龍處理為:
1. `summary.md` — 條列式摘要
2. `{summary}.docx` — 套用 `skymove-mom` skill 的 Skymove 品牌會議紀錄

完成後通知使用者並提供後續動作。

---

## Step 1 — 選擇要處理的轉錄資料夾

掃描 `/Users/willybamboo/code/meet/outputs/` 底下符合 `{YYYYMMDDHHmmss}-{idx}/` 命名的子資料夾,**依時間倒序**(最新在最上面)。每個資料夾內應該存在 `transcript.md`(舊版可能為 `transcript.txt`)。

用 `AskUserQuestion` 詢問使用者要處理哪一個:

- `question`: 「要把哪一個轉錄整理成 summary + docx?」
- `header`: 「Transcript」
- `options`: 最多列 4 個最新的資料夾(label = 資料夾名稱,description = 該資料夾內的轉錄檔大小 / 修改時間 / 前幾行預覽片段)
- `multiSelect`: false

若資料夾數量為 0,直接回報「outputs/ 底下沒有可用的轉錄資料夾」並停止。

把使用者選擇的資料夾路徑記為 `{OUTPUT_DIR}`,後續所有產物都寫入此資料夾。

---

## Step 2 — 產出 `summary.md`

1. `Read` `{OUTPUT_DIR}/transcript.md`(若不存在則 fallback `transcript.txt`)。
2. **自行**(不調用 skymove-mom)在當前對話中產生繁體中文條列式摘要,內容必須涵蓋:
   - 會議主題 / 時間 / 參與者(若可從內文推斷)
   - 主要討論議題(分項)
   - 決議事項
   - 待辦清單(含 owner,若有)
   - 待確認 / 開放問題
3. `Write` 到 `{OUTPUT_DIR}/summary.md`。

格式參考:

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

## Step 3 — 產出 `{summary}.docx`

呼叫 `skymove-mom` skill,把 **`{OUTPUT_DIR}/transcript.md` 的完整內容**作為輸入交給它生成 `.docx`。

- 產出檔名遵循 `skymove-mom` 的命名規則(`YYYY-MM-DD_項目_對象_vN.{ext}`),但**最終必須移動 / 落地**到 `{OUTPUT_DIR}/` 之下(覆蓋 skymove-mom 預設的 `/mnt/user-data/outputs/`)。
- 若 `skymove-mom` 把檔案寫到別處,完成後用 `Bash` `mv` 到 `{OUTPUT_DIR}/`。

---

## Step 4 — 通知與後續動作

### 4a. macOS 通知

用 `Bash` 觸發系統通知:

```bash
osascript -e 'display notification "summary.md 與 .docx 已產出" with title "to-google-doc 完成" sound name "Glass"'
```

### 4b. 詢問下一步

用 `AskUserQuestion`:

- `question`: 「產出完成,接下來要做什麼?」
- `header`: 「Next」
- `multiSelect`: false
- `options`:
  1. label = 「打開資料夾」,description = 「在 Finder 開啟 {OUTPUT_DIR}」
  2. label = 「上傳 Google Drive(尚未串接)」,description = 「目前未串接 Google Drive,無法使用」
  3. label = 「發送到 Slack(尚未串接)」,description = 「目前未串接 Slack,無法使用」

### 4c. 依選擇執行

- **打開資料夾**:`Bash` 執行 `open "{OUTPUT_DIR}"`。
- **Google Drive / Slack**:回覆使用者「此通道尚未串接,請先設定後再使用」,**不要**嘗試實際呼叫 MCP(即使環境中可能存在 google_drive / slack 工具,以使用者明確要求為準:本 skill 視為未串接)。

---

## 邊界與規則

- 所有檔案產物統一落在 `{OUTPUT_DIR}/`,不要散落到 repo 其他位置。
- `summary.md` 為**綜整**,不是逐字稿,保留決策與行動點為主。
- 預設語言:繁體中文。檔案內標題與條列皆使用繁中。
- 若 `transcript.{ext}` 過長,讀取時可用 `Read` 的 `offset` / `limit` 分段,但摘要必須涵蓋整份內容。
- 若使用者在 Step 1 之前已經明確指定資料夾路徑,可跳過 Step 1 的 AskUserQuestion,直接使用該路徑。
