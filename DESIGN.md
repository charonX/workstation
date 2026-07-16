# OPC Workstation Design System

## Product Identity

- **Product**: OPC Workstation Desktop App
- **Users**: Solo developers and content creators who run repetitive information workflows
- **Mood**: Developer-tool precision, high-density, immersive, technical
- **Platform**: Desktop application (Tauri + React), primarily dark mode

## Design Principles

1. **Functional Minimalism** — every element serves a purpose; no decorative noise
2. **Cognitive Clarity** — dense information is organized by layers, borders, and typography
3. **Developer Aesthetic** — dark canvas, monospace for data, high contrast for status
4. **Efficiency First** — minimize clicks and eye movement for power users

## Color System

The design system supports both **dark** and **light** themes.

- Default theme: **dark** (`<html data-theme="dark">`)
- Explicit switch: toggle `data-theme` attribute on `<html>` between `"dark"` and `"light"`
- If no `data-theme` is set, the theme follows the OS `prefers-color-scheme`

### Dark Mode Tokens

| Token | Hex | Usage |
|---|---|---|
| `--ch-bg` | `#0e1513` | Application background |
| `--ch-surface` | `#1a211f` | Panels, sidebars, cards |
| `--ch-surface-high` | `#242b2a` | Elevated panels, hover states |
| `--ch-surface-highest` | `#2f3634` | Active items, inputs |
| `--ch-border` | `#2f3634` | Structural borders |
| `--ch-border-strong` | `#3c4a46` | Focused/active borders |
| `--ch-text` | `#dde4e1` | Primary text |
| `--ch-text-secondary` | `#8b929d` | Secondary text, labels |
| `--ch-text-tertiary` | `#5f6a66` | Disabled, placeholders |
| `--ch-accent` | `#2dd4bf` | Primary accent (teal) |
| `--ch-accent-dim` | `#1a9e8e` | Accent hover / dim |
| `--ch-accent-text` | `#003731` | Text on accent background |
| `--ch-success` | `#22c55e` | Success / running |
| `--ch-warning` | `#f59e0b` | Warning / scheduled |
| `--ch-error` | `#ef4444` | Error / failed |
| `--ch-info` | `#3b82f6` | Info / HTTP / generic actions |
| `--ch-codex` | `#a855f7` | Codex / agent nodes |
| `--ch-skill` | `#06b6d4` | Skill / Claude Code nodes |
| `--ch-trigger` | `#f59e0b` | Trigger nodes |
| `--ch-output` | `#22c55e` | Output nodes |

### Light Mode Tokens

| Token | Hex | Usage |
|---|---|---|
| `--ch-bg` | `#f6f7f5` | Application background |
| `--ch-surface` | `#ffffff` | Panels, sidebars, cards |
| `--ch-surface-high` | `#f0f1ef` | Elevated panels, hover states |
| `--ch-surface-highest` | `#e6e7e4` | Active items, inputs |
| `--ch-border` | `#d9dbd6` | Structural borders |
| `--ch-border-strong` | `#bfc2bb` | Focused/active borders |
| `--ch-text` | `#1a1c19` | Primary text |
| `--ch-text-secondary` | `#4d524b` | Secondary text, labels |
| `--ch-text-tertiary` | `#7a8179` | Disabled, placeholders |
| `--ch-accent` | `#0d9488` | Primary accent (darker teal for light bg) |
| `--ch-accent-dim` | `#0f766e` | Accent hover / dim |
| `--ch-accent-text` | `#ffffff` | Text on accent background |
| `--ch-success` | `#16a34a` | Success / running |
| `--ch-warning` | `#d97706` | Warning / scheduled |
| `--ch-error` | `#dc2626` | Error / failed |
| `--ch-info` | `#2563eb` | Info / HTTP / generic actions |
| `--ch-codex` | `#9333ea` | Codex / agent nodes |
| `--ch-skill` | `#0891b2` | Skill / Claude Code nodes |
| `--ch-trigger` | `#d97706` | Trigger nodes |
| `--ch-output` | `#16a34a` | Output nodes |

### Theme Switching

HTML prototypes should set an explicit theme on the root element:

```html
<html data-theme="dark">
```

A theme toggle can switch this attribute at runtime:

```js
document.documentElement.setAttribute('data-theme', 'light');
```

## Typography

- **UI Sans**: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- **Mono**: `"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace`

| Token | Size | Weight | Line | Usage |
|---|---|---|---|---|
| `--ch-text-xs` | 11px | 500 | 16px | Tags, timestamps |
| `--ch-text-sm` | 12px | 400 | 18px | Captions, meta |
| `--ch-text-base` | 13px | 400 | 20px | Body text, labels |
| `--ch-text-md` | 14px | 400 | 22px | Panel titles |
| `--ch-text-lg` | 16px | 600 | 24px | Section headers |
| `--ch-text-xl` | 20px | 600 | 28px | Page titles |
| `--ch-text-2xl` | 28px | 700 | 36px | Hero / empty states |

## Spacing

| Token | Value |
|---|---|
| `--ch-space-1` | 4px |
| `--ch-space-2` | 8px |
| `--ch-space-3` | 12px |
| `--ch-space-4` | 16px |
| `--ch-space-5` | 20px |
| `--ch-space-6` | 24px |
| `--ch-space-8` | 32px |
| `--ch-space-10` | 40px |

## Border Radius

| Token | Value |
|---|---|
| `--ch-radius-sm` | 4px |
| `--ch-radius-md` | 6px |
| `--ch-radius-lg` | 8px |
| `--ch-radius-xl` | 12px |
| `--ch-radius-full` | 9999px |

## Components

### Buttons

- **Primary**: `background: var(--ch-accent); color: var(--ch-accent-text); border-radius: var(--ch-radius-md); padding: 6px 14px; font-weight: 600;`
- **Secondary**: `background: transparent; border: 1px solid var(--ch-border); color: var(--ch-text);`
- **Ghost**: `background: transparent; color: var(--ch-text-secondary);` — hover adds `var(--ch-surface-high)` background

### Inputs

- Background: `var(--ch-surface-highest)`
- Border: `1px solid var(--ch-border)`
- Border-radius: `var(--ch-radius-md)`
- Font: mono for values, sans for labels
- Focus: `border-color: var(--ch-accent)`

### Nodes (Flow Editor)

- Rounded rectangle, `var(--ch-radius-lg)`
- Left colored accent bar indicating node type
- Title in sans, config summary in mono
- Connection ports: 8px circles on left/right edges
- Selected state: `box-shadow: 0 0 0 2px var(--ch-accent)`

### Cards

- Background: `var(--ch-surface)`
- Border: `1px solid var(--ch-border)`
- Border-radius: `var(--ch-radius-lg)`
- Hover: `border-color: var(--ch-border-strong)`

### Status Indicators

- Dot + label pattern
- Running: pulsing teal dot
- Success: solid green dot
- Error: solid red dot
- Warning: solid amber dot

## Layout

- **4px base grid** — all spacing aligns to 4px multiples
- **Workbench layout**: topbar (48px) + 3-column main (sidebar 260px / canvas / right panel 320px)
- **Panel padding**: 16px
- **Canvas**: dotted grid on `var(--ch-bg)`, nodes snap to 8px grid
