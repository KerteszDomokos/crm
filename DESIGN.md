# Design guidelines

Reusable visual language for dark operational UIs. Apply these tokens and
patterns so new products feel like the same family without copying any one
screen or domain feature.

---

## Principles

1. **Dark by default.** Near-black canvases, soft white text, thin translucent borders. Prefer atmosphere over flat `#111` slabs.
2. **One accent.** A single brand green carries primary actions, selection, and “ready” status. Do not invent a second accent for the same role.
3. **Quiet chrome.** Toolbars and panels stay thin, low-contrast, and secondary to content. Borders do most of the structure; shadows are rare and soft.
4. **Dense but readable.** Prefer compact type (`10–12px` chrome, `sm` body) and tight spacing over spacious marketing layouts.
5. **State in color + icon.** Selection, loading, warning, and error should be obvious without heavy decoration.
6. **Motion is short.** ~200ms ease-outs for drawers, panels, and hover feedback. Respect `prefers-reduced-motion`.

---

## Foundations

### Color tokens

Define CSS variables (names may vary; values should match):

| Token | Value | Role |
| --- | --- | --- |
| `--background` | `#000000` | Page / app shell |
| `--foreground` | `#ededed` | Default text |
| `--panel` | `#0a0a0a` | Sidebars, cards, floating shells |
| `--accent` | `#00cf7f` | Primary brand / CTA / selection |
| `--accent-hover` | `#1bdd92` | Primary button hover |

**White opacity scale** (on dark surfaces):

| Opacity | Use |
| --- | --- |
| `white/90`–`white` | Primary titles, selected labels |
| `white/70`–`white/80` | Body, interactive secondary text |
| `white/50`–`white/60` | Supporting copy, field labels |
| `white/35`–`white/45` | Section eyebrows, muted meta, placeholders |
| `white/20`–`white/30` | Hints, empty secondary lines |
| `white/10`–`white/15` | Borders, hairlines |
| `white/[0.02]`–`white/[0.06]` | Card fills, hover washes, row dividers |

**Semantic colors:**

| Intent | Typical classes / values |
| --- | --- |
| Success / ready | Accent green; filled accent checkbox; small green status dot |
| Warning | `amber-400` / `amber-500` at ~60–80% opacity |
| Danger / error | `red-300`–`red-500`, often at ~80% opacity for text |
| Destructive action | Border `red-500/30`, text `red-300` (outline, not solid fill) |
| On-accent text | `#000` (black on green primary buttons) |

**Atmosphere backgrounds** (auth / admin shells):

```css
background: radial-gradient(
  circle at top,
  #10251e 0%,
  #050807 38–40%,
  #000 72–75%
);
```

Keep the gradient subtle: a cool green-black bloom at the top, dissolving into pure black.

**Theme:** `color-scheme: dark`; browser `theme-color: #000000`.

### Typography

| Role | Spec |
| --- | --- |
| Sans | Geist Sans (or equivalent geometric neo-grotesk), antialiased |
| Mono | Geist Mono — counts, sizes, dates, technical meta, select values |
| Page title | `text-2xl font-semibold tracking-tight` |
| Panel title | `text-sm`–`text-xl font-semibold`, near-white |
| Section eyebrow | `text-[10px] font-medium tracking-[0.18em] uppercase text-white/35` |
| List / section label | `text-xs font-semibold tracking-[0.14em] text-white/70` |
| Body | `text-sm leading-6 text-white/50`–`/70` |
| Chrome / toolbar | `text-[11px]` |
| Meta / mono caption | `font-mono text-[10px]`–`text-[11px] text-white/30`–`/60` |
| Brand eyebrow | Accent color + wide tracking + uppercase product name |

Avoid Inter / system stacks for branded surfaces. Numbers that update (counts, percentages, areas) use mono + tabular figures where alignment matters.

### Spacing & radius

| Token | Value | Use |
| --- | --- | --- |
| Panel padding | `px-4` / `p-3`–`p-5` | Section rhythm |
| Card padding | `px-3 py-2.5` | Compact tiles |
| Stack gaps | `gap-1.5`–`gap-4` | Forms `space-y-5` or `gap-4` |
| Radius — controls | `rounded` / `rounded-md` | Buttons, inputs, icon buttons |
| Radius — shells | `rounded-xl` | Auth cards, admin panes, floating docks |
| Radius — pills | `rounded-full` | Status badges, range tracks only |
| Icon button | `h-7 w-7` grid center | Close / utility |

Hairline structure: `border-white/10` between panel sections. Prefer borders over heavy shadows.

### Elevation & glass

| Surface | Treatment |
| --- | --- |
| Solid panel | `bg-panel` or `#0a0a0a` |
| Frosted overlay | `bg-[#0a0a0a]/90`–`/95` + `backdrop-blur` / `backdrop-blur-sm` |
| Soft lift | `shadow-2xl` (optionally `shadow-black/50`) on floating cards and drawers |
| Map / canvas chrome | Match panel fill; borders `white/10`; no default light-theme controls |

---

## Components

### Primary button

- Fill: accent green
- Text: black, `text-sm font-semibold` (or `font-medium`)
- Padding: `px-3–4 py-2–2.5`, `rounded` / `rounded-md`
- Hover: slightly lighter green (`#1bdd92`)
- Disabled / pending: `opacity-40`–`60`, `cursor-wait` when busy
- Optional leading lucide icon at `h-4 w-4`

Use for the single main action on a form or toolbar group (sign in, save, create).

### Secondary / ghost button

- Transparent fill, `border border-white/10`–`/15`
- Text `text-white/70`, `text-[11px]`–`text-sm`
- Hover: `border-white/20`, `bg-white/5`, text toward white
- Disabled: `opacity-30`–`40`

### Accent outline button

For important-but-not-primary actions (e.g. bulk select):

- `border-accent/20`–`/30`, text `accent/80`
- Hover: stronger border + `bg-accent/[0.06]`

### Destructive button

- Outline only: `border-red-500/30 text-red-300`
- Never a solid red primary fill for routine UI

### Icon-only control

- `h-7 w-7`, `rounded`, border `white/10`, icon `h-3.5 w-3.5` at `white/40`–`/60`
- Hover: brighter border/icon, light wash

### Checkbox / selection mark

- Box `h-4 w-4`, `rounded-sm`, border `white/20` when off
- On: fill + border accent; check icon black, stroke ~3
- Selected row/card: `border-accent/40 bg-accent/[0.06]`
- Idle card: `border-white/10 bg-white/[0.02]`; hover raise border/fill slightly

### Text fields & selects

- `rounded` / `rounded-md`, `border-white/10`–`/15`, `bg-black/40` or `bg-white/5`
- Text `text-sm` (chrome search can be `12px`)
- Padding ~`px-3 py-2.5`
- Focus: accent border (`accent/50`–`/70`) and optional `ring-2 ring-accent/20`
- Labels: `text-sm text-white/70` or eyebrow style for section controls
- Placeholders: `text-white/30`
- Compact header search: lower height (`h-8`), leading search icon in `white/35`

### Summary / metric tiles

- Compact bordered cell: `rounded border-white/10 bg-white/[0.02] px-3 py-2.5`
- Eyebrow row: tiny icon (`h-3 w-3`) + `10px` label in `white/35`
- Value: `font-mono text-xl`; accent color when the metric is “active / non-zero”
- Optional hint in `10px white/30`; warning note in `9px amber-400/60`

When a tile represents a colored layer, active state tints border/background from that layer color (~8–50% alpha) instead of the brand green.

### List rows & detail definition lists

- Key/value rows: two-column grid, label `text-white/50`, value `text-white/90`, hairline `border-white/[0.06]`
- Metadata blocks: optional collapsed section with chevron; expanded content in a bordered inset `bg-white/[0.03]`

### Status

| State | Cue |
| --- | --- |
| Loading | Spinner (`LoaderCircle` / `Loader2`) in accent or muted white, `animate-spin` |
| Ready | Accent dot `h-1.5 w-1.5 rounded-full` or small check |
| Warning | Amber triangle / text |
| Error | Red triangle / `text-red-400` |
| Empty / idle copy | Centered or padded `text-xs text-white/40` |

Status **pills** (short codes): `rounded-sm px-1.5`, mono ~`9px`; success uses accent wash, other states amber wash.

### Progress / meters

- Track: `h-1.5–2 rounded-full bg-white/10`
- Fill: semantic color (`emerald` / `amber` / `red`) or accent for generic ranges
- Range inputs: same track language; `accent-color` set to brand green

### Floating / docked panels

- Desktop: absolute/fixed dock with `rounded-xl border-white/10`, frosted panel fill, soft shadow; enter with short opacity + translate
- Mobile: full-bleed sheet or edge drawer; `translate` slide; dimmer `bg-black/50` behind overlays
- Panel sections separated by `border-b border-white/10`; sticky headers stay `shrink-0`

### Dropdown / combobox menus

- `rounded-md border-white/10 bg-[#0a0a0a]/95 backdrop-blur shadow-2xl`
- Options `px-3 py-2`; active/hover `bg-white/5`–`/10`
- Primary line ~`12px`; secondary meta `10px text-white/40`

### App header (tool layout)

- Height ~`h-11`, bottom border `white/10`, horizontal `px-4`
- Left: mark + primary control (search)
- Center (optional, md+): muted product line `11px white/35`
- Right: identity, secondary links, logout, panel toggles — all ghost chrome

### Auth / empty / denied shells

- Centered card `max-w-sm`–`md`, `rounded-xl border-white/10`, panel fill, optional heavy shadow
- Brand mark, accent uppercase eyebrow, `text-2xl` title, muted supporting sentence, then form
- Access denied: centered icon in soft red, short explanation, ghost actions

---

## Icons

- Library: **lucide-react**
- Default stroke weight; emphasize checks with slightly heavier stroke when on accent fills
- Sizes: `h-3` / `h-3.5` in dense chrome; `h-4` in primary buttons; `h-10` for empty-state heroes
- Color inherits from text; do not multicolor icons except status semantics

---

## Motion

| Interaction | Timing |
| --- | --- |
| Drawer / panel show-hide | `duration-200 ease-out` (opacity + transform) |
| Hover color transitions | `transition-colors` |
| Expand chevrons | rotate `180°` with transform transition |
| Thumbnail / strip reveal | ~200ms custom ease (`cubic-bezier(0.22, 1, 0.36, 1)`); disable under `motion-reduce` |
| Busy controls | spinner + reduced opacity; keep layout stable |

Avoid long fades, bounce, and decorative parallax.

---

## Layout patterns

1. **Full-viewport app shell** — `h-dvh` / `h-full`, column flex, `overflow-hidden`; scroll only inside lists/panels.
2. **Content + side column** — main canvas flexes; side panel fixed width ~`380px` on large screens; overlays as drawers below `lg` (~1024px).
3. **Admin / settings** — max width ~`5xl`, radial atmosphere background, header with border, split list + detail panes in `rounded-xl` panel cards.
4. **Safe areas** — bottom chrome respects `env(safe-area-inset-bottom)` on small screens.

Breakpoints used in this language: treat `lg` (1024px) as the desktop chrome switch (persistent side panel vs drawer; floating vs stacked detail).

---

## Do / don’t

**Do**

- Keep hierarchy with opacity and tracking, not with many font weights or colors
- Put brand green only on primary actions, selection, and positive status
- Use mono for machine-readable values
- Match third-party widgets (maps, etc.) to panel borders and dark fills

**Don’t**

- Light mode or purple/indigo AI-default gradients
- Large rounded “marketing” cards in the main workspace
- Solid red primary buttons or rainbow accents
- Heavy drop shadows stacked on every tile
- Oversized type in tool chrome

---

## Starter tokens (CSS)

Copy and rename the accent if needed; keep the ratios.

```css
:root {
  --background: #000000;
  --foreground: #ededed;
  --panel: #0a0a0a;
  --accent: #00cf7f;
  --accent-hover: #1bdd92;
}

html {
  color-scheme: dark;
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans), system-ui, sans-serif;
}
```

Wire `--accent` into your utility framework (e.g. Tailwind theme color) so components can share `bg-accent`, `border-accent/40`, `text-accent`, and `accent-accent` for range inputs.

---

## Checklist for a new surface

- [ ] Black / panel surfaces + `white/10` borders
- [ ] Accent used for primary CTA and selection only
- [ ] Eyebrow labels at `10px` / wide tracking / `white/35`
- [ ] Form fields use dark translucent fills and accent focus
- [ ] Ghost buttons for secondary actions
- [ ] Lucide icons at chrome scale
- [ ] Compact spacing; scroll inside regions, not the page
- [ ] Short transitions; usable on mobile with drawer/sheet patterns

