# Meeting Type Patterns

Five common Skymove meeting patterns. Use the closest match and adapt.

## Type 1 — Vendor / Bank Integration

**Example**: 華南銀行金流整合 (SKY-FIN-001)

**Meeting ID prefix**: `SKY-FIN-NNN`

### Sections
1. Cover
2. 會議目標
3. 現況與背景(痛點 stats row)
4. **[Vendor] 提供方案**(sub-topics)
5. **Skymove 端需求釐清**
6. 決議事項
7. 待辦清單(2-col: Skymove ↔ Vendor)
8. 下次會議
9. 名詞對照表

### Tone
Professional, technical. Heavy use of data tables (pricing, specs, comparison).

---

## Type 2 — Product Development

**Example**: iFrame 推版前對齊 (SKY-PROD-003)

**Meeting ID prefix**: `SKY-PROD-NNN`

### Sections
1. Cover
2. 會議目標
3. 現況 / 流程共識(red callout if there was an incident)
4. **UI 待修正項目** / **技術方案**
5. **B2B vs B2B2C 差異** or topic-specific sub-sections
6. 決議事項(including out-of-scope items)
7. 待辦清單(2-3 col depending on participants)
8. 下次會議
9. 名詞對照表

### Tone
Engineering-specific. Use code-formatted identifiers (e.g. `95936`, `orderSource`). Include flow diagrams using arrow syntax.

---

## Type 3 — Business Plan / 定錨

**Example**: 定錨會議 — 從機場接送走向跨境交通平台 (SKY-BP-001)

**Meeting ID prefix**: `SKY-BP-NNN`

### Sections
1. Cover (clearly mark Status as "定錨完成 · 待分工落實")
2. 會議目標(note: "非產品會議")
3. 現況定位
4. 核心轉型(with orange callout highlighting paradigm shift)
5. **三階段路線圖**(Phase A/B/C table)
6. 商業模式 · B2B / B2B2C 定位
7. **三大主軸**(product / supply chain / enterprise)
8. 決議事項
9. 待辦清單(3-col: Lewis / 貓 / Paul)
10. 下次會議
11. 名詞對照表

### Tone
Strategic. Less technical detail, more directional. Decisions are "why" statements rather than "what" tasks. OK to include long-term goals (e.g. acquisition target, valuation).

### Special notes
- Mark Judy in participants even if non-speaking (she's in the room)
- Explicitly list "不做的範圍" (what's OUT of scope) — critical for strategy docs
- Include market landscape if discussed (OTA landscape, competitor positioning)

---

## Type 4 — Design Handoff

**Example**: 駕駛艙新功能規格對齊

**Meeting ID prefix**: `SKY-DESIGN-NNN`

### Sections
1. Cover
2. 會議目標
3. 設計決策說明(with Figma 連結)
4. 技術可行性討論
5. 決議事項(UI/UX + technical)
6. 待辦清單(Paul / Judy)
7. 名詞對照表(heavy on component naming, state naming)

### Tone
Detailed on UI. Include color references using Skymove palette.

---

## Type 5 — Weekly Sync

**Example**: 週會

**Meeting ID prefix**: `SKY-WEEKLY-NNN`

### Lighter format
- Skip elaborate cover (1-line header is fine)
- Sections: 本週完成 · 下週規劃 · 阻塞/風險 · 決議 · 待辦
- Skip 名詞對照表 (unless new term introduced)
- Skip 下次會議 (implicit: same time next week)

### Tone
Fast. Bullet-heavy. 1-2 page max.

### Output format
Consider `.md` instead of `.docx` — ask user if unclear.

---

## Common callout patterns

### Pain callout (red)
```
◆ 核心痛點
[Specific numbers if possible]
[Business impact]
```

### Highlight callout (orange)
```
◆ [Topic]
[Context]
待[party]確認:[specific items]
```

### Info callout (navy)
```
◆ 重要限制 / 注意事項
[The constraint]
作業模式:[how it actually works]
```

### Solution callout (green)
```
◆ [Adopted solution name]
[Why it's the chosen approach]
```

---

## Voice & tone rules

Regardless of meeting type:

- **Professional but not stiff**: "我們決定" not "茲決議"
- **Specific over vague**: "刷卡手續費 2.5%" not "刷卡手續費合理"
- **Active voice**: "Paul 確認 X" not "X 將被 Paul 確認"
- **Numbered decisions**: Always numbered (so you can refer to "決議 #2")
- **Preserve direct quotes carefully**: If the CEO said "有錢不賺王八蛋", it's fine to include verbatim in a callout — it captures intent. But in formal sections, paraphrase.
