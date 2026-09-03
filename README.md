# Tempo

A local-first calendar workspace built around [WebMCP](https://webmachinelearning.github.io/webmcp/) — AI agents can operate your calendar through standardized WebMCP tools while you keep a full, fast calendar UI.

<!-- TODO: add hero screenshot / demo GIF -->
<!-- ![Tempo](docs/hero.png) -->

## Why Tempo

Most calendar apps treat AI as a sidebar chatbot. Tempo treats it as a first-class client: every calendar operation is exposed as a typed WebMCP tool that runs against the same calendar store the UI uses. An agent reads, schedules, moves, and deletes events exactly the way a human would — with the same persistence, undo history, and confirmation guardrails. No backend, no account, no sync service required.

## Features

- **Month and week views** with a compact, resizable workspace layout
- **Event editing** — create, edit, and delete events with a full detail panel
- **Drag and resize** events directly on the grid, including all-day events
- **All-day events** with a dedicated week-view all-day row
- **Recurring events** — daily/weekly/monthly rules with interval, weekday, until, and count support
- **Search** across event titles, descriptions, and locations
- **Multiple calendars** with per-calendar colors and visibility toggles
- **ICS import/export** (`.ics` files)
- **Duplicate, copy, and paste** events via context menu
- **Undo/redo** across all mutations
- **Conflict detection** for overlapping events
- **LocalStorage persistence** — your data survives reloads, locally
- **Tempo Agent panel** with an Agent Link interface for the WebMCP tools
- **Responsive workspace** with resizable panels and dark/light themes

## WebMCP / Agent Link

Tempo exposes its calendar functionality through [WebMCP](https://webmachinelearning.github.io/webmcp/) (`document.modelContext`), so any WebMCP-aware AI agent can operate the calendar directly in the browser.

### Tools

| Tool | Description |
| --- | --- |
| `tempo_list_calendars` | List calendars with colors, visibility, and event counts |
| `tempo_list_events` | List events in a date range, with optional calendar/query filters |
| `tempo_get_event` | Fetch a single event by id |
| `tempo_find_conflicts` | Find overlapping events in a date range |
| `tempo_create_event` | Create an event (timed or all-day, optionally recurring) |
| `tempo_update_event` | Patch event fields; updates apply to the whole series for recurring events |
| `tempo_move_event` | Move an event to a new start/end time |
| `tempo_duplicate_event` | Duplicate an event, optionally at a new start time |
| `tempo_delete_event` | Delete an event (whole series for recurring); requires user confirmation |
| `tempo_create_calendar` | Create a calendar with a name and color |
| `tempo_update_calendar` | Rename, recolor, or toggle calendar visibility |
| `tempo_delete_calendar` | Delete a calendar and all of its events; requires user confirmation |
| `tempo_undo` | Undo the last calendar mutation |
| `tempo_redo` | Redo the last undone mutation |

### Design notes

- Read operations are exposed as read-only WebMCP tools; mutations go through the same calendar store the UI uses, so agent-made changes keep normal persistence and undo/redo history.
- Destructive actions (deleting events or calendars) can require an in-app user confirmation, with a timeout, before they execute.
- WebMCP support is feature-detected at runtime — Tempo works fine in browsers without `document.modelContext`; the Agent Link panel simply reflects availability.
- Tempo does not bundle its own AI model, and no agent is permanently connected. The in-app Agent Link panel is an interface for inspecting and managing the registered WebMCP tools.

## Tech stack

- **React 19** + **TypeScript** + **Vite**
- **Tailwind CSS v4** (via `@tailwindcss/vite`)
- **shadcn-style components on Radix UI primitives** (`components/ui`)
- Calendar UI derived from **CalendarCN** (`components/calendar`)
- **WebMCP** (`document.modelContext`) for agent tooling
- **date-fns**, **lucide-react**, **react-resizable-panels**, **Geist** typography
- **LocalStorage** persistence, **ICS** import/export (no dependencies needed for either)

## Getting started

Requires Node.js and npm.

```sh
npm install
npm run dev      # start the dev server
```

```sh
npm run build    # type-check and build for production
npm run preview  # preview the production build
npm run lint     # run ESLint
```

## Architecture

```
src/
  components/calendar/   # CalendarCN-derived calendar UI (month/week views, event items, detail panel)
  components/ui/         # shadcn-style primitives (button, popover, dropdown, switch, dialog)
  features/calendar/     # Calendar store, hooks, header, sidebar, search (the single source of truth)
  features/workspace/    # Resizable workspace layout and tabs
  features/assistant/    # Tempo Agent / Agent Link panel
  features/agent/        # WebMCP tool registration, schemas, handlers, confirmation flow
  features/intro/        # First-run intro experience
  hooks/                 # Drag/resize/scroll/theme hooks
  lib/                   # ICS import/export, recurrence expansion, conflicts, search, event utils
```

The calendar store in `features/calendar` is shared by the UI and the WebMCP agent handlers, so both paths produce identical behavior and history.

## Data & privacy

Tempo is fully local-first:

- **No backend, no account** — the app is a static client.
- **Calendar data is persisted in `localStorage`** in your browser and never leaves the device by itself.
- **No external calendar integration** (Google, Outlook, etc.) currently exists; ICS import/export is the interchange mechanism.

## Current limitations

- No Google Calendar / Outlook or other account sync.
- Recurrence editing applies to the **entire series** — no per-occurrence overrides.
- ICS import/export uses floating local date-times; timezone (`VTIMEZONE`/`TZID`) handling is limited.
- Data lives in one browser's `localStorage` — no multi-device sync.

## Design

Tempo follows a Vercel-inspired developer-workspace aesthetic: Geist typography, a compact calendar grid, resizable panels, and first-class dark and light themes.

## OpenAI WebMCP Challenge

Tempo was built for the **OpenAI WebMCP Challenge**. WebMCP isn't an add-on here — the calendar store, tool schemas, confirmation flow, and Agent Link panel were designed together so that agent-driven scheduling is a core part of the product.

## License

[MIT](LICENSE)
