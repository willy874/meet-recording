---
name: skymove-mom
description: Generate polished, brand-consistent Meeting Minutes (MoM) for Skymove (車聚科技) in Traditional Chinese. Use this skill whenever the user wants to create meeting notes, meeting minutes, a MoM, 會議紀錄, 會議記錄, a meeting summary, write up what we discussed, or turn a transcript/notes into minutes. Also triggers for any Skymove meeting — vendor meetings (華南銀行、Agent 等), internal product meetings, design handoffs, business strategy (定錨會議), or weekly syncs. Always use this skill for Skymove meetings even if the user doesn't say the word "MoM" explicitly.
---

# Skymove Meeting Minutes (MoM)

Generate Skymove-branded Meeting Minutes as `.docx` from transcripts, notes, or verbal recaps.

## Core principles

Before generating, internalize these three layers:

1. **The record** — the document itself. Immutable, dated, searchable.
2. **The actions** — extracted into ClickUp / GitHub within 24 hours. Each action has an owner.
3. **The decisions** — separated from general discussion. Future-you searches for "why we chose X", not "who said what". Write decisions as **"We decided X because Y"**.

## Workflow

### Step 1 — Parse the source

Read all provided material. Identify:
- Participants (match to known team — see `references/team.md`)
- Meeting type (see `references/meeting-types.md`)
- Explicit decisions made
- Action items with owners
- Open questions / deferred items
- Jargon needing a glossary entry

**Auto-correct known transcription errors.** Voice-to-text tools mangle Skymove-specific terms; see `references/glossary.md` for the full correction list.

### Step 2 — Choose output format

Default: **`.docx`** (user can drop into Google Drive → auto-converts to Google Doc).

Other formats only when user specifies: `.md` for quick internal notes, `.html` for web share, `.pdf` for archival.

### Step 3 — Follow the 8–9 section structure

See `references/structure.md` for details. Every MoM has:

1. Cover (title, date, participants, owner, status)
2. 會議目標
3. 現況 / 背景
4. [Main topic content]
5. 決議事項
6. 待辦清單(owner + due date)
7. 下次會議
8. 名詞對照表

For business-strategy meetings add a "三大主軸" or "三階段路線" section between 4 and 5.

### Step 4 — Apply the Skymove brand theme

Colors & typography in `references/brand.md`. Key points:
- Orange `#F37021` for emphasis; Navy `#14365C` for structure
- Font: `Microsoft JhengHei` (set on every TextRun — otherwise Word falls back inconsistently)
- Warm off-white background `#FAFAF7`

### Step 5 — Generate the docx

Use `scripts/build-docx.js` as a starting template. It contains every helper (callout, dataTable, statsRow, ownerBox, etc.) with correct DXA widths and `ShadingType.CLEAR`.

**Critical docx rules** (don't violate or Word will misrender):
- Page size: US Letter (12240 × 15840 DXA)
- Use `WidthType.DXA` for all tables — NEVER `PERCENTAGE` (breaks in Google Docs)
- Tables need BOTH `columnWidths` on the table AND `width` on each cell
- Use `ShadingType.CLEAR` — NEVER `SOLID`
- No unicode bullets; use `LevelFormat.BULLET` with numbering config
- Set `font: "Microsoft JhengHei"` on every TextRun

### Step 6 — Filename

Pattern: `YYYY-MM-DD_項目_對象_vN.docx`

Examples:
- `2026-04-16_金流整合_華南銀行_v1.docx`
- `2026-04-21_產品會議_iFrame推版前對齊_v1.docx`
- `2026-04-21_定錨會議_跨境交通平台_v1.docx`

**Output location**:

- If the caller (e.g. another skill or the user) provided an explicit
  `output_dir` / `outputDir` argument, save the `.docx` there and **skip**
  `present_files`. After writing, run `ls -la "$output_dir"` (Bash) so the
  caller can verify the artifact landed. Do NOT also drop a copy in
  `/mnt/user-data/outputs/`.
- If no explicit directory is given and `/mnt/user-data/outputs/` exists
  and is writable, save there and present via `present_files` (the
  Claude.ai sandbox default).
- Otherwise (e.g. running on a local CLI without that sandbox path), save
  to the current working directory and tell the user the absolute path —
  do not silently fail.

When the caller-provided directory already contains a file with the same
filename, bump `vN` (`_v1` → `_v2`, etc.) instead of overwriting.

### Step 7 — Meeting ID

Assign a Meeting ID matching the meeting type for traceability:
- `SKY-FIN-NNN` — Financial / banking meetings
- `SKY-PROD-NNN` — Product development meetings
- `SKY-BP-NNN` — Business Plan / strategy (定錨)
- `SKY-DESIGN-NNN` — Design handoffs
- `SKY-WEEKLY-NNN` — Weekly syncs

Number sequentially within each type.

## Content style rules

- **Language**: Traditional Chinese (繁體) by default. Switch only on explicit request.
- **Decisions vs discussion**: separate sections. Discussion can be summarized; decisions are precise and actionable.
- **Owner clarity**: every action has a named owner (never "the team will…").
- **Full-width punctuation** for Chinese prose `(),、。「」`; half-width for code/IDs.
- **Numbers**: keep formatting as spoken (e.g. "NT$ 2M / 月", "7 件", "150–200 萬")
- **Glossary**: any term appearing 2+ times that isn't everyday 繁中 goes in 名詞對照表

## What NOT to do

- **Don't transcribe verbatim.** MoM is synthesis, not transcript.
- **Don't invent decisions.** If no decision was reached, put under 待確認事項.
- **Don't assign implementation tasks to 張宸** (他是顧問,不實作 — see `references/team.md`).
- **Don't over-format internal syncs.** For a 10-minute weekly, a short `.md` is fine — ask if unclear.
- **Don't skip the cover page.** Even short MoMs need date + participants + status.
- **Don't mix languages in section titles.** Pick one per section.

## Reference files

Read these when working on a MoM:

- `references/team.md` — who's who, roles, transcription error corrections (critical — read first)
- `references/glossary.md` — Skymove terminology, Agent names, common voice-to-text errors
- `references/brand.md` — exact colors, fonts, callout color mapping
- `references/structure.md` — 8-section template with heading styles
- `references/meeting-types.md` — patterns for vendor / product / strategy / design / weekly meetings
- `scripts/build-docx.js` — docx-js recipe with all helpers. Copy and fill in sections.

## Quick reference card

```
Filename:    YYYY-MM-DD_項目_對象_vN.docx
Colors:      #F37021 (orange) · #14365C (navy)
Font:        Microsoft JhengHei
Structure:   封面 → 目標 → 現況 → 討論 → 決議 → 待辦 → 下次會議 → 名詞
Output:      caller-provided output_dir → else /mnt/user-data/outputs/ → else cwd
Format:      .docx (default)
```
