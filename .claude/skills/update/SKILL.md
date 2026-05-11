---
name: update
description: 把本機已建置好的 Meet 專案更新到最新版本。行為上等於「`git pull` 之後跑 `init`」——拉取 origin 最新 commit，再委派 `init` skill 把 backend / frontend 環境補齊到該版本。觸發情境：使用者說「更新專案」「拉一下最新的」「sync 一下環境」「update meet」「pull 然後重裝」等。
---

# update — Meet 專案版本/依賴更新

行為非常簡單：**`git pull` 之後跑 `init`**。本 skill 只負責 git 部分的安全檢查與拉取，依賴安裝完全委派給 `init`（它本來就是冪等的）。

## 適用情境

- 想把本地分支同步到 upstream，並順便對齊依賴。
- 拉了同事的 commit 後 `requirements.txt` 或 `package.json` 有變，要重裝。

## 不適用

- 第一次 clone：直接用 `init`，不需要 `update`。
- 想升級依賴版本本身（編輯 lock）：不在本 skill 範圍。

## 流程

### 1. git 安全檢查

用單一 Bash call 平行收集：

```bash
git status --porcelain=v1 --branch
git fetch --quiet origin && git log --oneline HEAD..@{u} 2>/dev/null | head -20
```

把目前分支、是否乾淨、落後 / 領先 upstream 幾個 commit、即將拉進來的 commit 摘要一次列給使用者。

**遇到以下狀況停下來問使用者**，不要擅自處理：
- 工作區有未提交變更。
- 本地有領先 upstream 的 commit（需要 rebase / merge）。
- 不在預期分支（例如 detached HEAD）。

### 2. 拉取最新 commit

```bash
git pull --ff-only
```

只允許 fast-forward。失敗就回報原因停下來，**不要**改用 merge 或 rebase。

### 3. 委派 init

git pull 成功後，呼叫 `init` skill 完成環境補齊。`init` 是冪等的：已存在的 `.venv` / `node_modules` 不會被重建，只會把缺的依賴補上。

## 完成後要回報的內容

- 從哪個 commit 更新到哪個 commit（`OLD..NEW`，附短 hash）。
- init 跑完的結果（backend / frontend 是否有新裝套件）。
- 若 backend 在跑，提醒**重啟**才會載入新版程式碼（不要主動 kill 使用者的 process）。

## 不要做的事

- **不要** `git stash` / `git reset --hard` / `git checkout .` 來「先弄乾淨」——會吃掉使用者的在製品。髒工作區就停下來問。
- **不要**自動切分支；使用者在哪個分支就在哪個分支更新。
- **不要** `git push`；更新是拉、不是推。
- **不要**重複實作 `init` 的依賴安裝邏輯——一律委派給 `init` skill。
- **不要**主動重啟使用者的長駐 process（backend / dev server / OBS 接收）；只提醒。
