"""End-to-end verification of Tempo WebMCP agent integration.

Chromium here has no native WebMCP, so a mock document.modelContext is
installed via add_init_script before page load. It stores registered tools
and exposes executeTool(name, input) matching the spec's semantics closely
enough to exercise Tempo's tool layer end to end.
"""

import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
results = []

MOCK_WEBMCP = """
(() => {
  const tools = new Map();
  const controllerByName = new Map();
  document.modelContext = {
    async registerTool(tool, options = {}) {
      if (!tool.name || tools.has(tool.name)) {
        throw new Error("duplicate or invalid tool name");
      }
      tools.set(tool.name, tool);
      if (options.signal) {
        options.signal.addEventListener("abort", () => tools.delete(tool.name));
      }
    },
    async getTools() {
      return [...tools.values()].map((t) => ({
        name: t.name,
        description: t.description,
      }));
    },
    async executeTool(name, input = {}) {
      const tool = tools.get(name);
      if (!tool) throw new Error("NotFoundError: " + name);
      const result = await tool.execute(input, {
        signal: new AbortController().signal,
      });
      return JSON.stringify(result);
    },
  };
})();
"""


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), "-", name, ("| " + str(detail)[:200] if detail else ""))


def call_tool(page, name, input_obj=None):
    raw = page.evaluate(
        "([n, i]) => document.modelContext.executeTool(n, i)",
        [name, input_obj or {}],
    )
    return json.loads(raw)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        context.add_init_script(MOCK_WEBMCP)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.clear()")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(800)

        # 1. Tools registered
        tools = page.evaluate("document.modelContext.getTools()")
        names = {t["name"] for t in tools}
        expected = {
            "tempo_list_calendars", "tempo_list_events", "tempo_get_event",
            "tempo_find_conflicts", "tempo_create_event", "tempo_update_event",
            "tempo_move_event", "tempo_duplicate_event", "tempo_delete_event",
            "tempo_create_calendar", "tempo_update_calendar",
            "tempo_delete_calendar", "tempo_undo", "tempo_redo",
        }
        check("tools registered", expected.issubset(names), f"{len(names)} tools: missing {expected - names}")

        # 2. Agent panel shows supported + tool list
        page.get_by_role("button", name="Agent Link").click()
        page.wait_for_timeout(300)
        check("panel shows tools", page.locator("text=tempo_create_event").count() >= 1)
        page.keyboard.press("Escape")

        # 3. List calendars
        res = call_tool(page, "tempo_list_calendars")
        check("list_calendars", res.get("ok") and len(res["calendars"]) == 3,
              json.dumps([c["name"] for c in res.get("calendars", [])]))
        cal_id = res["calendars"][0]["id"]

        # 4. Create event via tool, verify in list + in DOM
        res = call_tool(page, "tempo_create_event", {
            "title": "Agent Sync", "start": "2026-09-02T14:00:00",
            "end": "2026-09-02T15:00:00", "calendarId": cal_id,
        })
        check("create_event", res.get("ok") and res["event"]["title"] == "Agent Sync", json.dumps(res)[:150])
        event_id = res["event"]["id"]
        page.wait_for_timeout(300)
        saved = page.evaluate("JSON.parse(localStorage.getItem('tempo:events'))")
        check("create persisted", any(e["id"] == event_id for e in saved))

        # 5. Create validation errors
        res = call_tool(page, "tempo_create_event", {"title": "", "start": "2026-09-02T14:00:00", "end": "2026-09-02T15:00:00"})
        check("create rejects empty title", res.get("ok") is False)
        res = call_tool(page, "tempo_create_event", {"title": "X", "start": "bad", "end": "2026-09-02T15:00:00"})
        check("create rejects bad date", res.get("ok") is False)
        res = call_tool(page, "tempo_create_event", {"title": "X", "start": "2026-09-02T15:00:00", "end": "2026-09-02T14:00:00"})
        check("create rejects end<=start", res.get("ok") is False)

        # 6. list_events finds it in range with query filter
        res = call_tool(page, "tempo_list_events", {"start": "2026-09-01T00:00:00", "end": "2026-09-03T00:00:00", "query": "agent"})
        check("list_events query", res.get("ok") and any(e["id"] == event_id for e in res["events"]))

        # 7. get_event
        res = call_tool(page, "tempo_get_event", {"eventId": event_id})
        check("get_event", res.get("ok") and res["event"]["title"] == "Agent Sync")
        res = call_tool(page, "tempo_get_event", {"eventId": "nope"})
        check("get_event missing", res.get("ok") is False)

        # 8. Recurring event + update (series-only) + conflicts
        res = call_tool(page, "tempo_create_event", {
            "title": "Standup", "start": "2026-09-02T14:30:00",
            "end": "2026-09-02T15:00:00",
            "recurrence": {"freq": "weekly", "byWeekDays": [3]},
        })
        check("create recurring", res.get("ok") and res["event"]["rrule"]["freq"] == "weekly")
        standup_id = res["event"]["id"]
        res = call_tool(page, "tempo_list_events", {"start": "2026-09-07T00:00:00", "end": "2026-09-13T00:00:00", "query": "standup"})
        check("recurrence expands", res.get("ok") and len(res["events"]) >= 1, json.dumps(res)[:150])

        res = call_tool(page, "tempo_find_conflicts", {"start": "2026-09-02T00:00:00", "end": "2026-09-03T00:00:00"})
        titles = {e["title"] for e in res.get("conflicts", [])}
        check("find_conflicts", res.get("ok") and {"Agent Sync", "Standup"} <= titles, str(titles))

        # 9. update_event + move_event
        res = call_tool(page, "tempo_update_event", {"eventId": event_id, "patch": {"title": "Agent Sync v2", "location": "Room 1"}})
        check("update_event", res.get("ok") and res["event"]["title"] == "Agent Sync v2")
        res = call_tool(page, "tempo_move_event", {"eventId": standup_id, "start": "2026-09-02T16:00:00", "end": "2026-09-02T16:30:00"})
        moved_start = page.evaluate("(r) => new Date(r).toLocaleString()", res["event"]["start"]) if res.get("ok") else ""
        check("move_event", res.get("ok") and res["event"]["start"] != res["event"]["end"]
              and "16:00" in page.evaluate("(r) => new Date(r).toTimeString()", res["event"]["start"]), json.dumps(res)[:150])

        # 10. duplicate_event with newStart
        res = call_tool(page, "tempo_duplicate_event", {"eventId": event_id, "newStart": "2026-09-03T10:00:00"})
        check("duplicate_event", res.get("ok") and res["event"]["id"] != event_id
              and "10:00" in page.evaluate("(r) => new Date(r).toTimeString()", res["event"]["start"]))

        # 11. Confirmation dialog: decline then approve
        evaljs = "([n, i]) => { window.__delResult = document.modelContext.executeTool(n, i); }"
        page.evaluate(evaljs, ["tempo_delete_event", {"eventId": event_id}])
        page.wait_for_selector("text=The agent wants to delete")
        check("delete confirm dialog", True)
        page.get_by_role("button", name="Cancel").click()
        page.wait_for_timeout(300)
        res = page.evaluate("window.__delResult.then((r) => JSON.parse(r))")
        check("delete declined", res.get("ok") is False)
        res = call_tool(page, "tempo_get_event", {"eventId": event_id})
        check("event survives decline", res.get("ok"))

        page.evaluate(evaljs, ["tempo_delete_event", {"eventId": event_id}])
        page.wait_for_selector("text=The agent wants to delete")
        page.get_by_role("button", name="Delete", exact=True).click()
        page.wait_for_timeout(300)
        res = page.evaluate("window.__delResult.then((r) => JSON.parse(r))")
        check("delete approved", res.get("ok") is True)
        res = call_tool(page, "tempo_get_event", {"eventId": event_id})
        check("event deleted", res.get("ok") is False)

        # 12. undo/redo via tools
        page.wait_for_timeout(300)  # let React flush the delete commit
        res = call_tool(page, "tempo_undo")
        check("undo", res.get("ok"))
        page.wait_for_timeout(300)  # let React flush the undo commit
        res = call_tool(page, "tempo_get_event", {"eventId": event_id})
        check("undo restores event", res.get("ok"))

        # 13. Calendar tools
        res = call_tool(page, "tempo_create_calendar", {"name": "Agent Cal", "color": "green"})
        check("create_calendar", res.get("ok") and res["calendar"]["color"] == "green")
        new_cal = res["calendar"]["id"]
        res = call_tool(page, "tempo_update_calendar", {"calendarId": new_cal, "visible": False, "name": "Agent Cal 2"})
        check("update_calendar", res.get("ok") and res["calendar"]["visible"] is False)

        page.evaluate(evaljs, ["tempo_delete_calendar", {"calendarId": new_cal}])
        page.wait_for_selector("text=The agent wants to delete the calendar")
        page.get_by_role("button", name="Delete calendar").click()
        page.wait_for_timeout(300)
        res = page.evaluate("window.__delResult.then((r) => JSON.parse(r))")
        check("delete_calendar", res.get("ok"))

        # 14. State survives reload
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(800)
        res = call_tool(page, "tempo_get_event", {"eventId": event_id})
        check("state survives reload", res.get("ok"))
        tools2 = page.evaluate("document.modelContext.getTools()")
        check("tools re-registered after reload", len(tools2) >= 14)

        check("no page errors", not errors, "; ".join(errors)[:200])
        browser.close()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
