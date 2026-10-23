# UI Style Guide — match the Excel Autograder look

Give this file to Claude Code (e.g. drop it in the repo as `docs/UI-STYLE-GUIDE.md` and reference it from
`CLAUDE.md`, or paste it into `CLAUDE.md` directly). It describes the UI stack, theme, and component patterns
of the Excel Autograder client so a new app looks and behaves the same.

---

## 1. Stack (use exactly these)

| Concern | Library | Version in source app |
|---|---|---|
| Framework | React + TypeScript, Vite | react 19, vite 7, TS 5.9 |
| UI kit | **Mantine** (`@mantine/core`, `hooks`, `form`, `modals`, `notifications`, `dates`, `dropzone`) | ^9.7 |
| Icons | **`@tabler/icons-react`** only | ^3.49 |
| Routing | `react-router` v7 (data router: `createBrowserRouter`) | ^7.18 |
| Server state | `@tanstack/react-query` v5 | ^5.104 |
| Dates | `dayjs` (+ `relativeTime` plugin) | ^1.11 |
| Styling | Mantine style props + **CSS Modules** with `postcss-preset-mantine` (`light-dark()`, `@mixin hover`, `$mantine-breakpoint-*`) | — |

No Tailwind, no styled-components, no other component library, no other icon set.

### postcss.config.cjs
```js
module.exports = {
  plugins: {
    'postcss-preset-mantine': {},
    'postcss-simple-vars': {
      variables: {
        'mantine-breakpoint-xs': '36em',
        'mantine-breakpoint-sm': '48em',
        'mantine-breakpoint-md': '62em',
        'mantine-breakpoint-lg': '75em',
        'mantine-breakpoint-xl': '88em',
      },
    },
  },
};
```

---

## 2. Theme (copy `theme.ts` verbatim; change `brand` only if the new app needs a different accent)

```ts
import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Spreadsheet green, close to Excel's #217346.
const brand: MantineColorsTuple = [
  '#e9f8ef', '#d5eedf', '#aadbbf', '#7cc79c', '#56b67f',
  '#3eab6c', '#30a562', '#219051', '#168047', '#006e3a',
];

export const theme = createTheme({
  primaryColor: 'brand',
  // Shade 8 keeps white text ≥ 4.5:1 on filled brand and red in both schemes.
  primaryShade: { light: 8, dark: 8 },
  autoContrast: true,
  colors: { brand },
  defaultRadius: 'md',
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  headings: { fontWeight: '650' },
  components: {
    Card: { defaultProps: { withBorder: true, radius: 'md', padding: 'lg' } },
    Paper: { defaultProps: { radius: 'md' } },
    Badge: { defaultProps: { radius: 'sm' } },
    Tooltip: { defaultProps: { withArrow: true } },
  },
});
```

### global.css
```css
html, body, #root { min-height: 100%; }

body {
  background: light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-8));
}

/* Semantic text colors with ≥ 4.5:1 contrast in both schemes (used for score/status text). */
:root, [data-mantine-color-scheme='light'] {
  --score-text-high: #08664a;
  --score-text-good: #4a6b0a;
  --score-text-fair: #8a5a00;
  --score-text-low:  #b02525;
}
[data-mantine-color-scheme='dark'] {
  --score-text-high: var(--mantine-color-teal-4);
  --score-text-good: var(--mantine-color-lime-4);
  --score-text-fair: var(--mantine-color-yellow-4);
  --score-text-low:  var(--mantine-color-red-4);
}
```

### Provider tree (`main.tsx`)
```tsx
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/notifications/styles.css';
import './global.css';

<MantineProvider theme={theme} defaultColorScheme="auto">
  <Notifications position="top-right" />
  <QueryClientProvider client={queryClient}>
    <ModalsProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ModalsProvider>
  </QueryClientProvider>
</MantineProvider>
```
Color scheme is **auto** (follows OS) with a manual sun/moon toggle in the header. Everything must work in
both light and dark mode — use Mantine CSS vars / `light-dark()`, never hard-coded hex in components.

---

## 3. App shell / layout

- `AppShell` with `header={{ height: 60 }}`, `navbar={{ width: 270, breakpoint: 'sm', collapsed: { mobile: !opened } }}`, `padding="lg"`.
- **Header**: left = `Burger` (hiddenFrom sm) + brand mark (32px rounded SVG icon, `rx=7`, brand green fill) + app name `Text fw={700} size="lg"` (visibleFrom xs). Right = color-scheme `ActionIcon variant="default" size="lg"` + account `Menu` (`position="bottom-end" width={220}`) whose target is `Avatar name color="initials" radius="xl" size={34}` + name/role stack (`Text size="sm" fw={600}` / `Text size="xs" c="dimmed" tt="capitalize"`) + `IconChevronDown size={14}`. Dropdown: `Menu.Label` with email, items with `leftSection` icons (16px), `Menu.Divider`, red "Sign out" item.
- **Navbar** (`p="sm"`): `NavLink` items with `leftSection` 18px icons; sections separated by `Divider my="sm" label="…" labelPosition="left"`; scrolling middle section `AppShell.Section grow component={ScrollArea}`; loading state = two `Skeleton h={34}`; empty state = `Text size="sm" c="dimmed" px="sm"`. Footer section: tiny dimmed meta text + `Badge variant="light" size="xs"`.
- **Page content**: starts with `<PageHeader>` (below), then content. Scroll to top on new page (not on back/forward).
- Global warning banners (e.g. temporary password) are a `Alert color="yellow" mb="lg"` at the top of `AppShell.Main`.

### Auth pages (no shell)
`Center mih="100vh" px="md" py="xl"` → `Stack w="100%" maw={440} gap="lg"` → brand mark 52px + app name `Text fw={700} size="xl"` centered → `Paper withBorder shadow="sm" p={{ base: 'lg', xs: 'xl' }}` containing `Title order={2} ta="center" fz="h3"` + `Text c="dimmed" size="sm" ta="center"` subtitle + form → footer `Text size="sm" ta="center"` with `Anchor fw={600}` link.

---

## 4. Shared components (recreate these with the same API and look)

### `PageHeader`
```tsx
<PageHeader crumbs={[{label:'Dashboard', to:'/x'}, {label:'Current'}]} title="…" subtitle="…" badges={…} actions={<Button …/>} />
```
`Stack gap={6} mb="lg"` → optional `Breadcrumbs separatorMargin={6} fz="sm"` (links are `Anchor fz="sm"`, last crumb is `Text fz="sm" c="dimmed"`) → `Group justify="space-between" align="flex-start" wrap="wrap" gap="sm"` with title block `style={{ minWidth: 0, flex: '1 1 260px' }}` containing `Title order={2}` + inline badges, `Text c="dimmed" size="sm"` subtitle; actions in `Group gap="sm"` on the right.

### `QueryState` / `PageLoader` / `ErrorAlert`
- `PageLoader`: `Center py="xl"` → `Stack align="center" gap="xs"` → `Loader` + optional dimmed label.
- `ErrorAlert`: `Alert color="red" icon={<IconAlertCircle/>} title="Could not load this"` with message and a `Button size="xs" variant="white" color="red"` "Try again".
- `QueryState`: render-prop wrapper around a TanStack query → loader / error alert / `children(data)`.
- `ServerUnreachable`: full-page `Paper withBorder shadow="sm" maw={440}` with `ThemeIcon size={52} radius="xl" variant="light" color="orange"`, title `fz="h3"`, dimmed text, `Button leftSection={<IconRefresh size={18}/>}`.

### `NotFoundCard` / empty states
`Card py={48}` → Mantine `EmptyState variant="light" color="gray" size="lg" icon title description` → `EmptyState.Actions` with a primary `Button`. First-run empty states use the same but with a brand-colored icon (`<IconSchool size={32}/>`) and a `Button size="md" leftSection={<IconPlus size={18}/>}`.

Small inline "all clear" empty states inside cards: `Group gap="sm" py="md" wrap="nowrap"` → `ThemeIcon color="teal" variant="light" size={36} radius="xl"` + `Text fw={600}` / `Text size="sm" c="dimmed"`.

### Status badges
All status badges spread `BADGE_NO_SHRINK = { miw: 'max-content', style: { flexShrink: 0 } }` so they never clip.
- Default status badge: `Badge variant="light" size="sm"` with semantic color (see §6).
- Critical flag ("Late"): `Badge color="red" variant="filled" leftSection={<IconClockExclamation size={12}/>}` — the only filled badge; identical everywhere.
- Mode/type badges: `Badge variant="outline"` with 12px icon (`brand` for primary mode, `indigo` for secondary).
- Count badges ("3 late", "2 to grade"): `Badge variant="light" size="md"` with 12px icon; render nothing for 0.
- Tab counts: `Badge size="xs" variant="light" circle` in `Tabs.Tab rightSection`.
- Code/ID chips: `Badge variant="default" tt="none" ff="monospace"`.
- Big header chip with copy button: `Badge size="xl" variant="light" color="gray" tt="none" fw={500} pr={4} rightSection={<CopyIconButton/>}`.
- Explanatory badges get a `Tooltip` (`multiline maw={300}` for long text).

### `CopyIconButton`
`CopyButton value timeout={1500}` → `Tooltip label={copied ? 'Copied' : label}` → `ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} size="sm"` with `IconCheck`/`IconCopy size={14}`.

### `StatCard` (dashboard KPI tile)
`Card padding="md"` → `Group justify="space-between" wrap="nowrap" align="flex-start"` → left `Stack gap={2}`: label `Text size="xs" c="dimmed" tt="uppercase" fw={700}`, value `Text fz={28} fw={700} lh={1.2}`, optional hint `Text size="xs" c="dimmed"`; right `ThemeIcon variant="light" color size={40} radius="md" visibleFrom="xs"` with 22px icon. Laid out in `SimpleGrid cols={{ base: 2, md: 4 }} spacing="md" mb="lg"`. Loading value = `Skeleton h={30} w={40}`.

### Clickable link card (grid of entities)
`Card component={Link} className={classes.linkCard}`; title `Text fw={650} size="lg" lineClamp={2}`, description `Text size="sm" c="dimmed" lineClamp={2} mb="md" style={{flex:1}}`, meta row `Group gap="lg"` of (`16px dimmed icon` + `Text size="sm"`). Grid: `SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md"`.

### List rows inside a card
`UnstyledButton component={Link} className={classes.row}` inside `Stack gap={2} mx="-md"` (negative margin so hover bleeds to card edge). Row: `Text fw={600} truncate` + `Text size="xs" c="dimmed" truncate`, right side badges + `IconChevronRight size={16} color="var(--mantine-color-dimmed)"`. Progress rows use `Progress size="sm"` + `Text size="xs" c="dimmed"` "3/12 in".

### Card section header
`Group justify="space-between" mb="sm"` → `Title order={3} fz="h4"` + count `Badge variant="light"` or `Text size="sm" c="dimmed"`.

### `FileDropzone`
Built on `@mantine/dropzone`, wrapped in `Input.Wrapper` (label/description/error/withAsterisk). Idle icon `IconFileSpreadsheet size={46} stroke={1.5} color="var(--mantine-color-dimmed)"`, accept `IconUpload` brand-colored, reject `IconX` red-6. Text `size="lg" fw={500}` + dimmed hint "types · up to N MB". `compact` prop halves sizes for use in tables/modals. Selected file shows a `Paper withBorder p="sm"` with `ThemeIcon size={40} variant="light" radius="md"`, name `Text size="sm" fw={500} truncate`, size `Text size="xs" c="dimmed"`, and a `ActionIcon variant="subtle" color="gray" size="lg"` ✕ with tooltip. Error state sets `borderColor: var(--mantine-color-error)`.

---

## 5. Interaction patterns

### Forms
- `@mantine/form` with `mode: 'uncontrolled'`, `key={form.key('field')} {...form.getInputProps('field')}`; `<form noValidate>`.
- Fields in `Stack gap="md"`. `TextInput`, `PasswordInput`, `Textarea autosize minRows={3} maxRows={8}`, `NumberInput`, `Select`, `Switch`, `Radio`, `SegmentedControl`, `DateTimePicker`.
- Field-level: `label`, optional `description` ("Optional. …"), `placeholder` with a concrete example ("e.g. Business Math — Period 3"), `required` → asterisk.
- Server 400 field errors → `form.setErrors(fieldErrors(err))`; other errors → notification or inline `Alert`.
- Submit: `Button type="submit" loading={mutation.isPending}`; auth forms use `fullWidth size="md"` with a leading icon.
- Unsaved changes guarded with `useBlocker`; sticky `saveBar` (`position: sticky; bottom: var(--mantine-spacing-md); z-index: 5`).

### Modals
- `Modal opened onClose title="Verb noun" size="md"`; first field `data-autofocus`.
- Footer: `Group justify="flex-end" gap="sm"` → `Button variant="default"` Cancel, then primary `Button type="submit" loading`.
- Reset form + mutation on close.
- Destructive confirmations via `modals.openConfirmModal` with `labels: { confirm, cancel: 'Cancel' }`, `confirmProps: { color: 'red' }`, keep open with `loading: true` while the action runs (`closeOnConfirm: false`, then `modals.close`).

### Notifications
`notifications.show({ color: 'teal', title, message })` for success, `color: 'red'` for errors. Position top-right. Success message says what to do next ("Add your students next…").

### Tables
`Table.ScrollContainer minWidth={620}` → `Table` (`highlightOnHover`, `verticalSpacing="sm"` typical). Person cells: `Avatar name color="initials" radius="xl" size={32}` + `Text fw={500} size="sm"` + dimmed secondary. Row actions: `Menu position="bottom-end" withinPortal width={260}` from `ActionIcon variant="subtle" color="gray"` with `IconDots size={18}`, `aria-label="Actions for {name}"`. Flagged rows: `.lateRow` (red tint + 4px red inset left edge). Sticky first column `.stickyCol` for wide grids.

### Tabs
`Tabs value onChange keepMounted={false}` driven by `?tab=` search param (replace, not push). `Tabs.List mb="lg"`, each `Tabs.Tab` has a 16px `leftSection` icon and optional `rightSection` count badge.

### Alerts (inline)
`Alert variant="light"` with an icon and a short title, body `Text size="sm"`, optional `Button size="sm"` inside a `Stack gap="sm" align="flex-start"`. Severity colors: red (error), yellow (warning), grape (account/info nudge), orange (connectivity), teal/brand (success). `variant="filled"` red only for the unmissable "Late submission" banner.

### Other
- Tooltips on every icon-only button, plus `aria-label`.
- `Kbd` for keyboard shortcut hints; `RingProgress` for score rings; `Accordion` for collapsible detail sections; `Skeleton` for loading placeholders sized like the content.
- Selectable option cards (`.modeCard`): 2px border, `[data-checked]` → brand border + `--mantine-primary-color-light` background + `shadow-xs`.
- Browser tab title: `"{Page} · {App name}"` via a `usePageTitle` hook.

---

## 6. Color semantics (Mantine color names)

| Meaning | Color |
|---|---|
| Primary / brand actions, selected, autograded-mode outline | `brand` |
| Success, graded, caught-up, copied | `teal` |
| Informational / submitted / neutral count | `blue` |
| Needs action / pending work | `orange` |
| Overdue, late, missing-after-deadline, destructive | `red` |
| Warning banner | `yellow` |
| Account / invitation nudges, secondary-mode outline | `grape` / `indigo` |
| Neutral, not-yet, disabled-ish | `gray` |
| Score bands (fills) | ≥90 teal · ≥70 lime · ≥50 yellow · <50 red · null gray |
| Score bands (text) | use the `--score-text-*` CSS vars from global.css |

---

## 7. Spacing / sizing conventions

- Page padding `lg`; section gap `mb="lg"`; card internal gaps `sm`/`md`; tight stacks `gap={2}`–`gap={6}`.
- Icon sizes: 12 in badges · 14 in tiny action icons · 16 in menu items/tabs/meta · 18 in buttons/nav · 20–22 in ThemeIcons · 28–32 in large empty-state/ThemeIcon · 46 in dropzone idle.
- `ThemeIcon variant="light"` everywhere (36 `radius="xl"` for inline status, 40 `radius="md"` for stat tiles, 52 `radius="xl"` for full-page states).
- Avatars: 34 in header, 32 in table rows, always `color="initials" radius="xl"`.
- Headings: `Title order={2}` page title; `Title order={3} fz="h4"` card/section title; `Title order={2} fz="h3"` for centered card pages.
- Secondary text is always `c="dimmed"`; labels above numbers are `size="xs" tt="uppercase" fw={700}`.
- Radius: theme default `md`; badges `sm`; avatars/round ThemeIcons `xl`.
- Transitions: `120ms ease` on border-color / box-shadow / transform; hover lift `translateY(-1px)`.
- Focus: `outline: 2px solid var(--mantine-primary-color-filled); outline-offset: 2px` (−2px for rows).
- Responsive: `visibleFrom`/`hiddenFrom` props; grids `cols={{ base, sm, md, lg }}`; `Grid.Col span={{ base: 12, md: 7 }}`.

---

## 8. CSS module snippets to reuse

```css
/* cards.module.css */
.linkCard {
  display: flex; flex-direction: column; height: 100%;
  color: inherit; text-decoration: none;
  transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
  @mixin hover {
    border-color: var(--mantine-primary-color-filled);
    box-shadow: var(--mantine-shadow-sm);
    transform: translateY(-1px);
  }
  &:focus-visible { outline: 2px solid var(--mantine-primary-color-filled); outline-offset: 2px; }
}

.row {
  display: block;
  padding: var(--mantine-spacing-sm) var(--mantine-spacing-md);
  border-radius: var(--mantine-radius-md);
  color: inherit; text-decoration: none;
  @mixin hover { background-color: light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6)); }
  &:focus-visible { outline: 2px solid var(--mantine-primary-color-filled); outline-offset: -2px; }
}

.stickyCol {
  position: sticky; left: 0; z-index: 1;
  background-color: var(--mantine-color-body);
  box-shadow: inset -1px 0 0 var(--mantine-color-default-border);
}

.flaggedRow { background-color: var(--mantine-color-red-light); }
.flaggedRow > td:first-child { box-shadow: inset 4px 0 0 var(--mantine-color-red-filled); }

.modeCard {
  height: 100%; padding: var(--mantine-spacing-md);
  border: 2px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4));
  background-color: light-dark(var(--mantine-color-white), var(--mantine-color-dark-7));
  transition: border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease;
}
.modeCard:hover { border-color: light-dark(var(--mantine-color-gray-5), var(--mantine-color-dark-2)); }
.modeCard[data-checked] {
  border-color: var(--mantine-primary-color-filled);
  background-color: var(--mantine-primary-color-light);
  box-shadow: var(--mantine-shadow-xs);
}

.saveBar { position: sticky; bottom: var(--mantine-spacing-md); z-index: 5; }

.countPill {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  min-width: 20px; height: 18px; padding: 0 6px; border-radius: 9px;
  font-size: 11px; font-weight: 700; line-height: 1;
  background-color: light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-4));
}
```

---

## 9. Rules for Claude Code

1. Use Mantine components for everything; reach for a CSS module only for hover/focus/sticky behavior Mantine props can't express.
2. Never hard-code colors in TSX — use Mantine color names, `var(--mantine-…)`, or `light-dark()`.
3. Every page: `PageHeader` first, data via TanStack Query rendered through `QueryState`, errors through `ErrorAlert`/`notifyError`.
4. Every icon-only control gets `Tooltip` + `aria-label`. Every status indicator is a `Badge` from a shared badges file with `BADGE_NO_SHRINK`.
5. Icons only from `@tabler/icons-react`, at the sizes in §7.
6. Forms follow §5 (Mantine form, uncontrolled, Stack gap md, Cancel/primary footer).
7. Verify in both light and dark mode before considering UI work done.
