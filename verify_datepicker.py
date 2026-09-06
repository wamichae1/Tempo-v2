"""Verify date-picker popover + focus styling in the event detail panel."""

import re

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"


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

        # Create an event via the New event button, opening the detail panel
        page.get_by_role("button", name="New event").click()
        page.wait_for_timeout(500)
        title = page.locator("input[placeholder='Title']")
        assert title.count() == 1, "detail panel did not open"
        title.fill("Picker Test")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)

        # --- Date picker ---
        start_trigger = page.get_by_role("button", name="Start date")
        assert start_trigger.count() == 1, "start date trigger missing"
        before = start_trigger.inner_text()
        print("start date trigger label:", before)
        start_trigger.click()
        page.wait_for_timeout(400)
        cal = page.locator("[data-slot='popover-content']").last
        assert cal.is_visible(), "popover did not open"
        selected = cal.locator("button[aria-pressed='true']")
        assert selected.count() == 1, "no selected day highlighted"
        print("selected day in picker:", selected.inner_text())

        # Month navigation
        header = cal.locator("span", has_text="202").first.inner_text()
        print("month header:", header)
        cal.get_by_role("button", name="Next month").click()
        page.wait_for_timeout(200)
        header2 = cal.locator("span", has_text="202").first.inner_text()
        print("after next month:", header2)
        assert header != header2, "month navigation failed"
        cal.get_by_role("button", name="Previous month").click()
        page.wait_for_timeout(200)

        # Pick a nearby day while keeping the event in the currently visible
        # week; otherwise changing timed -> all-day can remount the event offscreen.
        day_num = int(selected.inner_text())
        target_day = day_num - 2 if day_num > 2 else day_num + 2
        cal.locator("button.text-foreground").filter(
            has_text=re.compile(rf"^{target_day}$")
        ).first.click()
        page.wait_for_timeout(400)
        after = start_trigger.inner_text()
        print("start date after selection:", after)
        assert after != before, "trigger label did not update"

        # --- Focus styling: title input must not turn black in light mode ---
        title.focus()
        page.wait_for_timeout(200)
        bg = title.evaluate("el => getComputedStyle(el).backgroundColor")
        border = title.evaluate("el => getComputedStyle(el).borderTopColor")
        color = title.evaluate("el => getComputedStyle(el).color")
        print("focused title bg/border/color:", bg, border, color)
        assert bg != "rgb(36, 36, 36)", "title focus bg still #242424"

        # Keyboard: focus trigger, open with Enter, Escape closes
        start_trigger.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        assert page.locator("[data-slot='popover-content']").count() == 2
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        assert page.locator("[data-slot='popover-content']").count() == 1
        print("keyboard open/close: OK")
        print("title still present:", page.locator("input[placeholder='Title']").count())
        print("start trigger present:", start_trigger.count())

        # --- All-day end date picker ---
        panel = page.locator("[data-slot='popover-content']").first
        allday = panel.get_by_text("All-day", exact=True)
        print("all-day texts:", allday.count())
        allday.first.click()
        page.wait_for_timeout(400)
        print("switches:", page.locator("[data-slot='switch']").count())
        all_day_switch = page.get_by_role("switch").first
        if all_day_switch.get_attribute("data-state") != "checked":
            all_day_switch.click()
        page.wait_for_timeout(400)
        end_trigger = page.get_by_role("button", name="End date")
        # Moving a timed event into the all-day row may remount/close its
        # detail popover. Reopen the same event before checking the end picker.
        if end_trigger.count() == 0:
            page.get_by_text("Picker Test", exact=True).first.click()
            page.wait_for_timeout(400)
        end_trigger.wait_for(state="visible")
        assert end_trigger.count() == 1, "end date trigger missing for all-day"
        print("end date trigger label:", end_trigger.inner_text())
        end_trigger.click()
        page.wait_for_timeout(400)
        end_cal = page.locator("[data-slot='popover-content']").last
        assert end_cal.is_visible()
        sel = end_cal.locator("button[aria-pressed='true']")
        assert sel.count() == 1
        day = int(sel.inner_text())
        end_cal.get_by_role(
            "button", name=str(day + 2), exact=True
        ).first.click()
        page.wait_for_timeout(400)
        print("end date after selection:", end_trigger.inner_text())
        # Toggle all-day back off; timed event still intact
        page.get_by_role("switch").click()
        page.wait_for_timeout(400)

        # Dark theme sanity
        page.evaluate("document.documentElement.classList.add('dark')")
        page.wait_for_timeout(200)
        bg_dark = title.evaluate(
            "el => { el.focus(); return getComputedStyle(el).backgroundColor }"
        )
        print("dark focused title bg:", bg_dark)

        print("page errors:", errors)
        assert not errors
        browser.close()
        print("ALL DATEPICKER CHECKS PASSED")


if __name__ == "__main__":
    main()
