# Tempo

A local-first calendar workspace built around [WebMCP](https://webmachinelearning.github.io/webmcp/) — AI agents can operate your calendar through standardized WebMCP tools while you keep a full, fast calendar UI.

<!-- TODO: add hero screenshot / demo GIF -->
<!-- ![Tempo](docs/hero.png) -->

## Why Tempo

Most calendar apps treat AI as a sidebar chatbot. Tempo treats it as a first-class client: every calendar operation is exposed as a typed WebMCP tool that runs against the same calendar store the UI uses. An agent reads, schedules, moves, and deletes events exactly the way a human would — with the same persistence, undo history, and confirmation guardrails. No backend, no account, no sync service required.

## Build Process

The calendar structure is from [calendarcn](https://github.com/vmnog/calendarcn) by vmnog, which is a open source React calendar component. By taking the key basic features of the calendar I basically made a working standard calendar tool. Once calendarcn was implemented into Tempo, state management taken out of individual components so the agent would eventually be able to access the tools. A few additional tools added include the undo/redo feature, conflict detection which checks an event against other events instead of the full calendar and `localStorage` persistence so even locally the users data is saved on the browser. Other features include ICS import and export to make this usable, and some other smaller features such as choosing colors for different calendars.

With the calendar working, I created WebMCP tools using the `document.modelContext`, so that an agent can perform actions on the calendar. This method allows for a user or an agent to use the exact same code when doing tasks, allowing the agent to complete tasks way more efficiently and accuractly. Confirmation-protected operations such as event pushing and deleting events or calendars cannot run without approval when confirmations are enabled. The tools are listed on the Tempo Agent WebMCP panel.

The newest change is relating to BYO API Key, which is relatively common nowadays. Throughout the developement of this project, ai was used. Providers such as OpenRouter, Groq, and Google Gemini offer practical low-cost or free-plan access to supported models. I like how this project won't cost me or the user any money to run. Since Tempo has no backend, requests go straight from the browser to your AI provider. This currently means that OpenCode and NVIDIA NIM remain unavailable because they do not allow the browser access Tempo's static deployment requires.



## Features

- Month and week views, resizable layout
- Create/edit/delete events with a full detail panel
- Drag and resize events on the grid (works for all-day events too)
- Recurring events: daily/weekly/monthly, with interval, weekday, until/count
- Search across titles, descriptions, locations
- Multiple calendars, each with its own color and visibility toggle
- ICS import/export
- Duplicate/copy/paste via context menu
- Undo/redo for every mutation
- Conflict detection for overlapping events
- Dark/light themes


## Tempo Agent

The right-side Tempo Agent panel is the home for two related experiences:

- **Chat** connects directly from the browser to the selected AI provider with
  the user's own API key. It streams text and uses the same 17 Tempo tools as
  WebMCP.
- **WebMCP** is the existing inspector for the tools exposed to compatible
  external agents.

### Configure Chat

1. Open **Tempo Agent → Chat**.
2. Open the settings dialog.
3. Choose OpenAI, OpenRouter, Groq, or Google Gemini. OpenCode and NVIDIA NIM remain unavailable in the static browser deployment.
4. Add a separate API key for that provider. Leave **Remember API key** off to
   keep it in memory only, or explicitly enable it to store the key unencrypted
   in this browser's `localStorage`.
5. Choose a model from the searchable catalog fetched directly from the
   selected provider.

Tempo has no API proxy or backend. Requests go directly from the browser to
the selected provider. A frontend key cannot be securely hidden from scripts,
browser extensions, developer tools, or someone with access to the browser or
device. NVIDIA NIM remains visible in settings but is currently unavailable in
the static browser-direct deployment because its hosted API does not permit the
required browser access.

## WebMCP

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
- WebMCP support is feature-detected at runtime — Tempo works fine in browsers without `document.modelContext`; the WebMCP view simply reflects availability.
- Tempo Chat uses a provider-neutral runtime with OpenAI, OpenRouter, OpenCode
  Zen, Groq, and Google Gemini implementations. OpenCode remains deferred in
  the browser. WebMCP and built-in Chat execute the same tool objects and handlers.
- Built with and adapted from [CalendarCN](https://github.com/vmnog/calendarcn), an open-source React calendar component. Tempo incorporates and modifies several of its calendar UI elements.

## Tech stack

React 19, TypeScript, Vite, Tailwind v4, Radix/shadcn-style components, date-fns, lucide-react, react-resizable-panels, Geist. No backend. ICS import/export and localStorage persistence are both handled without extra dependencies.

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
npm test         # run agent runtime/state/prompt tests
```

## Code layout

```
src/
  components/calendar/   # CalendarCN-derived calendar UI (month/week views, event items, detail panel)
  components/ui/         # shadcn-style primitives (button, popover, dropdown, switch, dialog)
  features/calendar/     # Calendar store, hooks, header, sidebar, search (the single source of truth)
  features/workspace/    # Resizable three-region workspace layout
  features/agent/        # Tempo Chat, WebMCP inspector/tools, handlers, and confirmations
  features/intro/        # First-run intro experience
  hooks/                 # Drag/resize/scroll/theme hooks
  lib/                   # ICS import/export, recurrence expansion, conflicts, search, event utils
```

The calendar store in `features/calendar` is shared by the UI and the WebMCP agent handlers, so both paths produce identical behavior and history.

## Data & privacy

Tempo is fully local-first:

- **No backend, no account** — the app is a static client.
- **Calendar data is persisted in `localStorage`** in your browser and never leaves the device by itself.
- **AI requests are opt-in** and go directly to the selected provider when the
  user sends a Chat message. Relevant conversation and tool results are
  included; no Tempo backend receives them or the key.
- **Each provider has a separate API key. API keys are memory-only by default.**
  Optional per-provider persistence is explicit and stores the key unencrypted
  in browser `localStorage`, separately from ordinary settings.
- **Model lists are fetched from the selected provider.** Catalog metadata is
  cached only in memory and never contains or stores API keys.
- **Groq model selection is curated.** Tempo currently exposes GPT-OSS 20B and
  GPT-OSS 120B when they are available to the configured Groq project.
- Chat transcripts never persist API keys or provider continuation data.
- **No external calendar integration** (Google, Outlook, etc.) currently exists; ICS import/export is the interchange mechanism.

## Current limitations

- No Google Calendar / Outlook or other account sync. (you can still import/export these through ICS)
- Recurrence editing applies to the **entire series** — no per-occurrence overrides.
- ICS import/export uses floating local date-times; timezone (`VTIMEZONE`/`TZID`) handling is limited.
- Data lives in one browser's `localStorage` — no multi-device sync.

## License

[MIT](LICENSE)
