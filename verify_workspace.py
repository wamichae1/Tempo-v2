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
        check("agent chat section", page.locator("text=Chat with Tempo").is_visible())

        # 2. The only tab strip is local to Tempo Agent.
        check("agent tab strip", page.locator("[role='tablist']").count() == 1)
        check("chat tab selected",
              page.get_by_role("tab", name="Chat")
              .get_attribute("aria-selected") == "true")
        check("webmcp tab present", page.get_by_role("tab", name="WebMCP").count() == 1)
        check("header agent control",
              page.get_by_role("button", name="Tempo Agent", exact=True).count() == 1)
        check("chat composer", page.get_by_role("textbox", name="Message Tempo Agent").is_visible())

        # 3. Ctrl+B collapses the sidebar, again restores it
        page.keyboard.press("Control+b")
        page.wait_for_timeout(400)
        check("ctrl+b hides sidebar", not page.locator("aside").first.is_visible())
        page.keyboard.press("Control+b")
        page.wait_for_timeout(400)
        check("ctrl+b restores sidebar", page.locator("aside").first.is_visible())

        # 4. Ctrl+J toggles the assistant panel
        panel_marker = page.get_by_role("textbox", name="Message Tempo Agent")
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

        # 7. WebMCP unsupported state remains available independently.
        page.get_by_role("tab", name="WebMCP").click()
        check("unavailable empty state",
              page.locator("text=compatible agent/browser environment").is_visible())
        page.get_by_role("tab", name="Chat").click()

        # 8. The right panel remains usable at a narrow workspace width.
        page.set_viewport_size({"width": 720, "height": 720})
        page.wait_for_timeout(300)
        check("narrow composer visible", panel_marker.is_visible())
        check("narrow no horizontal overflow",
              page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))

        check("no page errors", not errors, "; ".join(errors[:3]))
        browser.close()

    passed = sum(1 for _, ok in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    raise SystemExit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
