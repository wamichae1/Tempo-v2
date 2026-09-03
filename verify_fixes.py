"""E2E verification for the post-redesign fixes:

1. Calendar colors: events take their calendar's color; recoloring a
   calendar updates its events and persists.
2. General ICS import asks for a destination calendar; per-calendar import
   still works.
3. Week view defaults to ~6 AM; New Event editor stays usable for events
   near the bottom of the viewport.
4. Delete-calendar confirmation uses the restyled dialog; cancel/delete work.
"""

import json
import os
import tempfile

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
results = []
TMP = tempfile.gettempdir()


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS" if ok else "FAIL"), "-", name, ("| " + str(detail)[:160] if detail else ""))


def event_with_bg(page, title, bg_class):
    """Event tile containing `title` that also contains the given bg class."""
    return (
        page.locator("div[role='button']", has_text=title)
        .filter(has=page.locator(f".{bg_class}"))
        .count()
    )


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.clear(); localStorage.setItem('tempo:intro-seen','1'); localStorage.setItem('tempo:calendars', JSON.stringify([{id:'cal-personal',name:'Personal',color:'purple',visible:true},{id:'cal-university',name:'University',color:'green',visible:true},{id:'cal-work',name:'Work',color:'blue',visible:true}])); localStorage.setItem('tempo:events','[]')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(800)

        # --- Fix 3a: week view defaults to ~6 AM ---------------------------
        scroll = page.locator("div.flex-1.overflow-auto").first
        info = scroll.evaluate(
            "el => ({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight })"
        )
        hour_height = info["height"] / 24
        scrolled_hour = info["top"] / hour_height if hour_height else 0
        check(
            "week view starts around 6 AM",
            4 <= scrolled_hour <= 8,
            f"scrollTop={info['top']:.0f}px -> {scrolled_hour:.1f}h",
        )

        # --- Fix 1: calendar colors drive event colors ---------------------
        page.get_by_role("button", name="New event").click()
        page.wait_for_timeout(500)
        title = page.locator("input[placeholder='Title']")
        title.fill("Color Test")
        page.keyboard.press("Enter")
        page.wait_for_timeout(200)

        # Move the event to Work (blue by default).
        page.locator("button", has_text="Personal").last.click()
        page.wait_for_timeout(300)
        page.get_by_role("menuitem", name="Work").click()
        page.wait_for_timeout(300)
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        check(
            "event uses calendar color (Work=blue)",
            event_with_bg(page, "Color Test", "bg-event-blue-bg") >= 1,
        )

        # Recolor Work to pink via the sidebar dot dropdown.
        work_row = page.locator("aside div.group", has_text="Work").first
        work_row.locator("button[title='Change color']").click()
        page.wait_for_timeout(300)
        swatches = page.locator("[role='menu'] button")
        check("color palette has 11 colors", swatches.count() == 11, str(swatches.count()))
        page.locator("[role='menu'] button.bg-event-pink-border").click()
        page.wait_for_timeout(400)
        check(
            "events update when calendar color changes",
            event_with_bg(page, "Color Test", "bg-event-pink-bg") >= 1,
        )

        page.reload(wait_until="networkidle")
        page.wait_for_timeout(800)
        check(
            "calendar color persists after reload",
            event_with_bg(page, "Color Test", "bg-event-pink-bg") >= 1,
        )

        # --- Fix 2: general ICS import asks for destination ----------------
        ics_text = (
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Test//EN\r\n"
            "BEGIN:VEVENT\r\nUID:f1@test\r\nDTSTAMP:20260101T000000\r\n"
            "DTSTART:20260910T140000\r\nDTEND:20260910T150000\r\n"
            "SUMMARY:Fix Imported\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
        )
        import_path = os.path.join(TMP, "tempo-fix-import.ics")
        with open(import_path, "w", encoding="utf-8") as f:
            f.write(ics_text)

        page.get_by_role("button", name="Import .ics").click()
        page.wait_for_timeout(400)
        dialog = page.locator("[role='alertdialog']")
        check("import destination dialog opens", dialog.count() == 1)
        check(
            "dialog lists calendars",
            dialog.locator("[role='option']").count() >= 3,
            str(dialog.locator("[role='option']").count()),
        )
        check(
            "calendar color dots shown",
            dialog.locator("[role='option'] span.rounded-xs").count() >= 3,
        )
        dialog.locator("[role='option']", has_text="University").click()
        page.wait_for_timeout(300)
        page.locator("input[type=file]").set_input_files(import_path)
        page.wait_for_timeout(500)
        stored_cals = json.loads(page.evaluate("localStorage.getItem('tempo:calendars')"))
        stored_events = json.loads(page.evaluate("localStorage.getItem('tempo:events')"))
        uni_id = next(c["id"] for c in stored_cals if c["name"] == "University")
        imported = [e for e in stored_events if e.get("title") == "Fix Imported"]
        check(
            "import routed to selected calendar",
            len(imported) == 1 and imported[0].get("calendarId") == uni_id,
        )
        check("import notice shown", page.locator("text=Imported 1 event").count() >= 1)

        # Per-calendar import (via row menu) still works.
        page.locator("aside div.group", has_text="Personal").first.hover()
        page.wait_for_timeout(200)
        page.locator("aside div.group", has_text="Personal").first.locator(
            "button:has(svg)"
        ).last.click()
        page.wait_for_timeout(300)
        page.get_by_role("menuitem", name="Import into this calendar").click()
        page.wait_for_timeout(200)
        page.locator("input[type=file]").set_input_files(import_path)
        page.wait_for_timeout(500)
        cals2 = json.loads(page.evaluate("localStorage.getItem('tempo:calendars')"))
        personal_id = next(c["id"] for c in cals2 if c["name"] == "Personal")
        imported2 = [
            e
            for e in json.loads(page.evaluate("localStorage.getItem('tempo:events')"))
            if e.get("title") == "Fix Imported" and e.get("calendarId") == personal_id
        ]
        check("per-calendar import still works", len(imported2) == 1)

        # --- Fix 3b: New Event usable near bottom of viewport --------------
        page.evaluate(
            """(() => {
              const events = JSON.parse(localStorage.getItem('tempo:events'));
              const cals = JSON.parse(localStorage.getItem('tempo:calendars'));
              const day = new Date(); day.setHours(0,0,0,0);
              events.push({
                id: 'late-event', title: 'Late Event',
                start: new Date(day.getTime() + 22*3600e3).toISOString(),
                end: new Date(day.getTime() + 23*3600e3).toISOString(),
                calendarId: cals[0].id,
              });
              localStorage.setItem('tempo:events', JSON.stringify(events));
            })()"""
        )
        page.set_viewport_size({"width": 1400, "height": 700})
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(800)
        # Reset scroll to the top to simulate a late-day open from midnight.
        page.locator("div.flex-1.overflow-auto").first.evaluate("el => el.scrollTop = 0")
        page.locator("div[role='button']", has_text="Late Event").first.click()
        page.wait_for_timeout(700)
        pop = page.locator("[data-radix-popper-content-wrapper]").last
        check(
            "editor opens for late event",
            pop.locator("input[placeholder='Title']").count() == 1,
        )
        box = pop.bounding_box()
        check(
            "editor fully within viewport",
            box is not None and box["y"] >= 0 and box["y"] + box["height"] <= 700,
            str(box),
        )
        # Editor content is reachable: description field can be scrolled to.
        desc = pop.locator("textarea[placeholder='Description']")
        desc.scroll_into_view_if_needed()
        check("editor contents reachable", desc.is_visible())
        desc.fill("reachable")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # --- Fix 4: delete calendar dialog ---------------------------------
        page.get_by_title("New calendar").click()
        page.locator("input[placeholder='Calendar name']").fill("Disposable")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)

        row = page.locator("aside div.group", has_text="Disposable").first
        row.hover()
        row.locator("button:has(svg)").last.click()
        page.wait_for_timeout(300)
        page.get_by_role("menuitem", name="Delete").click()
        page.wait_for_timeout(400)
        dialog = page.locator("[role='alertdialog']")
        check("delete dialog opens", dialog.count() == 1)
        check("delete dialog title", dialog.locator("text=Delete \"Disposable\"?").count() == 1)
        radius = dialog.evaluate("el => getComputedStyle(el).borderTopLeftRadius")
        check("dialog 6px radius", radius == "6px", radius)
        shadow = dialog.evaluate("el => getComputedStyle(el).boxShadow")
        check("dialog has no heavy shadow", shadow == "none", shadow)

        # Cancel keeps the calendar.
        dialog.get_by_role("button", name="Cancel").click()
        page.wait_for_timeout(300)
        check("cancel keeps calendar", page.locator("aside").locator("text=Disposable").count() == 1)

        # Escape also cancels.
        row.hover()
        row.locator("button:has(svg)").last.click()
        page.wait_for_timeout(300)
        page.get_by_role("menuitem", name="Delete").click()
        page.wait_for_timeout(300)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        check("escape cancels dialog", page.locator("[role='alertdialog']").count() == 0)
        check("escape kept calendar", page.locator("aside").locator("text=Disposable").count() == 1)

        # Delete removes it. Dark theme surface check at the same time.
        page.evaluate("document.documentElement.classList.add('dark')")
        row.hover()
        row.locator("button:has(svg)").last.click()
        page.wait_for_timeout(300)
        page.get_by_role("menuitem", name="Delete").click()
        page.wait_for_timeout(400)
        dialog = page.locator("[role='alertdialog']")
        bg = dialog.evaluate("el => getComputedStyle(el).backgroundColor")
        r, g, b = [
            int(x)
            for x in bg.replace("rgba(", "").replace("rgb(", "").rstrip(")").split(",")[:3]
        ]
        check("dialog dark surface in dark mode", r < 80 and g < 80 and b < 80, bg)
        dialog.get_by_role("button", name="Delete").click()
        page.wait_for_timeout(300)
        check("delete removes calendar", page.locator("aside").locator("text=Disposable").count() == 0)

        check("no page errors", not errors, "; ".join(errors[:3]))
        browser.close()

    passed = sum(1 for _, ok in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    raise SystemExit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
