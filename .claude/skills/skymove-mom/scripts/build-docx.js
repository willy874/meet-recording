/**
 * Skymove MoM — docx template recipe
 * ===================================
 *
 * Template for Skymove Meeting Minutes. All brand colors, layout helpers,
 * and section patterns are defined here. Customize the CONTENT (sections 1-9)
 * — keep styles, colors, tables, and callout helpers intact.
 *
 * Setup:
 *   1. Ensure Node.js + docx installed: `npm install -g docx`
 *   2. Copy this file to your workspace
 *   3. Edit the section content (search for "Section 1", "Section 2", ...)
 *   4. Run: `NODE_PATH=$(npm root -g) node build-docx.js`
 *   5. Output: `/home/claude/<meeting>-mom.docx`
 *   6. Rename to `YYYY-MM-DD_項目_對象_vN.docx` and move to output dir
 *
 * Available helpers:
 *   body(text, opts)              — standard body paragraph
 *   rich([segments], paraOpts)    — multi-style paragraph
 *   h1(text)                      — section heading (orange underline)
 *   h2(text)                      — sub-heading (orange ▎ prefix)
 *   h3(text)                      — minor heading
 *   bullet(text)                  — bullet (orange marker)
 *   bulletRich([segments])        — rich bullet
 *   numbered(text)                — numbered item
 *   callout({label, color, bgColor, lines})  — colored callout box
 *   dataTable(headers, rows, colWidths)      — styled data table
 *   ownerBox(title, color, items)            — checklist column (for 待辦)
 *   spacer()                      — vertical spacing
 *
 * Brand colors (already set as constants):
 *   ORANGE, ORANGE_DEEP, NAVY, NAVY_DEEP, INK, BODY, MUTED, LINE
 *   WARM (orange tint), MIST (navy tint), ALERT (red), SIGNAL (green)
 *
 * Critical docx rules (don't violate):
 *   - Use WidthType.DXA for all tables (never PERCENTAGE)
 *   - Tables need BOTH columnWidths AND per-cell width
 *   - Use ShadingType.CLEAR (never SOLID)
 *   - Set font on every TextRun: `font: "Microsoft JhengHei"`
 *   - Page size: US Letter (12240 × 15840 DXA)
 *
 * See references/brand.md for color codes, references/structure.md for
 * section structure, references/meeting-types.md for 5 meeting patterns.
 */

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
  TabStopType, TabStopPosition
} = require('docx');
const fs = require('fs');

const ORANGE = "F37021", ORANGE_DEEP = "D85A12", NAVY = "14365C", NAVY_DEEP = "0B2340";
const INK = "1A1F2E", BODY = "3D4556", MUTED = "7A8499", LINE = "E4E7EE";
const WARM = "FFF4E8", MIST = "F4F6FB", ALERT = "DC2626", SIGNAL = "16A34A";

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 360 },
    children: [new TextRun({ text, font: "Microsoft JhengHei", size: 22, color: BODY, ...opts })]
  });
}
function rich(segments, paraOpts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 360 },
    ...paraOpts,
    children: segments.map(s => new TextRun({ font: "Microsoft JhengHei", size: 22, color: s.color || BODY, ...s }))
  });
}
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 480, after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: ORANGE, space: 4 } },
    children: [new TextRun({ text, font: "Microsoft JhengHei", size: 36, bold: true, color: NAVY })]
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 160 },
    children: [
      new TextRun({ text: "▎ ", font: "Microsoft JhengHei", size: 28, bold: true, color: ORANGE }),
      new TextRun({ text, font: "Microsoft JhengHei", size: 28, bold: true, color: NAVY })
    ]
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 220, after: 120 },
    children: [new TextRun({ text, font: "Microsoft JhengHei", size: 24, bold: true, color: NAVY })]
  });
}
function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { after: 80, line: 340 },
    children: [new TextRun({ text, font: "Microsoft JhengHei", size: 22, color: BODY })]
  });
}
function bulletRich(segments, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { after: 80, line: 340 },
    children: segments.map(s => new TextRun({ font: "Microsoft JhengHei", size: 22, color: s.color || BODY, ...s }))
  });
}
function numbered(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "numbers", level },
    spacing: { after: 80, line: 340 },
    children: [new TextRun({ text, font: "Microsoft JhengHei", size: 22, color: BODY })]
  });
}
function callout({ label, color, bgColor, lines }) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  const leftBorder = { style: BorderStyle.SINGLE, size: 24, color };
  const paragraphs = [
    new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: label, font: "Microsoft JhengHei", size: 18, bold: true, color })]
    }),
    ...lines.map(line => {
      if (typeof line === 'string') {
        return new Paragraph({
          spacing: { after: 60, line: 340 },
          children: [new TextRun({ text: line, font: "Microsoft JhengHei", size: 22, color: INK })]
        });
      } else {
        return new Paragraph({
          spacing: { after: 60, line: 340 },
          children: line.map(s => new TextRun({ font: "Microsoft JhengHei", size: 22, color: s.color || INK, ...s }))
        });
      }
    })
  ];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: 9360, type: WidthType.DXA },
        margins: { top: 160, bottom: 160, left: 240, right: 200 },
        shading: { fill: bgColor, type: ShadingType.CLEAR },
        borders: { top: border, bottom: border, right: border, left: leftBorder },
        children: paragraphs
      })]
    })]
  });
}
const spacer = () => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "" })] });

function dataTable(headers, rows, colWidths) {
  const totalW = 9360;
  const widths = colWidths || headers.map(() => Math.floor(totalW / headers.length));
  const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  const borders = { top: border, bottom: border, left: border, right: border };
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      margins: { top: 120, bottom: 120, left: 160, right: 160 },
      shading: { fill: NAVY, type: ShadingType.CLEAR },
      borders,
      children: [new Paragraph({
        children: [new TextRun({ text: h, font: "Microsoft JhengHei", size: 20, bold: true, color: "FFFFFF" })]
      })]
    }))
  });
  const dataRows = rows.map((row, rowIdx) => new TableRow({
    children: row.map((cell, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      shading: rowIdx % 2 === 1 ? { fill: MIST, type: ShadingType.CLEAR } : undefined,
      borders,
      children: [new Paragraph({
        children: [new TextRun({ text: cell, font: "Microsoft JhengHei", size: 20, color: BODY })]
      })]
    }))
  }));
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: widths,
    rows: [headerRow, ...dataRows]
  });
}

function ownerBox(title, color, items) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  const topA = { style: BorderStyle.SINGLE, size: 18, color };
  const children = [
    new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({ text: title, font: "Microsoft JhengHei", size: 18, bold: true, color })]
    }),
    ...items.map(t => new Paragraph({
      spacing: { after: 80, line: 340 },
      children: [
        new TextRun({ text: "☐  ", font: "Microsoft JhengHei", size: 22, color: ORANGE, bold: true }),
        new TextRun({ text: t, font: "Microsoft JhengHei", size: 22, color: INK })
      ]
    }))
  ];
  return new TableCell({
    width: { size: 4680, type: WidthType.DXA },
    margins: { top: 240, bottom: 240, left: 240, right: 240 },
    borders: { top: topA, bottom: border, left: border, right: border },
    children
  });
}

// ========================================
// Cover
// ========================================
const coverContent = [
  new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ text: "■ ", font: "Microsoft JhengHei", size: 20, color: ORANGE, bold: true }),
      new TextRun({ text: "SKYMOVE ", font: "Microsoft JhengHei", size: 20, bold: true, color: NAVY }),
      new TextRun({ text: "│ Business Plan 定錨會議 · 把移動,變簡單", font: "Microsoft JhengHei", size: 16, color: MUTED })
    ]
  }),
  spacer(), spacer(),
  new Paragraph({
    spacing: { after: 240 },
    children: [new TextRun({
      text: "● MEETING MINUTES · SKY-BP-001",
      font: "Microsoft JhengHei", size: 18, bold: true, color: ORANGE_DEEP
    })]
  }),
  new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text: "定錨會議", font: "Microsoft JhengHei", size: 56, bold: true, color: NAVY })]
  }),
  new Paragraph({
    spacing: { after: 240 },
    children: [
      new TextRun({ text: "從機場接送走向 ", font: "Microsoft JhengHei", size: 56, bold: true, color: NAVY }),
      new TextRun({ text: "跨境交通平台", font: "Microsoft JhengHei", size: 56, bold: true, color: ORANGE, underline: { color: ORANGE } })
    ]
  }),
  new Paragraph({
    spacing: { after: 480, line: 360 },
    children: [new TextRun({
      text: "對齊公司中長期方向:從訂單為核心轉型為「以航班編號為核心」的跨境移動生態,明確三階段路線(台灣深耕 → 跨境延伸 → 企業出海),並釐清產品、供應鏈、企業客戶三大主軸。",
      font: "Microsoft JhengHei", size: 22, color: BODY
    })]
  }),
  (() => {
    const w = 9360 / 4;
    const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
    const topA = { style: BorderStyle.SINGLE, size: 18, color: NAVY };
    return new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [w, w, w, w],
      rows: [new TableRow({
        children: [
          ["DATE", "2026 / 04 / 21"],
          ["PARTICIPANTS", "Lewis (CEO) · 貓 (Co-founder) · Paul · Judy"],
          ["OWNER", "Lewis (CEO)"],
          ["STATUS", "定錨完成 · 待分工落實"]
        ].map(([label, value]) => new TableCell({
          width: { size: w, type: WidthType.DXA },
          margins: { top: 180, bottom: 180, left: 200, right: 200 },
          borders: { top: topA, bottom: border, left: border, right: border },
          children: [
            new Paragraph({
              spacing: { after: 80 },
              children: [new TextRun({ text: label, font: "Microsoft JhengHei", size: 14, bold: true, color: ORANGE })]
            }),
            new Paragraph({
              children: [new TextRun({ text: value, font: "Microsoft JhengHei", size: 20, bold: true, color: NAVY })]
            })
          ]
        }))
      })]
    });
  })(),
  new Paragraph({ children: [new PageBreak()] })
];

// ========================================
// Section 1: 會議目標
// ========================================
const section1 = [
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "01 / 09", font: "Microsoft JhengHei", size: 16, bold: true, color: ORANGE })] }),
  h1("會議目標"),
  body("此次定錨會議為 Business Plan 層級,非產品會議。目的是讓全體成員對公司中長期方向取得共識,而非討論單一產品細節。"),
  bullet("明確現況定位(我們現在在哪裡)"),
  bullet("定義公司中長期核心方向(未來要走到哪裡)"),
  bullet("釐清三大主軸:產品核心、供應鏈、企業客戶"),
  bullet("拉齊成員對「產品重構範圍」的理解"),
  bullet("為後續產品會議鋪路(下次會議拆解為系統實作)")
];

// ========================================
// Section 2: 現況定位
// ========================================
const section2 = [
  new Paragraph({ spacing: { before: 480, after: 60 }, children: [new TextRun({ text: "02 / 09", font: "Microsoft JhengHei", size: 16, bold: true, color: ORANGE })] }),
  h1("現況定位"),

  h2("目前的 Skymove"),
  bulletRich([
    { text: "定位:", bold: true, color: NAVY },
    { text: "台灣機場接送的系統平台(四大機場)" }
  ]),
  bulletRich([
    { text: "核心能力:", bold: true, color: NAVY },
    { text: "報價查表 API、訂單管理派遣、實際營運介面、供應鏈調度" }
  ]),
  bulletRich([
    { text: "客戶類型:", bold: true, color: NAVY },
    { text: "B2B(企業用戶 — Panasonic、東京威力等)、B2B2C(通路 / 旅行社 / OTA 平台)" }
  ]),

  h2("為何要轉型"),

  callout({
    label: "◆ 現行模式的限制",
    color: ALERT,
    bgColor: "FEF5F5",
    lines: [
      [
        { text: "毛利偏低:", bold: true, color: ALERT },
        { text: "機場接送毛利僅 15-20%;扣掉 B2B2C 分潤後剩 10-15%" }
      ],
      [
        { text: "客戶生命週期短:", bold: true, color: ALERT },
        { text: "平均形成前 3-5 天才預約,決策窗口短" }
      ],
      [
        { text: "獲客成本未被放大:", bold: true, color: ALERT },
        { text: "每客 NT$100-180 的廣告成本,只換取一小段的機場接送服務,價值未被完整攫取" }
      ]
    ]
  })
];

// ========================================
// Section 3: 核心轉型 — 以航班編號為核心
// ========================================
const section3 = [
  new Paragraph({ spacing: { before: 480, after: 60 }, children: [new TextRun({ text: "03 / 09", font: "Microsoft JhengHei", size: 16, bold: true, color: ORANGE })] }),
  h1("核心轉型:以航班編號為核心"),

  callout({
    label: "◆ 產品核心邏輯轉換",
    color: ORANGE,
    bgColor: WARM,
    lines: [
      [
        { text: "現行:", bold: true, color: NAVY },
        { text: "以「訂單」為核心 — 每張訂單獨立派遣、調度、對帳" }
      ],
      [
        { text: "新方向:", bold: true, color: NAVY },
        { text: "以「" },
        { text: "航班編號", bold: true, color: ORANGE_DEEP },
        { text: "」為核心 — 串聯跨境全程移動需求" }
      ],
      "一個航班編號即可推知乘客的全程移動需求:出國接送、到站接送、當地包車、租車、租機車 — 我們把家門到國門、國門到當地飯店的完整移動段串起來。"
    ]
  }),
  spacer(),

  h2("不碰的範圍(明確排除)"),
  bullet("當地程式交通(地鐵、巴士、計程車)— 不做"),
  bullet("當地飯店、機票分銷 — 不做(由 Booking.com、Agoda、Skyscanner 負責)"),
  bullet("旅遊體驗、票券 — 不做(由 KKday、Klook 負責)"),

  h2("只做的範圍(核心交通)"),
  bulletRich([
    { text: "機場接送", bold: true, color: NAVY },
    { text: "(現行主力)" }
  ]),
  bulletRich([
    { text: "當地包車", bold: true, color: NAVY },
    { text: "(延伸)" }
  ]),
  bulletRich([
    { text: "租汽車 / 租機車", bold: true, color: NAVY },
    { text: "(透過 API 整合)" }
  ]),

  h2("毛利放大邏輯"),
  dataTable(
    ["模式", "毛利率", "說明"],
    [
      ["現行(只做機場接送)", "15-20%(B2B2C 剩 10-15%)", "單一服務段,獲客成本未攤開"],
      ["轉型後(全程移動)", "30-40%", "同一組乘客承接更多服務段,客單價提升"],
      ["企業客戶(重點)", "更穩定 + 更高", "量大、毛利高、品質需求穩定"]
    ],
    [2400, 2800, 4160]
  ),

  h2("決策時間窗口延長"),
  body("現行:50% 的乘客在 7-14 天前預約,30% 在 3 天內預約。"),
  body("轉型後:當乘客預約包車(跨境),通常會是一個月前就規劃。延伸到全程跨境移動後,整體決策窗口往前拉,廣告投放與行銷有更多觸點可以切入。")
];

// ========================================
// Section 4: 三階段路線圖
// ========================================
const section4 = [
  new Paragraph({ spacing: { before: 480, after: 60 }, children: [new TextRun({ text: "04 / 09", font: "Microsoft JhengHei", size: 16, bold: true, color: ORANGE })] }),
  h1("三階段路線圖"),

  dataTable(
    ["階段", "目標", "時程"],
    [
      ["Phase A — 台灣深耕", "生存線:衝單量、強化現有系統(iFrame、折扣碼、帳款)、達到損益平衡並展示放大潛力給投資人", "接下來 2-3 個月"],
      ["Phase B — 跨境延伸", "串接 GoMyHire、GoGoOut、日本在地車隊,把服務延伸成跨境全程移動的生態", "接續 Phase A"],
      ["Phase C — 企業出海", "以企業客戶為核心,複製台灣模式到海外市場(日本、馬來西亞等)", "12 個月內完成 8 個國家"]
    ],
    [2000, 5600, 1760]
  ),
  spacer(),

  h2("Phase A · 台灣生存線(2-3 個月內)"),
  callout({
    label: "◆ 月營收目標",
    color: SIGNAL,
    bgColor: "F1FAF3",
    lines: [
      [
        { text: "整體月營收:", bold: true, color: SIGNAL },
        { text: "NT$ 4M - 7M" }
      ],
      [
        { text: "通路貢獻:", bold: true, color: SIGNAL },
        { text: "NT$ 5M / 月" }
      ],
      [
        { text: "企業用戶貢獻:", bold: true, color: SIGNAL },
        { text: "NT$ 2M / 月" }
      ],
      "未來 1-2 個月目標月營收從 NT$ 2M 跳到 NT$ 8M - 10M。"
    ]
  }),
  spacer(),

  h2("Phase B · 跨境延伸"),
  body("已接觸 / 洽談中的合作夥伴:"),
  dataTable(
    ["類別", "夥伴", "模式"],
    [
      ["租車平台", "GoGoOut(日本、韓國、美國、泰國、馬來西亞)", "API 串接"],
      ["接送平台(跨國)", "GoMyHire(馬來西亞 2000 司機,另 6-7 國在地車隊)", "NDA 已簽,API 文件互換中"],
      ["日本在地車隊", "沖繩、大阪、東京、北海道(洽談:名古屋、福岡)", "直接整合(非輕量化串接)"]
    ],
    [1800, 5560, 2000]
  ),
  spacer(),

  h2("Phase C · 企業出海"),
  bulletRich([
    { text: "為何是企業客戶:", bold: true, color: NAVY },
    { text: "量大、毛利高、品質需求穩定、流量固定(工廠派駐、出差需求)" }
  ]),
  bulletRich([
    { text: "差異化優勢:", bold: true, color: NAVY },
    { text: "現行台灣最大對手(55688 企業簽單)以城市交通為核心,履約風險低。Skymove 則以「跨境」切入 — 跨境有時差、有機會成本,品質要求高,不是隨便打發可以處理的場景" }
  ]),
  bulletRich([
    { text: "不易被取代:", bold: true, color: NAVY },
    { text: "核心是供應鏈的實際履約能力,不容易被純技術或 AI 取代" }
  ])
];

// ========================================
// Section 5: 商業模式 — B2B / B2B2C 定位
// ========================================
const section5 = [
  new Paragraph({ spacing: { before: 480, after: 60 }, children: [new TextRun({ text: "05 / 09", font: "Microsoft JhengHei", size: 16, bold: true, color: ORANGE })] }),
  h1("商業模式 · B2B / B2B2C 定位"),

  callout({
    label: "◆ 核心定位",
    color: NAVY,
    bgColor: MIST,
    lines: [
      "我們不對 C 端用戶競爭(不做 OTA)。",
      "我們做的是 B2B2C 的供應鏈,讓現有的 OTA 平台(Booking.com、Agoda 等)串接我們。",
      "長期核心是 B2B 企業用戶 — 透過 API / ERP 整合,建立深度黏著(3-5 年拔不掉)。"
    ]
  }),
  spacer(),

  h2("B2B2C(階段性渠道)"),
  bulletRich([
    { text: "目的:", bold: true, color: NAVY },
    { text: "用低行銷成本快速取得訂單量" }
  ]),
  bullet("Skymove 作為 OTA 平台背後的「跨境交通供應鏈解決方案」"),
  bullet("OTA 現況:多數找當地車隊自接 API,供應不穩 → 客訴 → 棄單 → 供應商消失(惡性循環)"),
  bullet("Skymove 的角色:統整跨國供應鏈,讓 OTA 有穩定的跨境交通可售"),

  h2("B2B(長期核心)"),
  bulletRich([
    { text: "目標客戶:", bold: true, color: NAVY },
    { text: "跨國企業(工廠、差旅需求、品質要求穩定)" }
  ]),
  bulletRich([
    { text: "痛點解決:", bold: true, color: NAVY },
    { text: "現行企業 OP 人員訂跨境交通極其繁瑣(當地時間、地址、航班編號、溝通延遲),我們把這段做成一個後台" }
  ]),
  bulletRich([
    { text: "深度綁定:", bold: true, color: NAVY },
    { text: "ERP 層級整合,不是單純 API 串接" }
  ]),

  h2("加值服務(附加,非核心)"),
  dataTable(
    ["服務", "合作夥伴", "定位"],
    [
      ["保險(旅平險 / 駕寶)", "羅賓士科技(下週細談)", "加價購,輕量串接"],
      ["SIM 卡", "待定", "加價購"],
      ["車輛保養 / 維修(內部)", "在地修車廠 / 保養廠", "貓 負責供應鏈品管"]
    ],
    [1900, 3600, 3860]
  ),
  spacer(),

  callout({
    label: "◆ 加值服務原則",
    color: ORANGE,
    bgColor: WARM,
    lines: [
      "加值服務不是核心,但「有錢不賺王八蛋」。",
      "保險、SIM 卡等為 lightweight 整合,不要花大量時間去理解保險法規或商品規劃。",
      "把資源留給核心:跨境交通的供應鏈整合。"
    ]
  })
];

// ========================================
// Section 6: 三大主軸 — 產品、供應鏈、企業
// ========================================
const section6 = [
  new Paragraph({ spacing: { before: 480, after: 60 }, children: [new TextRun({ text: "06 / 09", font: "Microsoft JhengHei", size: 16, bold: true, color: ORANGE })] }),
  h1("三大主軸 · 產品 / 供應鏈 / 企業"),

  h2("主軸一:產品核心(Paul + Judy)"),
  bullet("以航班編號為核心的產品重構"),
  bullet("串聯機場接送、當地包車、租汽車、租機車"),
  bullet("需要快速推出 MVP / POC 產品 → 用於洽談投資人"),
  bullet("B2B 後台:讓企業 OP 可一站式處理跨境交通需求"),

  h2("主軸二:供應鏈(貓, Co-founder)"),
  bullet("司機排班優化演算法(來回燙、接單率)"),
  bullet("司機供應鏈管理(保險到期、車輛保養、證件到期等風險管理)"),
  bullet("車輛保養維修控管(整潔度、品質、修車廠配合)"),
  bullet("司機黑名單與品管(罰單、客訴處理)"),
  bullet("客服流程:標準化 → AI 處理,降低人力成本"),
  bullet("品質監控(遲到、定位、結單率、退單率、接單率)"),

  h2("主軸三:企業客戶(Lewis, CEO)"),
  bullet("拓展企業簽約(量大、穩定、毛利高)"),
  bullet("現有客戶深化(Panasonic、東京威力等)"),
  bullet("海外企業客戶:台灣企業出海的跨境交通需求"),
  bullet("重點:把供應鏈做深,不怕被純平台型對手競爭")
];

// ========================================
// Section 7: 決議事項
// ========================================
const section7 = [
  new Paragraph({ spacing: { before: 480, after: 60 }, children: [new TextRun({ text: "07 / 09", font: "Microsoft JhengHei", size: 16, bold: true, color: ORANGE })] }),
  h1("決議事項"),

  (() => {
    const items = [
      [
        { text: "產品核心轉型", bold: true, color: NAVY },
        { text: ":從「訂單為核心」轉為「" },
        { text: "航班編號為核心", bold: true, color: ORANGE_DEEP },
        { text: "」,串聯跨境全程移動(機場接送 + 包車 + 租車)" }
      ],
      [
        { text: "市場定位", bold: true, color: NAVY },
        { text: ":不做 OTA、不做程式交通、不碰住宿與機票;專注跨境交通供應鏈" }
      ],
      [
        { text: "三階段路線", bold: true, color: NAVY },
        { text: ":Phase A(台灣深耕,2-3 個月)→ Phase B(跨境延伸)→ Phase C(企業出海,12 個月內 8 國)" }
      ],
      [
        { text: "Phase A 目標", bold: true, color: NAVY },
        { text: ":月營收 NT$ 4M-7M(通路 5M + 企業 2M)" }
      ],
      [
        { text: "長期核心客戶", bold: true, color: NAVY },
        { text: ":B2B 企業用戶;B2B2C 為階段性渠道,不是終局" }
      ],
      [
        { text: "加值服務", bold: true, color: NAVY },
        { text: ":保險、SIM 卡等為輕量加價購,不投入核心資源" }
      ],
      [
        { text: "成長策略", bold: true, color: NAVY },
        { text: "從「小步慢走」轉為「大步快跑」,用 AI 加速執行" }
      ],
      [
        { text: "長期退場目標", bold: true, color: NAVY },
        { text: ":2-3 年內公司被併購,估值「幾個億(台幣)」" }
      ]
    ];
    return items.map(segs => new Paragraph({
      numbering: { reference: "numbers-decisions", level: 0 },
      spacing: { after: 100, line: 340 },
      children: segs.map(s => new TextRun({ font: "Microsoft JhengHei", size: 22, color: s.color || BODY, ...s }))
    }));
  })()
].flat();

// ========================================
// Section 8: 待辦清單
// ========================================
const section8 = [
  new Paragraph({ spacing: { before: 480, after: 60 }, children: [new TextRun({ text: "08 / 09", font: "Microsoft JhengHei", size: 16, bold: true, color: ORANGE })] }),
  h1("待辦清單"),

  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3120, 3120, 3120],
    rows: [new TableRow({
      children: [
        ownerBox("OWNER · Lewis(CEO / 業務)", ORANGE, [
          "打跨境合作市場(GoMyHire、GoGoOut、日本在地車隊)",
          "完成與 GoMyHire 的 API 文件互換",
          "推動跟羅賓士科技(保險)的下週深談",
          "企業客戶擴展:衝刺 NT$ 2M / 月 目標",
          "準備投資人洽談素材(MVP / POC)"
        ]),
        ownerBox("OWNER · Paul(工程)", NAVY, [
          "Phase A:iFrame、折扣碼、帳款重構(優先)",
          "產品重構:以航班編號為核心的 MVP 規劃",
          "跨境合作廠商的 API 整合評估",
          "B2B 後台規格:企業一站式跨境交通",
          "協助客服提出小功能讓流程更順(隨時滾動調整)"
        ]),
        ownerBox("OWNER · 貓(Co-founder / 供應鏈)", "8B5CF6", [
          "司機排班最佳化演算法規劃",
          "司機供應鏈風險管理(保險、證件到期)",
          "車輛保養維修控管",
          "司機品管 + 黑名單機制",
          "客服流程標準化 → AI 化規劃"
        ])
      ]
    })]
  }),
  spacer(),

  callout({
    label: "◆ 週五產品會議(本定錨會議的後續)",
    color: NAVY,
    bgColor: MIST,
    lines: [
      "拆成兩段:",
      [
        { text: "段一 · 用戶端", bold: true, color: NAVY },
        { text: "(Paul + Judy 主):B2B 與 B2B2C 用戶進入點、User Flow 設計、跨境服務如何接入系統" }
      ],
      [
        { text: "段二 · 內部供應鏈", bold: true, color: NAVY },
        { text: "(貓主):司機管理、客服流程、車輛控管的現行做法與優化方向" }
      ],
      "Paul 會先消化這些輸入,再回來做系統實作排程。"
    ]
  })
];

// ========================================
// Section 9: 名詞對照表
// ========================================
const section9 = [
  new Paragraph({ spacing: { before: 480, after: 60 }, children: [new TextRun({ text: "09 / 09", font: "Microsoft JhengHei", size: 16, bold: true, color: ORANGE })] }),
  h1("名詞對照表"),
  body("供設計師、新進團隊成員參考。"),
  spacer(),

  dataTable(
    ["術語", "說明"],
    [
      ["定錨會議", "Anchor Meeting — 確立公司方向與核心策略,Business Plan 層級"],
      ["航班編號為核心", "新產品邏輯:以航班號串聯全程移動需求(接送 + 包車 + 租車)"],
      ["跨境交通", "Cross-border Transportation — Skymove 的核心業務範圍"],
      ["程式交通", "當地的城市大眾運輸(地鐵、巴士、計程車)— 不做"],
      ["Phase A / B / C", "三階段路線:台灣深耕、跨境延伸、企業出海"],
      ["B2B", "直接服務企業客戶(長期核心)"],
      ["B2B2C", "透過 OTA、通路服務 C 端(階段性渠道)"],
      ["OTA", "Online Travel Agency — 線上旅遊平台(Booking.com、Agoda 等)"],
      ["PMS / Channel Manager", "旅館業的庫存分發管理系統"],
      ["GoMyHire", "馬來西亞接送平台(2000 司機,另含 6-7 國)"],
      ["GoGoOut", "台灣出發的全球租車平台(日、韓、美、泰、馬)"],
      ["羅賓士科技", "台灣保險科技公司,洽談中的旅平險合作夥伴"],
      ["貓", "Skymove Co-founder,負責供應鏈(司機、車輛、客服品管)"],
      ["55688", "台灣大車隊,企業簽單市場的現行最大對手"]
    ],
    [2600, 6760]
  ),
  spacer(),
  spacer(),

  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 480, after: 60 },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 12 } },
    children: [
      new TextRun({ text: "SKY", font: "Microsoft JhengHei", size: 22, bold: true, color: NAVY }),
      new TextRun({ text: "MOVE", font: "Microsoft JhengHei", size: 22, bold: true, color: ORANGE }),
      new TextRun({ text: "  ·  把移動,變簡單", font: "Microsoft JhengHei", size: 22, bold: true, color: NAVY })
    ]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: "本紀錄由會議逐字稿整理 · 如有細節待補充或修正,請直接回饋給 Paul",
      font: "Microsoft JhengHei", size: 16, color: MUTED, italics: true
    })]
  })
];

// ========================================
// Header & Footer
// ========================================
const docHeader = new Header({
  children: [new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ORANGE, space: 4 } },
    children: [
      new TextRun({ text: "SKYMOVE", font: "Microsoft JhengHei", size: 16, bold: true, color: NAVY }),
      new TextRun({ text: "  │  定錨會議 · 跨境交通平台", font: "Microsoft JhengHei", size: 16, color: MUTED }),
      new TextRun({ text: "\t" }),
      new TextRun({ text: "SKY-BP-001", font: "Microsoft JhengHei", size: 14, bold: true, color: ORANGE })
    ]
  })]
});

const docFooter = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: "— ", color: MUTED, font: "Microsoft JhengHei", size: 16 }),
      new TextRun({ children: [PageNumber.CURRENT], font: "Microsoft JhengHei", size: 16, color: NAVY, bold: true }),
      new TextRun({ text: " / ", color: MUTED, font: "Microsoft JhengHei", size: 16 }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Microsoft JhengHei", size: 16, color: MUTED }),
      new TextRun({ text: " —", color: MUTED, font: "Microsoft JhengHei", size: 16 })
    ]
  })]
});

// ========================================
// Build
// ========================================
const doc = new Document({
  creator: "Skymove",
  title: "定錨會議 - 從機場接送走向跨境交通平台",
  description: "SKY-BP-001 Meeting Minutes",
  styles: {
    default: { document: { run: { font: "Microsoft JhengHei", size: 22, color: BODY } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Microsoft JhengHei", color: NAVY },
        paragraph: { spacing: { before: 480, after: 240 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Microsoft JhengHei", color: NAVY },
        paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Microsoft JhengHei", color: NAVY },
        paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 2 } }
    ]
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 260 } }, run: { color: ORANGE, bold: true } } }] },
      { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 340 } }, run: { color: ORANGE, bold: true } } }] },
      { reference: "numbers-decisions", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 340 } }, run: { color: ORANGE, bold: true } } }] }
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    headers: { default: docHeader },
    footers: { default: docFooter },
    children: [
      ...coverContent, ...section1, ...section2, ...section3, ...section4,
      ...section5, ...section6, ...section7, ...section8, ...section9
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/home/claude/anchor-mom.docx", buffer);
  console.log("✓ DOCX created:", buffer.length, "bytes");
});
