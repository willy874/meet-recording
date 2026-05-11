# Skymove Glossary

## Core product terms

| Term | Definition |
|------|------------|
| **Skymove / 車聚科技** | Taiwan-based airport transfer & cross-border transport platform |
| **B2B** | Direct enterprise customers (primary long-term focus) |
| **B2B2C** | Via OTA / channel partners (stage-gate growth channel, not end goal) |
| **航班編號為核心** | "Flight-number as core" — the new product paradigm linking full journey (airport transfer + local chauffeur + rental) |
| **跨境交通** | Cross-border transportation (Skymove's core business) |
| **程式交通** | Local urban transit (metro, bus, taxi) — explicitly NOT Skymove's scope |
| **機場接送** | Airport transfer (current primary service) |
| **包車服務** | Chauffeur service (expansion) |
| **四大機場** | Taiwan's four airports (Taoyuan, Songshan, Kaohsiung, Taichung) |

## Agent (通路 / 品牌合作方)

**Always use "Agent" — never "A卷" or "A 卷"** (voice-to-text errors).

Known Agents:
- **飛狗** (Feigou) — Long-established Agent; Lewis's predecessor company
- **阿黃** (Ahuang)
- **阿丁** (Ading) — Joining Skymove internally as marketing role
- **叉叉弓** (Cha-Cha-Gong) — B2B enterprise direct-connect (uses iFrame URL directly, not embedded)

Verify Agent names when the transcript is unclear — they're internal brand names that may not match standard romanization.

## Cross-border partners

| Partner | Country | Relationship | Notes |
|---------|---------|--------------|-------|
| **GoMyHire** | Malaysia + 6-7 countries | Ride platform partner | 2000 drivers in Malaysia, NDA signed. NEVER spell as "GoByHi" |
| **GoGoOut** | Taiwan | Car rental partner | Covers Japan/Korea/US/Thailand/Malaysia |
| **Japan local fleets** | 沖繩、大阪、東京、北海道 | Direct integration | In talks: 名古屋、福岡 |

## Enterprise customers

Examples of B2B customers already signed:
- **Panasonic**
- **東京威力** (TEL / Tokyo Electron)

## Business model terms

| Term | Definition |
|------|------------|
| **定錨 / 定錨會議** | Anchor meeting — Business Plan level strategy session (NEVER "定毛") |
| **生存線** | Survival line — baseline revenue to reach breakeven |
| **履約保證 / 履保** | Merchant Reserve for credit-card acquiring |
| **預授權 / 圈存** | Pre-authorization (authorize first, charge later) |
| **回金** | Driver returning collected cash to platform |
| **Phase A / B / C** | Three-stage roadmap: Taiwan deepening → Cross-border extension → Enterprise going-global |

## Banking integration (華南銀行)

| Term | Definition |
|------|------------|
| **虛擬帳號** | Virtual Account — per-order or per-brand payment identifier |
| **公用網** | Multi-company consolidated bank portal view |
| **藍底** | HuaNan supply-chain payment module |
| **放行** | Final approval action on bank portal |
| **一本道** | HuaNan "single-path" transaction execution module |

## Technical / infrastructure

| Term | Definition |
|------|------------|
| **iFrame (預約表單)** | Skymove's embeddable booking widget for Agent sites |
| **耳的命 / 耳的命後台** | Skymove's internal admin console (OP and customer service use this) |
| **OP 人員** | Operations staff (customer service, dispatch) |
| **Cloud Run** | GCP container service, Skymove's backend runtime |
| **MongoDB Atlas** | Managed MongoDB (Skymove's main DB) |
| **postMessage** | Web API for cross-origin iFrame ↔ parent page communication |

## Platform tooling

| Term | Definition |
|------|------------|
| **羅賓士科技** | Taiwan insurance-tech partner (travel insurance, driver insurance) |
| **55688** | 台灣大車隊 — Taiwan's largest taxi dispatch; main competitor for enterprise signed accounts |
| **Booking.com / Agoda / KKday / Klook** | OTA platforms (potential B2B2C channels) |
| **Amadeus** | Flight ticket distribution platform (PDS — mentioned in market landscape) |
