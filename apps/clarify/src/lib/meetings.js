// ─── Calendar / Meeting Scheduling ───────────────────────────────────────────
// Booking opens a prefilled Google Calendar event — zero setup, works today.
// (An earlier scaffold probed a /create-meeting serverless function that never
// shipped, so every deployed booking silently fell through to this URL anyway;
// the phantom call is gone and the UI copy now tells the truth.) Swap in
// Calendly by pointing the scheduling link (Settings) at your Calendly URL.

// Build a Google Calendar "create event" URL (local fallback, no API needed).
export function googleCalendarUrl({ title, details, start, durationMin, guestEmail }) {
  const fmt = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(start.getTime() + durationMin * 60000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    details: details || "",
    dates: `${fmt(start)}/${fmt(end)}`,
    add: guestEmail || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}


// Create a meeting: open a prefilled Google Calendar event in a new tab.
export async function createMeeting({ title, details, start, durationMin, guestEmail }) {
  const url = googleCalendarUrl({ title, details, start, durationMin, guestEmail });
  window.open(url, "_blank");
  return { success: true, method: "gcal_url", htmlLink: url };
}


// Generate 3 suggested slots (next business days at common meeting times).
export function suggestSlots(fromDate) {
  const slots = [];
  const times = [[10, 0], [14, 0], [11, 30]];
  let d = new Date(fromDate);
  d.setDate(d.getDate() + 1);
  let added = 0, guard = 0;
  while (added < 3 && guard < 14) {
    guard++;
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      const [h, m] = times[added % times.length];
      const slot = new Date(d);
      slot.setHours(h, m, 0, 0);
      slots.push(slot);
      added++;
    }
    d = new Date(d);
    d.setDate(d.getDate() + 1);
  }
  return slots;
}
