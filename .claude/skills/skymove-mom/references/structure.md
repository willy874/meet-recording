# MoM Structure Template

Every Skymove MoM has this structure. Sections 3–5 adapt to meeting type, but never skip Cover / 決議 / 待辦 / 下次會議.

## Cover page

Elements (all required):
- Brand row: `■ SKYMOVE  │  [meeting-type] · 把移動,變簡單`
- Tag: `● MEETING MINUTES · [ID]` (e.g. `SKY-PROD-003`)
- Title (2 lines): main subject + specific focus, orange underline on 1-2 key words
- Subtitle: 1-2 sentences describing the purpose
- 4-column meta: DATE · PARTICIPANTS · OWNER · STATUS
- Page break after cover

Participant order on cover: Lewis → 貓 → Paul → Judy → others (role suffix in parens).

## Section 1 — 會議目標

3-5 bullet points. Example:

> 對齊公司中長期方向:
> • 明確現況定位
> • 定義核心策略
> • 釐清三大主軸

## Section 2 — 現況與背景

Context. For data-rich meetings, start with a stats row (3 key numbers) then:
- Current state
- Customer segments / user types
- Core pain point (as a red callout)

## Section 3 — [Main topic content]

Adaptive section. For:
- **Vendor meetings**: "[Counterparty] 提供方案" with sub-topics
- **Product meetings**: "[Topic] 方案討論" or "技術方案"
- **Business Plan**: "核心轉型" + "三階段路線圖"
- **Internal**: "討論議題"

Use ▎-prefixed H2 for sub-sections. Include data tables, flow diagrams, callouts.

## Section 4 — Our side (when applicable)

For vendor meetings: "Skymove 端需求釐清".
For internal meetings: "開放議題 / Open Questions".
For strategy meetings: "三大主軸" or "商業模式".

Can be combined with Section 3 for simple meetings.

## Section 5 — 決議事項 (critical)

Numbered list. Each item:
- Bold topic (navy) at start
- Followed by the decision in plain text
- Answers "what AND why"

Example:
> 1. **虛擬帳號**:確定採用,全面導入
> 2. **信用卡收單**:採用**預授權模式**,降低履保壓力

## Section 6 — 待辦清單

Owner-box layout. Most common patterns:

- **2-column**: primary owner + collaborators (e.g. Paul / Lewis+Judy)
- **3-column**: when 3 distinct ownership groups (e.g. Paul / 貓 / Lewis)

Orange top-border for the primary owner; Navy for counterparty; Purple for Judy (design).

Items use `☐` checkbox prefix (orange).

## Section 7 — 下次會議

Single orange highlight callout. Fields:
- 時程 (timing)
- 焦點 (topics)
- 性質 (if strategy, e.g. "Business Plan 定錨,非產品會議")

Skip if no follow-up.

## Section 8 — 名詞對照表

Dark navy box with white table. 2 columns: 術語 | 說明.

Include any term that:
- Appeared 2+ times in discussion
- Is jargon (internal, banking, industry)
- Would be unfamiliar to Judy or a new team member

## Heading styles

| Level | Size | Font | Color | Decoration |
|-------|------|------|-------|------------|
| H1 (section) | 36 DXA | JhengHei Bold | Navy | Orange underline |
| H2 (subsection) | 28 DXA | JhengHei Bold | Navy | Orange `▎` prefix |
| H3 (minor) | 24 DXA | JhengHei Bold | Navy | — |
| Body | 22 DXA | JhengHei | Body `#3D4556` | Line 360 |

Section number appears ABOVE H1 in orange mono font: `03 / 08` (or `03 / 09` if you have 9 sections).

## Length guidelines

| Meeting type | Typical pages |
|--------------|---------------|
| Weekly sync | 1-2 |
| Design handoff | 2-3 |
| Vendor integration | 5-10 |
| Business Plan / 定錨 | 7-10 |

Over 10 pages → consider splitting into topic-specific MoMs.
