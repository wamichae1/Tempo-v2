"""E2E verification for the workspace shell: panels, tabs, theme."""

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
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.clear(); localStorage.setItem('tempo:intro-seen','1')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(800)

        # 1. Three regions render: sidebar, separators, assistant panel
        check("sidebar visible", page.locator("aside").first.is_visible())
        check("resize separators", page.locator("[data-separator]").count() == 2)
        check("assistant panel visible", page.locator("text=Tempo Agent").count() >= 1)
        check("agent webmcp section", page.locator("text=tempo_create_event").count() >= 1
              or page.locator("text=compatible agent/browser environment").count() >= 1)

        # 2. No workspace tab strip (removed: panels are independently collapsible)
        check("tab strip removed", page.locator("[role='tablist']").count() == 0)
        check("header agent control", page.get_by_role("button", name="Tempo Agent").count() == 1)

        # 3. Ctrl+B collapses the sidebar, again restores it
        page.keyboard.press("Control+b")
        page.wait_for_timeout(400)
        check("ctrl+b hides sidebar", not page.locator("aside").first.is_visible())
        page.keyboard.press("Control+b")
        page.wait_for_timeout(400)
        check("ctrl+b restores sidebar", page.locator("aside").first.is_visible())

        # 4. Ctrl+J toggles the assistant panel
        panel_marker = page.locator("text=compatible agent/browser environment")
        page.keyboard.press("Control+j")
        page.wait_for_timeout(400)
        check("ctrl+j hides assistant", not panel_marker.first.is_visible())
        page.keyboard.press("Control+j")
        page.wait_for_timeout(400)
        check("ctrl+j restores assistant", panel_marker.first.is_visible())

        # 5. Panel state persists across reload
        page.keyboard.press("Control+b")
        page.wait_for_timeout(400)
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(800)
        check("sidebar collapse persists", not page.locator("aside").first.is_visible())
        page.keyboard.press("Control+b")
        page.wait_for_timeout(400)

        # 6. Theme toggle switches to dark mode
        page.get_by_role("button", name="Toggle theme").click()
        page.wait_for_timeout(300)
        check("dark theme applied", page.evaluate("document.documentElement.classList.contains('dark')"))
        bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
        check("dark background", bg == "rgb(10, 10, 10)", bg)
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(500)
        check("theme persists", page.evaluate("document.documentElement.classList.contains('dark')"))
        page.get_by_role("button", name="Toggle theme").click()  # -> system
        page.get_by_role("button", name="Toggle theme").click()  # -> light
        page.wait_for_timeout(300)
        check("back to light", not page.evaluate("document.documentElement.classList.contains('dark')"))

        # 7. No chat UI: panel is a WebMCP tool inspector
        check("no chat composer", page.locator("textarea").count() == 0
              and page.get_by_role("button", name="Send").count() == 0)
        check("unavailable empty state", panel_marker.first.is_visible())

        check("no page errors", not errors, "; ".join(errors[:3]))
        browser.close()

    passed = sum(1 for _, ok in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    raise SystemExit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
