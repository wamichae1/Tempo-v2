import type { CalendarEvent } from "@/components/calendar/week-view-types";

/**
 * Pluggable location suggestion source for the event editor's Location field.
 * Implementations return matching suggestions for the current query. The
 * default provider (below) suggests locations already used on existing
 * events; a real provider (e.g. a maps API) can be swapped in later without
 * changing the UI.
 */
export interface LocationProvider {
  getSuggestions(query: string, limit?: number): string[];
}

const DEFAULT_LIMIT = 6;

/**
 * Builds a LocationProvider from the user's existing events. Suggestions are
 * the distinct, non-empty locations across those events, filtered
 * case-insensitively by substring and ordered by most recent event first.
 */
export function createEventHistoryLocationProvider(
  events: readonly CalendarEvent[],
): LocationProvider {
  // Most recent events first so their locations rank higher.
  const sorted = [...events].sort(
    (a, b) => b.start.getTime() - a.start.getTime(),
  );
  const seen = new Set<string>();
  const locations: string[] = [];
  for (const event of sorted) {
    const loc = event.location?.trim();
    if (!loc) continue;
    const key = loc.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(loc);
  }

  return {
    getSuggestions(query, limit = DEFAULT_LIMIT) {
      const q = query.trim().toLowerCase();
      if (q.length === 0) return [];
      return locations
        .filter((loc) => loc.toLowerCase().includes(q) && loc.toLowerCase() !== q)
        .slice(0, limit);
    },
  };
}
