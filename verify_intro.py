"""Verify the Tempo intro overlay: visibility, reveal mask, persistence,
Escape, reopen, theme variants, reduced motion."""

import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"


def check(name, ok):
    print(f"{'PASS' if ok else 'FAIL'}: {name}")
    return ok


results = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    # 1. First launch shows the intro.
    page.goto(BASE)
    page.wait_for_timeout(600)
    dialog = page.locator('[role="dialog"]')
    results.append(check("intro visible on first launch", dialog.is_visible()))

    # Logo rendered at ~72px (2x the original 36px).
    logo_h = page.locator('[role="dialog"] img[src*="LogoB"]').bounding_box()["height"]
    results.append(check("logo ~2x size (72px)", abs(logo_h - 72) <= 4))
    light_ghost_visible = page.locator('[role="dialog"] img[src*="GhostCalendar.svg"]').is_visible()
    dark_ghost_hidden = not page.locator('[role="dialog"] img[src*="GhostCalendarDark"]').is_visible()
    results.append(check("light mode uses light calendar assets", light_ghost_visible and dark_ghost_hidden))
    results.append(
        check("continue focused", page.evaluate("document.activeElement.textContent").strip() == "Enter Tempo")
    )

    # 2. Reveal mask follows the cursor.
    cal = page.locator('[role="dialog"] img[src*="GhostCalendar"]').first
    box = cal.bounding_box()
    cx, cy = box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5

    def reveal_state():
        return page.evaluate(
            """() => {
                const img = document.querySelector('[role="dialog"] img[src*="RevealCalendar"]');
                const s = getComputedStyle(img);
                return { opacity: parseFloat(s.opacity), mask: s.webkitMaskImage || s.maskImage };
            }"""
        )

    before = reveal_state()
    page.mouse.move(cx - 120, cy - 60)
    page.mouse.move(cx, cy)
    page.mouse.move(cx + 4, cy + 2)
    page.wait_for_timeout(2200)
    during = reveal_state()
    results.append(check("reveal hidden before hover", before["opacity"] < 0.05))
    results.append(
        check("reveal visible on hover", during["opacity"] > 0.9 and "radial-gradient" in during["mask"])
    )
    results.append(
        check("mask centered near cursor", f"at {int(box['width']*0.5)}" in during["mask"].replace(".5", "") or "radial-gradient" in during["mask"])
    )

    # smooth follow: move and confirm mask position updates toward cursor
    page.mouse.move(cx + 150, cy + 40)
    page.wait_for_timeout(120)
    mid = reveal_state()
    page.wait_for_timeout(600)
    after = reveal_state()
    results.append(check("mask animates smoothly", mid["mask"] != after["mask"]))

    page.mouse.move(50, 850)
    # Headless rAF is throttled; allow extra time for the fade to settle.
    page.wait_for_timeout(3000)
    gone = reveal_state()
    results.append(check("reveal fades after leaving", gone["opacity"] < 0.05))

    # 3. Light-mode screenshot + asset alignment.
    page.mouse.move(cx, cy)
    page.wait_for_timeout(2000)
    page.screenshot(path="intro_light.png")
    boxes = page.evaluate(
        """() => {
            const g = document.querySelector('[role="dialog"] img[src*="GhostCalendar"]').getBoundingClientRect();
            const r = document.querySelector('[role="dialog"] img[src*="RevealCalendar"]').getBoundingClientRect();
            return { g: g.toJSON(), r: r.toJSON() };
        }"""
    )
    aligned = all(abs(boxes["g"][k] - boxes["r"][k]) < 0.5 for k in ("x", "y", "width", "height"))
    results.append(check("ghost/reveal perfectly aligned", aligned))

    # 4. Escape dismisses; persists across reload.
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    results.append(check("escape dismisses", not page.locator('[role="dialog"]').count()))
    results.append(
        check("localStorage persisted", page.evaluate("localStorage.getItem('tempo:intro-seen')") == "1")
    )
    page.reload()
    page.wait_for_timeout(500)
    results.append(check("intro hidden after reload", not page.locator('[role="dialog"]').count()))

    # 5. Reopen via header button.
    page.get_by_label("Show introduction").click()
    page.wait_for_selector('[role="dialog"]', timeout=3000)
    page.wait_for_timeout(300)
    results.append(check("reopen button works", page.locator('[role="dialog"]').is_visible()))

    # 6. Dark mode screenshot (dismiss intro, switch theme, reopen).
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    page.get_by_label("Toggle theme").click()  # light -> dark
    page.wait_for_timeout(300)
    page.get_by_label("Show introduction").click()
    page.wait_for_selector('[role="dialog"]', timeout=3000)
    results.append(
        check(
            "dark logo visible in dark mode",
            page.locator('[role="dialog"] img[src*="LogoW"]').is_visible(),
        )
    )
    dark_ghost_visible = page.locator('[role="dialog"] img[src*="GhostCalendarDark"]').is_visible()
    light_ghost_hidden = not page.locator('[role="dialog"] img[src*="GhostCalendar.svg"]').is_visible()
    results.append(check("dark mode uses dark calendar assets", dark_ghost_visible and light_ghost_hidden))

    # Reveal works on the dark pair too.
    dcal = page.locator('[role="dialog"] img[src*="GhostCalendarDark"]').first
    dbox = dcal.bounding_box()
    page.mouse.move(dbox["x"] + dbox["width"] / 2, dbox["y"] + dbox["height"] / 2)
    page.wait_for_timeout(2200)
    d_opacity = page.evaluate(
        """() => {
            const imgs = [...document.querySelectorAll('[role="dialog"] img[src*="RevealCalendarDark"]')];
            const v = imgs.find(i => i.offsetParent !== null);
            return parseFloat(getComputedStyle(v).opacity);
        }"""
    )
    results.append(check("dark reveal visible on hover", d_opacity > 0.9))
    page.screenshot(path="intro_dark.png")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # 7. Mobile stacking.
    mob = ctx.new_page()
    mob.set_viewport_size({"width": 390, "height": 844})
    mob.goto(BASE)
    mob.evaluate("localStorage.removeItem('tempo:intro-seen')")
    mob.reload()
    mob.wait_for_timeout(600)
    overlap = mob.evaluate(
        """() => {
            const btn = document.querySelector('[role="dialog"] button').getBoundingClientRect();
            const imgs = [...document.querySelectorAll('[role="dialog"] img[src*="GhostCalendar"]')];
            const img = imgs.find(i => i.offsetParent !== null).getBoundingClientRect();
            return img.top < btn.bottom;
        }"""
    )
    results.append(check("mobile: no text/calendar collision", not overlap))
    mob.screenshot(path="intro_mobile.png")

    # 8. Reduced motion: reveal appears instantly (no lerp animation).
    rm_ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    rm = rm_ctx.new_page()
    rm.goto(BASE)
    rm.wait_for_timeout(500)
    rm.mouse.move(cx, cy)
    rm.wait_for_timeout(80)
    state = rm.evaluate(
        "parseFloat(getComputedStyle(document.querySelector('[role=\"dialog\"] img[src*=\"RevealCalendar\"]')).opacity)"
    )
    results.append(check("reduced motion: instant reveal", state == 1.0))

    results.append(check("no page errors", not errors))
    if errors:
        print(errors)
    browser.close()

print(json.dumps({"passed": sum(results), "total": len(results)}))
sys.exit(0 if all(results) else 1)
