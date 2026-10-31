---
name: SN Practice CRM
description: A calm, premium command center for accounting-practice operations and collections.
colors:
  command-indigo: "oklch(0.49 0.205 267)"
  command-indigo-hover: "oklch(0.445 0.205 267)"
  command-indigo-soft: "oklch(0.955 0.032 267)"
  office-canvas: "oklch(0.965 0.012 255)"
  porcelain-panel: "oklch(1 0 0)"
  midnight-ink: "oklch(0.225 0.04 264)"
  ledger-muted: "oklch(0.49 0.035 260)"
  hairline: "oklch(0.91 0.014 257)"
  settled-green: "oklch(0.55 0.135 155)"
  attention-amber: "oklch(0.59 0.145 72)"
  overdue-red: "oklch(0.57 0.195 28)"
  collection-gold: "oklch(0.7 0.14 78)"
typography:
  display:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.25
rounded:
  control: "0.75rem"
  panel: "1.25rem"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.25rem"
  xl: "2rem"
components:
  panel:
    backgroundColor: "{colors.porcelain-panel}"
    textColor: "{colors.midnight-ink}"
    rounded: "{rounded.panel}"
    padding: "1.25rem"
  button-primary:
    backgroundColor: "{colors.command-indigo}"
    textColor: "{colors.porcelain-panel}"
    rounded: "{rounded.control}"
    padding: "0.625rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.command-indigo-hover}"
    textColor: "{colors.porcelain-panel}"
    rounded: "{rounded.control}"
    padding: "0.625rem 1rem"
  status-chip:
    backgroundColor: "{colors.command-indigo-soft}"
    textColor: "{colors.command-indigo}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.625rem"
---

# Design System: SN Practice CRM

## Overview

**Creative North Star: "The Quiet Command Center"**

SN Practice CRM should feel like a composed partner's desk at the start of a busy day: everything important is visible, ordered, and ready for action. Its premium quality comes from disciplined proportion, exceptionally clear financial hierarchy, bright materials, and exact state behavior—not ornament.

This is an Operate surface for long desktop sessions. The visual system uses Horizon-inspired geometry and density, but its voice belongs to an Indian accounting practice: deadlines, review queues, billing, receipts, and collections lead the composition. Gold is a rare financial signal, not a background treatment or luxury cliché.

**Key Characteristics:**

- Bright blue-grey office canvas with clean white working surfaces.
- Deep navy information hierarchy with a controlled royal-indigo action voice.
- Compact, first-screen decision density without cramped controls.
- Restrained green, amber, red, and gold reserved for financial meaning.
- Gentle, fast interaction motion that disappears under reduced-motion preferences.

## Colors

The palette is cool, confident, and financially precise; color earns attention by staying scarce.

### Primary

- **Command Indigo:** The principal interaction color for active navigation, links, chart billing data, focus authority, and selected controls.

### Secondary

- **Collection Gold:** Used only for collected-value chart data and similarly explicit financial meaning. It must read as warm gold, never beige decoration.

### Tertiary

- **Settled Green, Attention Amber, and Overdue Red:** Semantic colors for healthy, pending, and at-risk states. They never replace plain-language labels.

### Neutral

- **Office Canvas:** The cool page ground that separates working surfaces.
- **Porcelain Panel:** The white material for cards, tables, and controls.
- **Midnight Ink:** The dominant high-contrast text color.
- **Ledger Muted:** Supporting copy, timestamps, and low-priority metadata.
- **Hairline:** Quiet borders, dividers, chart grids, and table structure.

### Named Rules

**The Earned Color Rule.** Indigo marks action; green, amber, red, and gold communicate state or money. None is used as ambient decoration.

**The Gold Ledger Rule.** Gold appears only where its financial meaning is explicit and must never dominate a working screen.

## Typography

**Display Font:** DM Sans (with system sans-serif fallback)  
**Body Font:** DM Sans (with system sans-serif fallback)

**Character:** DM Sans keeps financial tables crisp while giving headings a confident, contemporary weight. Hierarchy comes from size, weight, and spacing rather than mixing typefaces.

### Hierarchy

- **Display:** Semibold and tightly tracked for greeting and KPI values; numerals use tabular alignment.
- **Title:** Semibold for panel headings and important table labels.
- **Body:** Regular for descriptions and operational copy, usually kept to one concise line in dashboard modules.
- **Label:** Medium or semibold for metadata, controls, and column headers; sentence case is preferred.

### Named Rules

**The One Voice Rule.** Use DM Sans across the product; distinction comes from hierarchy, not a decorative display face.

**The Financial Numeral Rule.** Monetary amounts, counts, dates, and percentages use tabular numerals wherever alignment helps comparison.

## Layout

Desktop is the current delivery target. The shell uses a fixed 264px sidebar and a fluid content region with 24px padding, increasing to 32px at wide desktop sizes. Dashboard modules follow a four-column KPI strip, then an 8/4 leadership split, then full-width operational tables. The working rhythm is based on 4px increments, with 16px between closely related modules and 32px separating major shell regions.

The first 1440×1000 viewport must reveal the management story in order: KPI strip, collections, billing trend, client exposure, and the start of open assignments. Tables fit the available desktop content width without nested horizontal scrolling.

## Elevation & Depth

Depth is ambient and restrained. White panels are separated from the cool canvas by a quiet hairline and a soft two-part shadow; interaction does not create theatrical floating layers.

### Shadow Vocabulary

- **Panel Ambient:** `0 1px 2px oklch(0.22 0.04 264 / 4%), 0 16px 36px -28px oklch(0.22 0.04 264 / 28%)` for dashboard cards and primary containers.

### Named Rules

**The Quiet Depth Rule.** A panel may have one border and one ambient shadow treatment; additional glow, glass, and stacked drop shadows are prohibited.

## Shapes

Panels use generous 20px corners, while controls use compact 12px corners and status chips use a full pill. Borders stay thin and low-contrast. Repeated cards share the same silhouette so density feels intentional, not tiled at random.

## Components

### Buttons

- **Shape:** Compact, gently curved controls using the control radius.
- **Primary:** Command-indigo fill with white text and a clear semibold label.
- **Hover / Focus:** Darken on hover; show a two-pixel indigo focus ring with canvas offset. Press feedback scales to 97% over 140–150ms.
- **Secondary / Ghost:** White or transparent surfaces with hairline borders; maintain the same focus treatment.

### Chips

- **Style:** Soft semantic or accent tint with explicit text, compact padding, and full pill geometry.
- **State:** Never communicate status by color alone; selected controls may use solid command indigo.

### Cards / Containers

- **Corner Style:** Generous panel radius.
- **Background:** Porcelain white over office canvas.
- **Shadow Strategy:** One ambient panel shadow.
- **Border:** One quiet hairline.
- **Internal Padding:** 16–20px, reduced only for dense tables and KPI strips.

### Inputs / Fields

- **Style:** White field, quiet border, control radius, and readable 14px text.
- **Focus:** Visible command-indigo ring with spacing from the field edge.
- **Error / Disabled:** Pair color with plain-language feedback; never rely on reduced opacity alone for meaning.

### Navigation

The 264px desktop sidebar groups role-aware destinations into stable sections. Active navigation uses indigo authority and a soft accent ground; inactive rows remain quiet navy/grey and gain subtle surface feedback on hover.

### Leadership Dashboard

The canonical management dashboard contains exactly the four-card headline strip, Collections Snapshot, Top Client Outstanding, Billing & Collections, and All Open Assignments. Period controls live with the chart they modify. Every financial summary links to the underlying work or ledger.

## Do's and Don'ts

### Do:

- **Do** preserve the summary-to-intervention scan path on every leadership screen.
- **Do** keep actions adjacent to the data that prompts them.
- **Do** use semantic tokens from `src/styles.css`; components do not introduce literal color utilities.
- **Do** design loading, empty, error, keyboard-focus, and reduced-motion states with the primary state.
- **Do** format money, dates, financial years, and timezone-sensitive values with the shared Indian-format helpers.

### Don't:

- **Don't** turn operational pages into marketing pages with oversized heroes, decorative gradients, or novelty motion.
- **Don't** use gold as a luxury wash, border on every card, or substitute for information hierarchy.
- **Don't** add dashboard modules without a concrete management decision they support.
- **Don't** create horizontally scrolling desktop tables at the supported 1440px viewport.
- **Don't** hardcode visual colors inside components or bypass role and RLS behavior for presentation.
