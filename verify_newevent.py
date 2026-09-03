"""Ad-hoc verification for the New Event panel cleanup pass."""

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS" if ok else "FAIL"), "-", name, ("| " + str(detail)[:160] if detail else ""))


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: print("CONSOLE:", m.text) if m.text.startswith("[") else None)
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.clear(); localStorage.setItem('tempo:intro-seen','1'); localStorage.setItem('tempo:calendars', JSON.stringify([{id:'cal-personal',name:'Personal',color:'purple',visible:true},{id:'cal-university',name:'University',color:'green',visible:true},{id:'cal-work',name:'Work',color:'blue',visible:true}])); localStorage.setItem('tempo:events','[]')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(800)

        # Seed an event with a known location via a new event.
        page.get_by_role("button", name="New event").click()
        page.wait_for_timeout(500)
        title = page.locator("input[placeholder='Title']")
        check("new event opens", title.count() == 1)
        title.fill("Lunch")
        page.keyboard.press("Enter")
        page.wait_for_timeout(200)

        panel = page.locator("[data-radix-popper-content-wrapper]").last
        panel_text = panel.inner_text()
        for removed in [
            "Time zone",
            "Participants",
            "Conferencing",
            "AI Meeting",
            "Busy",
            "Default visibility",
            "Reminders",
        ]:
            check(f"removed: {removed}", removed not in panel_text)

        # Location: fill a value so future suggestions exist.
        loc = page.locator("input[placeholder='Location']")
        check("location input editable", loc.count() == 1)
        loc.fill("Cafe Nero")
        page.wait_for_timeout(200)

        # Description
        desc = page.locator("textarea[placeholder='Description']")
        check("description editable", desc.count() == 1 and desc.is_editable())
        desc.fill("Discuss roadmap")
        page.wait_for_timeout(200)

        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

        # Reopen the event -> persistence of description/location
        page.locator("text=Lunch").first.click()
        page.wait_for_timeout(500)
        check(
            "description persists",
            page.locator("textarea[placeholder='Description']").input_value()
            == "Discuss roadmap",
        )
        check(
            "location persists",
            page.locator("input[placeholder='Location']").input_value() == "Cafe Nero",
        )

        # Location autocomplete: new event, type partial -> suggestion appears
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        page.get_by_role("button", name="New event").click()
        page.wait_for_timeout(400)
        loc2 = page.locator("input[placeholder='Location']")
        loc2.fill("Caf")
        page.wait_for_timeout(300)
        sug = page.locator("[role='option']", has_text="Cafe Nero")
        check("location suggestion appears", sug.count() == 1)
        if sug.count():
            sug.first.click()
            page.wait_for_timeout(200)
            check(
                "suggestion applied",
                page.locator("input[placeholder='Location']").input_value() == "Cafe Nero",
            )
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # Recurrence: Custom opens editor immediately, panel stays open
        page.locator("text=Lunch").first.click()
        page.wait_for_timeout(400)
        page.locator("text=Repeat").last.click()  # expand collapsed options row
        page.wait_for_timeout(200)
        page.locator("button", has_text="Does not repeat").click()
        page.wait_for_timeout(300)

        # Repeat dropdown should not be black in light mode
        dd = page.locator("[role='menu']").last
        bg = dd.evaluate("el => getComputedStyle(el).backgroundColor")
        r, g, b = [int(x) for x in bg.replace("rgba(", "").replace("rgb(", "").rstrip(")").split(",")[:3]]
        check("repeat dropdown light bg", r > 200 and g > 200 and b > 200, bg)

        page.get_by_role("menuitem", name="Custom").click()
        page.wait_for_timeout(400)
        check(
            "panel stays open after Custom",
            page.locator("input[placeholder='Title']").count() == 1,
        )
        # Weekday toggle row visible (7 letter buttons)
        day_buttons = page.locator("button", has_text="S").filter(has=page.locator("xpath=self::*[contains(@class,'rounded-full')]"))
        weekday_row = page.locator("button.rounded-full")
        check("custom weekday toggles visible", weekday_row.count() >= 7, str(weekday_row.count()))

        # Ends -> On date -> MiniCalendar popover
        page.locator("button", has_text="Never").click()
        page.wait_for_timeout(200)
        dd2 = page.locator("[role='menu']").last
        bg2 = dd2.evaluate("el => getComputedStyle(el).backgroundColor")
        r, g, b = [int(x) for x in bg2.replace("rgba(", "").replace("rgb(", "").rstrip(")").split(",")[:3]]
        check("ends dropdown light bg", r > 200 and g > 200 and b > 200, bg2)
        page.get_by_role("menuitem", name="On date").click()
        page.wait_for_timeout(300)
        page.locator("button[aria-label='Recurrence end date']").click()
        page.wait_for_timeout(400)
        check(
            "until date uses MiniCalendar",
            page.locator("[data-radix-popper-content-wrapper] button", has_text="15").count() >= 1,
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # Calendar selector light-mode background + selection works
        page.locator("text=Lunch").first.click()
        page.wait_for_timeout(400)
        cal_trigger = page.locator("button", has_text="Personal").last
        cal_trigger.click()
        page.wait_for_timeout(300)
        dd3 = page.locator("[role='menu']").last
        bg3 = dd3.evaluate("el => getComputedStyle(el).backgroundColor")
        r, g, b = [int(x) for x in bg3.replace("rgba(", "").replace("rgb(", "").rstrip(")").split(",")[:3]]
        check("calendar dropdown light bg", r > 200 and g > 200 and b > 200, bg3)
        page.get_by_role("menuitem", name="Work").click()
        page.wait_for_timeout(300)
        check(
            "calendar selection applied",
            page.locator("button", has_text="Work").last.count() >= 1,
        )

        # Dark mode smoke: dropdowns use dark background
        page.evaluate("document.documentElement.classList.add('dark')")
        page.wait_for_timeout(200)
        page.locator("button", has_text="Work").last.click()
        page.wait_for_timeout(300)
        dd4 = page.locator("[role='menu']").last
        bg4 = dd4.evaluate("el => getComputedStyle(el).backgroundColor")
        r, g, b = [int(x) for x in bg4.replace("rgba(", "").replace("rgb(", "").rstrip(")").split(",")[:3]]
        check("calendar dropdown dark bg in dark mode", r < 100 and g < 100 and b < 100, bg4)

        check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

    passed = sum(1 for _, ok in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    if passed != len(results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
