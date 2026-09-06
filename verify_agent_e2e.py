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

MOCK_OPENAI = """
(() => {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.__tempoOpenAiRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.includes("api.openai.com/v1/responses")) {
      return originalFetch(input, init);
    }
    const body = JSON.parse(String(init.body || "{}"));
    globalThis.__tempoOpenAiRequests.push(body);
    const authorization = new Headers(init.headers || {}).get("authorization") || "";
    if (authorization.includes("sk-invalid")) {
      return new Response(JSON.stringify({
        error: {
          message: "Invalid API key",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (JSON.stringify(body.input || "").includes("Cancel this request")) {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response("", {
          status: 500,
          headers: { "Content-Type": "text/event-stream" },
        })), 5000);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    }
    const isContinuation = Array.isArray(body.input) &&
      body.input.some((item) => item.type === "function_call_output");
    const response = isContinuation ? {
      id: "resp_final",
      object: "response",
      created_at: 1788624000,
      status: "completed",
      error: null,
      incomplete_details: null,
      instructions: body.instructions,
      max_output_tokens: null,
      model: body.model,
      output: [{
        id: "msg_final",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{
          type: "output_text",
          text: "Created E2E Study Session for tomorrow at 2:00 PM.",
          annotations: [],
          logprobs: [],
        }],
      }],
      output_text: "Created E2E Study Session for tomorrow at 2:00 PM.",
      parallel_tool_calls: false,
      previous_response_id: null,
      reasoning: { effort: null, summary: null },
      store: false,
      temperature: 1,
      text: { format: { type: "text" } },
      tool_choice: "auto",
      tools: body.tools || [],
      top_p: 1,
      truncation: "disabled",
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      metadata: {},
    } : {
      id: "resp_tool",
      object: "response",
      created_at: 1788624000,
      status: "completed",
      error: null,
      incomplete_details: null,
      instructions: body.instructions,
      max_output_tokens: null,
      model: body.model,
      output: [{
        id: "fc_create",
        type: "function_call",
        status: "completed",
        call_id: "call_create",
        name: "tempo_create_event",
        arguments: JSON.stringify({
          title: "E2E Study Session",
          start: "2026-09-06T14:00:00-04:00",
          end: "2026-09-06T15:00:00-04:00",
        }),
      }],
      output_text: "",
      parallel_tool_calls: false,
      previous_response_id: null,
      reasoning: { effort: null, summary: null },
      store: false,
      temperature: 1,
      text: { format: { type: "text" } },
      tool_choice: "auto",
      tools: body.tools || [],
      top_p: 1,
      truncation: "disabled",
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      metadata: {},
    };
    const events = [];
    if (isContinuation) {
      events.push({
        type: "response.output_text.delta",
        sequence_number: 1,
        item_id: "msg_final",
        output_index: 0,
        content_index: 0,
        delta: response.output_text,
        logprobs: [],
      });
    }
    events.push({
      type: "response.completed",
      sequence_number: 2,
      response,
    });
    const payload = events.map((event) =>
      "data: " + JSON.stringify(event) + "\\n\\n"
    ).join("") + "data: [DONE]\\n\\n";
    return new Response(payload, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
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
        context.add_init_script(MOCK_OPENAI)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.clear(); localStorage.setItem('tempo:intro-seen','1'); localStorage.setItem('tempo:calendars', JSON.stringify([{id:'cal-personal',name:'Personal',color:'purple',visible:true},{id:'cal-university',name:'University',color:'green',visible:true},{id:'cal-work',name:'Work',color:'blue',visible:true}])); localStorage.setItem('tempo:events','[]')")
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

        # 2. Built-in Chat: configuration, direct provider request, shared
        # tool execution, transcript persistence, and key privacy.
        chat_tab = page.get_by_role("tab", name="Chat")
        webmcp_tab = page.get_by_role("tab", name="WebMCP")
        check("chat default mode", chat_tab.get_attribute("aria-selected") == "true")
        check("chat empty state", page.locator("text=Chat with Tempo").is_visible())
        composer = page.get_by_role("textbox", name="Message Tempo Agent")
        send = page.get_by_role("button", name="Send message")
        check("chat composer visible", composer.is_visible())
        check("blank send disabled", send.is_disabled())
        composer.fill("Schedule a study session tomorrow at 2 PM")
        composer.press("Enter")
        page.wait_for_timeout(200)
        check("missing key opens settings",
              page.get_by_role("alertdialog", name="Tempo Agent settings").is_visible())
        check("missing key preserves draft",
              composer.input_value() == "Schedule a study session tomorrow at 2 PM")
        page.get_by_role("textbox", name="OpenAI API key").fill("sk-invalid")
        page.get_by_role("button", name="Done").click()
        composer.press("Enter")
        page.wait_for_selector("text=OpenAI rejected this API key")
        check("invalid key error is useful",
              page.locator("text=OpenAI rejected this API key").is_visible())
        api_key = "sk-e2e-secret-do-not-persist"
        page.get_by_role("button", name="Tempo Agent settings").click()
        page.get_by_role("textbox", name="OpenAI API key").fill(api_key)
        page.get_by_role("button", name="Done").click()
        composer.fill("Schedule a study session tomorrow at 2 PM")
        composer.press("Enter")
        page.wait_for_selector("text=Created E2E Study Session", timeout=10000)
        check("chat tool executed",
              page.locator("[aria-label='Tool tempo_create_event succeeded']").count() == 1)
        check("assistant response renders",
              page.locator("article[aria-label='Tempo Agent message']")
              .filter(has_text="Created E2E Study Session").is_visible())
        saved_events = page.evaluate("JSON.parse(localStorage.getItem('tempo:events'))")
        check("chat mutation uses calendar store",
              any(e["title"] == "E2E Study Session" for e in saved_events))
        stored_chat_raw = page.evaluate("localStorage.getItem('tempo:agent-chat:v2')")
        stored_settings_raw = page.evaluate("localStorage.getItem('tempo:ai-settings:v1')")
        check("chat v2 persisted",
              json.loads(stored_chat_raw)["version"] == 2)
        check("api key excluded from transcript", api_key not in stored_chat_raw)
        check("api key excluded from settings", api_key not in stored_settings_raw)
        check("memory key not persisted",
              page.evaluate("localStorage.getItem('tempo:ai-key:openai:v1')") is None)
        requests = page.evaluate("globalThis.__tempoOpenAiRequests")
        check("provider received all 14 shared tools",
              len(requests) == 3 and len(requests[1].get("tools", [])) == 14)

        page.reload(wait_until="networkidle")
        page.wait_for_timeout(500)
        check("chat mode persists", chat_tab.get_attribute("aria-selected") == "true")
        check("chat transcript reloads",
              page.get_by_text(
                  "Schedule a study session tomorrow at 2 PM", exact=True
              ).first.is_visible())
        check("assistant message persists",
              page.locator("article[aria-label='Tempo Agent message']")
              .filter(has_text="Created E2E Study Session").is_visible())
        check("memory key cleared on reload",
              page.locator("text=Not configured").is_visible())

        page.get_by_role("button", name="Tempo Agent settings").click()
        page.get_by_role("textbox", name="OpenAI API key").fill(api_key)
        page.get_by_role("switch", name="Remember API key on this device").click()
        page.get_by_role("button", name="Done").click()
        check("opt-in key persistence",
              page.evaluate("localStorage.getItem('tempo:ai-key:openai:v1')") == api_key)
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(500)
        check("remembered key restores configuration",
              page.locator("text=Not configured").count() == 0)
        page.get_by_role("button", name="Tempo Agent settings").click()
        check("remembered key loads",
              page.get_by_role("textbox", name="OpenAI API key").input_value() == api_key)
        page.get_by_role("button", name="Clear key").click()
        page.get_by_role("button", name="Done").click()
        check("clear key removes persisted credential",
              page.evaluate("localStorage.getItem('tempo:ai-key:openai:v1')") is None)

        page.get_by_role("button", name="Tempo Agent settings").click()
        page.get_by_role("textbox", name="OpenAI API key").fill("sk-cancel-test")
        page.get_by_role("button", name="Done").click()
        composer.fill("Cancel this request")
        composer.press("Enter")
        stop = page.get_by_role("button", name="Stop response")
        stop.wait_for(state="visible")
        stop.click()
        page.wait_for_selector("text=Cancelled.")
        check("chat cancellation", page.locator("text=Cancelled.").is_visible())

        page.get_by_role("button", name="Clear", exact=True).click()
        page.get_by_role("button", name="Clear conversation").click()
        page.wait_for_timeout(200)
        check("clear restores empty state", page.locator("text=Chat with Tempo").is_visible())
        check("clear removes storage",
              page.evaluate("localStorage.getItem('tempo:agent-chat:v2')") is None)

        # Inspector retains the existing presentation and behavior.
        webmcp_tab.click()
        page.wait_for_timeout(200)
        create_row = page.locator("button:has-text('tempo_create_event')").first
        check("panel status available", page.locator("text=Available").count() >= 1)
        check("panel tool count copy", page.locator("text=14 tools available").count() >= 1)
        for section in ("READ", "WRITE", "HISTORY"):
            check(f"panel section {section}", page.locator(f"section[aria-label='{section} tools']").count() == 1)
        missing = [n for n in expected if page.locator(f"text={n}").count() == 0]
        check("panel lists all 14 tools", not missing, f"missing: {missing}")
        check("panel shows descriptions", page.locator("text=Create a new calendar event").count() >= 1)
        # Expand create event -> parameter details
        create_row.click()
        page.wait_for_timeout(200)
        check("expand shows params", page.locator("text=Parameters").count() >= 1
              and page.locator("text=required").count() >= 1)
        # Confirmation-protected badge present for delete tools
        check("confirm badges", page.locator("text=CONFIRM").count() >= 2)
        # Confirmation toggle still present and wired
        toggle = page.locator("input[type=checkbox]")
        check("confirm toggle present", toggle.count() >= 1)
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(500)
        check("webmcp mode persists",
              page.get_by_role("tab", name="WebMCP")
              .get_attribute("aria-selected") == "true")

        # 2b. Without WebMCP: compact empty state, no tool list
        ctx2 = browser.new_context(viewport={"width": 1400, "height": 900})
        page2 = ctx2.new_page()
        page2.goto(BASE, wait_until="networkidle")
        page2.evaluate("localStorage.setItem('tempo:intro-seen','1')")
        page2.reload(wait_until="networkidle")
        page2.wait_for_timeout(500)
        page2.get_by_role("tab", name="WebMCP").click()
        page2.wait_for_timeout(200)
        check("unsupported: empty state", page2.locator("text=WebMCP").count() >= 1
              and page2.locator("text=compatible agent/browser environment").count() >= 1)
        check("unsupported: no tool list", page2.locator("text=tempo_create_event").count() == 0)
        ctx2.close()

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

        # 11. Confirmation dialog: decline then approve. Registration and the
        # global confirmation flow remain active while Chat is selected.
        page.get_by_role("tab", name="Chat").click()
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

        evaljs2 = "([n, i]) => { window.__delResult2 = document.modelContext.executeTool(n, i); }"
        page.evaluate(evaljs2, ["tempo_delete_event", {"eventId": event_id}])
        page.wait_for_selector("text=The agent wants to delete")
        page.get_by_role("button", name="Delete", exact=True).click()
        page.wait_for_timeout(300)
        res = page.evaluate("window.__delResult2.then((r) => JSON.parse(r))")
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
        page.get_by_role("button", name="Delete calendar", exact=True).click()
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
