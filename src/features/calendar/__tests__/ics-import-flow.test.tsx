// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarEvent } from "@/components/calendar";
import { CalendarSidebar } from "@/features/calendar/calendar-sidebar";
import type {
  CalendarEventImport,
  ImportEventsResult,
} from "@/features/calendar/use-calendar-events";

const calendars = [
  { id: "hidden", name: "Hidden", color: "gray" as const, visible: false },
  { id: "visible", name: "Visible", color: "blue" as const, visible: true },
];

function icsFile(contents: string): File {
  const file = new File([contents], "import.ics", { type: "text/calendar" });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn(async () => contents),
  });
  return file;
}

const contents = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "X-WR-CALNAME:School",
  "BEGIN:VEVENT",
  "UID:duplicate-uid",
  "DTSTART:20260914T090000",
  "DTEND:20260914T100000",
  "SUMMARY:Duplicate lecture",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:conflicting-uid",
  "DTSTART:20260914T113000",
  "DTEND:20260914T123000",
  "SUMMARY:Math Tutorial",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

function findButton(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button containing "${text}"`);
  }
  return button;
}

describe("ICS import flow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let importEvents: ReturnType<
    typeof vi.fn<
      (
        events: CalendarEventImport[],
        calendarId: string,
      ) => ImportEventsResult
    >
  >;

  const existingEvents: CalendarEvent[] = [
    {
      id: "existing-duplicate",
      title: "Existing lecture",
      start: new Date(2026, 8, 14, 9),
      end: new Date(2026, 8, 14, 10),
      calendarId: "visible",
      source: {
        kind: "ics",
        uid: "duplicate-uid",
        time: { startValue: "20260914T090000", startMode: "floating" },
      },
    },
    {
      id: "meeting",
      title: "Meeting",
      start: new Date(2026, 8, 14, 11, 45),
      end: new Date(2026, 8, 14, 12, 15),
      calendarId: "hidden",
    },
  ];

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    importEvents = vi.fn((events, calendarId) => ({
      ok: true as const,
      events: events.map((event, index) => ({
        ...event,
        id: `imported-${index}`,
        calendarId,
      })),
    }));
    await act(async () => {
      root.render(
        <CalendarSidebar
          calendars={calendars}
          events={existingEvents}
          addCalendar={vi.fn()}
          updateCalendar={vi.fn()}
          deleteCalendar={vi.fn()}
          importEvents={importEvents}
        />,
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  async function selectFile() {
    await act(async () => findButton("Import .ics").click());
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [icsFile(contents)],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Math Tutorial");
    });
  }

  it("opens after file selection, previews warnings, and defaults to the first visible calendar", async () => {
    await selectFile();

    expect(document.body.textContent).toContain("2 events found");
    expect(document.body.textContent).toContain("Duplicate:");
    expect(document.body.textContent).toContain("Conflict:");
    expect(document.body.textContent).toContain("Meeting");
    expect(document.body.textContent).toContain("Floating time");
    expect(
      document.querySelector<HTMLSelectElement>(
        'select[aria-label="Destination calendar"]',
      )?.value,
    ).toBe("visible");
    expect(findButton("Import 1 Event").disabled).toBe(false);
  });

  it("selects events, changes destination, and imports once", async () => {
    await selectFile();
    const duplicate = document.querySelector<HTMLInputElement>(
      'input[aria-label="Select Duplicate lecture"]',
    )!;
    await act(async () => duplicate.click());

    const destination = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Destination calendar"]',
    )!;
    await act(async () => {
      destination.value = "hidden";
      destination.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => findButton("Import 2 Events").click());

    expect(importEvents).toHaveBeenCalledOnce();
    expect(importEvents.mock.calls[0][0]).toHaveLength(2);
    expect(importEvents.mock.calls[0][1]).toBe("hidden");
    expect(document.body.textContent).toContain("Imported 2 events");
  });

  it("cancels without mutating and supports individual deselection", async () => {
    await selectFile();
    const tutorial = document.querySelector<HTMLInputElement>(
      'input[aria-label="Select Math Tutorial"]',
    )!;
    await act(async () => tutorial.click());
    expect(findButton("Import 0 Events").disabled).toBe(true);

    await act(async () => findButton("Cancel").click());
    expect(importEvents).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Math Tutorial");
  });
});
