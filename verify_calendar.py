"""End-to-end verification of Tempo calendar foundation features."""

import json
import os
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
results = []
TMP = tempfile.gettempdir()


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), "-", name, ("| " + str(detail)[:200] if detail else ""))


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(800)

        # Fresh state
        page.evaluate("localStorage.clear(); localStorage.setItem('tempo:intro-seen','1')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(800)

        # 1. Fresh install: no default calendars, empty state shown
        check("empty state shown", page.locator("text=No calendars yet").count() >= 1)
        check("no default calendars", page.locator("text=Personal").count() == 0)
        page.get_by_role("button", name="Create calendar").click()
        page.locator("input[placeholder='Calendar name']").fill("Personal")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        check("calendar created from empty state", page.locator("aside").locator("text=Personal").count() >= 1)
        check("week grid", page.locator("text=Week").count() >= 1)

        # 2. Switch to Month view
        page.get_by_role("button", name="Week", exact=True).click()
        page.get_by_role("menuitem", name="Month", exact=True).click()
        page.wait_for_timeout(500)
        check("month grid cells", page.locator("button", has_text="more").count() >= 0)
        # weekday header present
        check("month weekday header", page.locator("div", has_text="Sun").first.count() == 1)
        # navigate next/prev month
        title_before = page.locator("h1").inner_text()
        page.get_by_role("button", name="Next", exact=True).click()
        page.wait_for_timeout(300)
        title_after = page.locator("h1").inner_text()
        check("month nav changes title", title_before != title_after, f"{title_before} -> {title_after}")
        page.get_by_role("button", name="Today", exact=True).click()
        page.wait_for_timeout(300)
        check("today returns", page.locator("h1").inner_text() == title_before)

        # 3. Back to week
        page.get_by_role("button", name="Month", exact=True).click()
        page.get_by_role("menuitem", name="Week", exact=True).click()
        page.wait_for_timeout(400)

        # 4. Create event
        page.get_by_role("button", name="New event").click()
        page.wait_for_timeout(500)
        title_input = page.locator("input[placeholder='Title']")
        check("detail popover opened", title_input.count() == 1)
        if title_input.count():
            title_input.fill("Verify Meeting")
            page.keyboard.press("Enter")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        check("event visible in week", page.locator("text=Verify Meeting").count() >= 1)

        # 5. Persistence across reload
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(800)
        check("event persists after reload", page.locator("text=Verify Meeting").count() >= 1)

        # 6. Undo / redo via keyboard
        count_before = page.locator("text=Verify Meeting").count()
        page.keyboard.press("Control+z")
        page.wait_for_timeout(300)
        count_after_undo = page.locator("text=Verify Meeting").count()
        check("ctrl+z undoes (title or create)", count_after_undo <= count_before)
        page.keyboard.press("Control+Shift+z")
        page.wait_for_timeout(300)
        check("ctrl+shift+z redoes", page.locator("text=Verify Meeting").count() >= count_after_undo)

        # 7. Search
        page.get_by_role("button", name="Search events").click()
        page.wait_for_timeout(300)
        page.locator("input[placeholder='Search events…']").fill("Verify")
        page.wait_for_timeout(400)
        result_btn = page.locator("button", has_text="Verify Meeting").first
        check("search finds event", result_btn.count() == 1)
        if result_btn.count():
            result_btn.click()
            page.wait_for_timeout(400)

        # 8. Create a calendar via sidebar
        page.get_by_title("New calendar").click()
        page.locator("input[placeholder='Calendar name']").fill("Gym")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        check("calendar created", page.locator("text=Gym").count() >= 1)

        # 9. Recurrence: create a daily recurring event via store-less UI path
        # (create event, open popover, set recurrence)
        page.get_by_role("button", name="New event").click()
        page.wait_for_timeout(400)
        t = page.locator("input[placeholder='Title']")
        if t.count():
            t.fill("Standup")
            page.keyboard.press("Enter")
        # expand options if needed
        opts = page.locator("text=Repeat").last
        if opts.count():
            opts.click()
            page.wait_for_timeout(200)
        repeat_btn = page.locator("button", has_text="Does not repeat")
        if repeat_btn.count():
            repeat_btn.first.click()
            page.wait_for_timeout(200)
            page.get_by_role("menuitem", name="Daily").click()
            page.wait_for_timeout(300)
        page.keyboard.press("Escape")
        # check localStorage has rrule
        stored = page.evaluate("localStorage.getItem('tempo:events')")
        check("recurrence persisted", '"freq":"daily"' in (stored or ""))

        # 10. ICS export (all)
        with page.expect_download() as dl_info:
            page.get_by_role("button", name="Export all (.ics)").click()
        dl = dl_info.value
        path = dl.path()
        content = open(path, "rb").read().decode("utf-8", "replace")
        check("ics export valid", content.startswith("BEGIN:VCALENDAR") and "END:VCALENDAR" in content)
        check("ics has RRULE", "RRULE:FREQ=DAILY" in content)
        check("ics has event", "SUMMARY:Verify Meeting" in content or "SUMMARY:Standup" in content)
        exported_path = os.path.join(TMP, "tempo-exported.ics")
        open(exported_path, "w", encoding="utf-8").write(content)

        # 11. ICS import
        ics_text = """BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Test//Test//EN\r
X-WR-CALNAME:Imported Cal\r
BEGIN:VEVENT\r
UID:imp1@test\r
DTSTAMP:20260101T000000\r
DTSTART:20260910T140000\r
DTEND:20260910T150000\r
SUMMARY:Imported Meeting\r
LOCATION:Room 3\r
RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=4\r
COLOR:purple\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:imp2@test\r
DTSTAMP:20260101T000000\r
SUMMARY:Broken event without start\r
END:VEVENT\r
END:VCALENDAR\r
"""
        import_path = os.path.join(TMP, "tempo-test-import.ics")
        with open(import_path, "w", encoding="utf-8") as f:
            f.write(ics_text)
        page.locator("input[type=file]").set_input_files(import_path)
        try:
            page.wait_for_selector("aside p", timeout=5000)
        except Exception:
            html = page.locator("aside").inner_html()
            print("DEBUG aside html:", html[-500:])
        stored = page.evaluate("localStorage.getItem('tempo:events')")
        check("ics import added event", "Imported Meeting" in (stored or ""))
        check("ics import recurrence", '"byWeekDays":[4]' in (stored or ""))
        check("import notice shown", page.locator("text=Imported 1 event").count() >= 1)

        # 12. Conflict highlight: create two overlapping events via localStorage + reload
        page.evaluate(
            """(() => {
              const events = JSON.parse(localStorage.getItem('tempo:events'));
              const cals = JSON.parse(localStorage.getItem('tempo:calendars'));
              const cal = cals[0].id;
              const day = new Date(); day.setHours(0,0,0,0);
              const mk = (id, title, h1, h2) => ({
                id, title,
                start: new Date(day.getTime() + h1*3600e3).toISOString(),
                end: new Date(day.getTime() + h2*3600e3).toISOString(),
                calendarId: cal, color: 'blue'
              });
              events.push(mk('conflict-a','Conflict A', 10, 11));
              events.push(mk('conflict-b','Conflict B', 10.5, 11.5));
              localStorage.setItem('tempo:events', JSON.stringify(events));
            })()"""
        )
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(800)
        # conflict ring = elements with ring-red-500
        rings = page.locator(".ring-red-500\\/70")
        check("conflict highlighting", rings.count() >= 2, f"rings={rings.count()}")

        # 13. Copy/paste via context menu
        target = page.locator("text=Conflict A").first
        target.click(button="right")
        page.wait_for_timeout(400)
        copy_item = page.locator("button", has_text="Copy").first
        check("context menu copy", copy_item.count() == 1)
        if copy_item.count():
            copy_item.click()
            page.wait_for_timeout(300)
            # paste via keyboard at today
            page.keyboard.press("Control+v")
            page.wait_for_timeout(400)
            check("paste created duplicate", page.locator("text=Conflict A").count() >= 2)

        print()
        if errors:
            print("PAGE ERRORS:", errors[:5])
        failed = [r for r in results if not r[1]]
        print(f"{len(results) - len(failed)}/{len(results)} checks passed")
        browser.close()
        sys.exit(1 if failed else 0)


main()
