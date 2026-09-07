/**
 * Tempo Tutorial step definitions. Each step targets a real UI element via
 * its `data-tour` attribute — no hardcoded coordinates, no fake controls.
 */
export interface TourStep {
  id: string;
  /** `data-tour` value of the highlighted element. */
  target: string;
  /** Fallback target when the primary is unavailable (e.g. no events yet). */
  fallbackTarget?: string;
  title: string;
  body: string;
  /** UI preparation the host must perform before measuring the target. */
  prepare?: "expand-assistant";
  /** Ask the host to render an ephemeral example if no real target is visible. */
  createExampleWhenMissing?: boolean;
  preferredSide?: "top" | "bottom" | "left" | "right";
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "calendar",
    target: "calendar",
    title: "Your calendar",
    body: "This is where you can view and manage your schedule.",
    preferredSide: "bottom",
  },
  {
    id: "new-event",
    target: "new-event",
    title: "Create an event",
    body: "Click New event, or drag directly on the calendar to add something to your schedule.",
    preferredSide: "bottom",
  },
  {
    id: "edit-events",
    target: "event-item",
    fallbackTarget: "calendar",
    title: "Edit events directly",
    createExampleWhenMissing: true,
    body: "Events aren't locked in place — drag them to move, drag their edges to resize, or click one to edit its details.",
    preferredSide: "left",
  },
  {
    id: "views",
    target: "view-switcher",
    title: "Calendar views",
    body: "Switch between week and month views to see your schedule the way you like.",
    preferredSide: "bottom",
  },
  {
    id: "agent",
    target: "agent-panel",
    title: "Tempo Agent",
    body: 'Manage your calendar with natural language. Try: "Move my meeting tomorrow to 3 PM and create a 30-minute study session afterward."',
    prepare: "expand-assistant",
    preferredSide: "left",
  },
  {
    id: "settings",
    target: "agent-settings",
    title: "Settings",
    body: "Connect your own AI provider and manage API keys and other configuration here.",
    prepare: "expand-assistant",
    preferredSide: "left",
  },
];
