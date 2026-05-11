# Skymove Brand Reference

Visual identity for 車聚科技. These are exact values — use them without modification in every deliverable.

## Primary palette

| Role | Name | Hex | Usage |
|------|------|-----|-------|
| Primary | Orange | `#F37021` | Logo, CTAs, section numbers, emphasis, list markers, accent lines |
| Primary Deep | Deep Orange | `#D85A12` | High-emphasis text on light |
| Primary Light | Light Orange | `#FFB87A` | Subtle borders, secondary accents |
| Secondary | Navy | `#14365C` | Headings, table headers, structural elements |
| Secondary Deep | Midnight | `#0B2340` | Dark cover variants |
| Secondary Light | Light Navy | `#2A5486` | Gradient mid-tone |

## Neutral palette

| Role | Hex | Usage |
|------|-----|-------|
| Ink | `#1A1F2E` | Callout body text |
| Body | `#3D4556` | Default body text |
| Muted | `#7A8499` | Secondary text, captions, footer |
| Line | `#E4E7EE` | Table borders, dividers |
| Background | `#FAFAF7` | Warm off-white page bg (NOT pure white) |
| Surface | `#FFFFFF` | Cards |
| Mist | `#F4F6FB` | Navy-tinted callout bg |
| Warm | `#FFF4E8` | Orange-tinted callout bg |

## Semantic colors

| Role | Hex | Usage |
|------|-----|-------|
| Alert | `#DC2626` | Pain points, critical issues |
| Signal | `#16A34A` | Completions, positive callouts |
| Design | `#8B5CF6` | Reserved for design owner (Judy) boxes |

## Fonts

- **Primary (Chinese)**: `Microsoft JhengHei` (微軟正黑體)
- **Fallback (web)**: `Noto Sans TC`
- **Mono**: `JetBrains Mono`, `Consolas`, or `Courier New` for code/IDs

**Critical for docx**: Always set `font: "Microsoft JhengHei"` on EVERY `TextRun`. Without it, Word falls back inconsistently between 繁中 and English portions.

## Callout color mapping

Four standard types:

| Type | Border/Label | Background | Usage |
|------|--------------|------------|-------|
| Pain (痛點) | `#DC2626` | `#FEF5F5` | Current problem being discussed |
| Solution (方案) | `#16A34A` | `#F1FAF3` | Adopted solution, wins |
| Info (重要) | `#14365C` | `#F4F6FB` | Important constraint or notice |
| Highlight (重點) | `#F37021` | `#FFF4E8` | Orange-emphasized key point |

## Usage rules

### Do
- Orange as accent for ~10% of visual weight (CTAs, section numbers, underlines)
- Navy as dominant structural color (headings, tables)
- Use warm background `#FAFAF7` — never pure white
- Pair callouts by purpose (pain/solution/info/highlight)

### Don't
- Don't use orange for large body text (contrast)
- Don't add palette colors (purple/teal/pink) — stick to the 4 semantic + 2 primary
- Don't use pure black `#000` — Ink `#1A1F2E` is softer

## Logo notes

Skymove's real logo has an orange "swoosh" (suggests flight/motion) on navy. When recreating a simplified mark in covers/headers, use orange polygon clip-paths on navy background to evoke this — don't copy the trademarked mark directly.

For docx cover, use text-based branding: `■ SKYMOVE  │  [meeting-type] · 把移動,變簡單` with the square in orange.
