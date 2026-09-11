// School Pool — the pure part: turning a pile of weekly slots, dated overrides
// and menu rows into "here is Thursday".
//
// No repo, no Svelte, no Date-with-a-timezone: every date is a 'YYYY-MM-DD'
// string and all arithmetic runs in UTC. A school week that shifts by an hour
// because the machine is on Atlantic/Reykjavik and the row was written in
// summer time is a bug nobody finds until the child is standing outside.
import type { SchoolDay, SchoolEnrollment, SchoolMenuEntry, SchoolSlot } from './data.ts';

export const WEEKDAY_LABELS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const SLOT_KINDS = [
  { value: 'class', label: 'Lesson' },
  { value: 'activity', label: 'Activity' },
  { value: 'dropoff', label: 'Drop-off' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'afterschool', label: 'After-school' }
] as const;

export const DAY_KINDS = [
  { value: 'holiday', label: 'Holiday', cancels: true },
  { value: 'no_school', label: 'No school', cancels: true },
  { value: 'teacher_day', label: 'Teacher day', cancels: true },
  { value: 'short_day', label: 'Short day', cancels: false },
  { value: 'trip', label: 'Trip', cancels: false },
  { value: 'special', label: 'Special', cancels: false }
] as const;

export function dayKindLabel(kind: string | null | undefined): string {
  return DAY_KINDS.find((k) => k.value === kind)?.label ?? 'Special';
}

export function slotKindLabel(kind: string | null | undefined): string {
  return SLOT_KINDS.find((k) => k.value === kind)?.label ?? 'Lesson';
}

/** Whether a day kind closes the school by default (the form's initial guess). */
export function kindCancels(kind: string | null | undefined): boolean {
  return DAY_KINDS.find((k) => k.value === kind)?.cancels ?? false;
}

// ── Dates ───────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' for a Date, read in the LOCAL calendar — "today" is the day
 *  the person is living, not the UTC one. */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(now: Date = new Date()): string {
  return isoDate(now);
}

function utc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function addDays(iso: string, n: number): string {
  const t = utc(iso);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekdayOf(iso: string): number {
  const d = utc(iso).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The Monday of the week `iso` falls in. */
export function startOfWeek(iso: string): string {
  return addDays(iso, -(weekdayOf(iso) - 1));
}

export function weekDates(mondayISO: string, days = 7): string[] {
  return Array.from({ length: days }, (_, i) => addDays(mondayISO, i));
}

/** ISO-8601 week number — the parity a fortnightly timetable alternates on. */
export function isoWeek(iso: string): number {
  const d = utc(iso);
  // Thursday of this week decides the year the week belongs to.
  d.setUTCDate(d.getUTCDate() + 4 - weekdayOf(iso));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Human date for a header — "Thu 12 Sep". */
export function formatDayLabel(iso: string): string {
  const d = utc(iso);
  return `${WEEKDAY_SHORT[weekdayOf(iso)]} ${d.getUTCDate()} ${
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]
  }`;
}

// ── Times ───────────────────────────────────────────────────────────────────

/** 'HH:MM' from either 'HH:MM' or Directus' 'HH:MM:SS'; '' when unset. */
export function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

/** Minutes since midnight, or null — the sort key for a day's entries. */
export function toMinutes(t: string | null | undefined): number | null {
  const hhmm = formatTime(t);
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** What Directus wants back for a `time` column. */
export function normalizeTime(t: string | null | undefined): string | null {
  const hhmm = formatTime(t);
  return hhmm ? `${hhmm}:00` : null;
}

// ── Kit / gear ──────────────────────────────────────────────────────────────

/** Trim, drop blanks, dedupe case-insensitively, keep the first spelling seen.
 *  "swim kit" and "Swim kit" are one thing to pack, not two. */
export function normalizeGear(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of values) {
    const v = (raw ?? '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (!seen.has(key)) seen.set(key, v);
  }
  return [...seen.values()];
}

/** The gear chips offered in the editors, from the plugin setting. */
export function parseGearTags(setting: unknown): string[] {
  if (typeof setting !== 'string') return [];
  return normalizeGear(setting.split(','));
}

// ── Applicability ───────────────────────────────────────────────────────────

/** Does this weekly slot run on this date? Weekday, then the effective window,
 *  then the odd/even-week parity of a fortnightly timetable. */
export function slotAppliesOn(slot: SchoolSlot, iso: string): boolean {
  if (slot.weekday !== weekdayOf(iso)) return false;
  if (slot.effective_from && iso < slot.effective_from) return false;
  if (slot.effective_to && iso > slot.effective_to) return false;
  const parity = slot.week_parity ?? 'every';
  if (parity === 'odd' && isoWeek(iso) % 2 === 0) return false;
  if (parity === 'even' && isoWeek(iso) % 2 === 1) return false;
  return true;
}

/** A dated row applies to a child when it names them, or names nobody (the
 *  household-wide holiday). */
export function dayAppliesTo(day: SchoolDay, enrollmentId: number, iso: string): boolean {
  if (day.date !== iso) return false;
  return day.enrollment_id == null || day.enrollment_id === enrollmentId;
}

/** The key a menu row and an enrollment agree on: the school's org record when
 *  there is one, otherwise its name folded to a comparable form. Siblings at
 *  one school therefore read one menu, typed once. */
export function menuKey(organizationId: number | null | undefined, schoolName: string | null | undefined): string {
  if (organizationId != null) return `org:${organizationId}`;
  const name = (schoolName ?? '').trim().toLowerCase();
  return name ? `name:${name}` : 'school:unknown';
}

export function enrollmentMenuKey(e: SchoolEnrollment): string {
  return menuKey(e.organization_id, e.school_name);
}

/** One school, as the menu editor addresses it. */
export type SchoolRef = {
  key: string;
  organization_id: number | null;
  school_name: string | null;
  label: string;
};

/** The distinct schools behind a set of children — what the menu is entered
 *  against, deduped so siblings do not produce two identical tabs. */
export function schoolsOf(enrollments: readonly SchoolEnrollment[]): SchoolRef[] {
  const out = new Map<string, SchoolRef>();
  for (const e of enrollments) {
    const key = enrollmentMenuKey(e);
    if (out.has(key)) continue;
    out.set(key, {
      key,
      organization_id: e.organization_id ?? null,
      school_name: e.school_name ?? null,
      label: e.school_name?.trim() || 'School'
    });
  }
  return [...out.values()];
}

// ── The plan ────────────────────────────────────────────────────────────────

export type PlanEntry = {
  /** Stable within a day — 'slot:12' / 'day:4'. */
  key: string;
  source: 'slot' | 'day';
  id: number;
  kind: string;
  title: string;
  start: string;
  end: string;
  location: string;
  /** Who is responsible for this entry (pickup/drop-off), a core Person id. */
  personId: number | null;
  gear: string[];
  note: string;
};

export type ChildDay = {
  enrollment: SchoolEnrollment;
  date: string;
  /** Slots + dated entries, timed ones first in clock order. */
  entries: PlanEntry[];
  /** Holiday/closure rows that apply — rendered as the day's banner. */
  notices: SchoolDay[];
  /** True when a closure suppressed the weekly timetable. */
  closed: boolean;
  /** The entry that says when and where the child is collected, if any. */
  pickup: PlanEntry | null;
  /** Everything to put in the bag, deduped. */
  gear: string[];
  menu: SchoolMenuEntry | null;
};

function entryFromSlot(slot: SchoolSlot, fallbackPerson: number | null): PlanEntry {
  const kind = slot.kind ?? 'class';
  return {
    key: `slot:${slot.id}`,
    source: 'slot',
    id: slot.id,
    kind,
    title: slot.title?.trim() || slotKindLabel(kind),
    start: formatTime(slot.start_time),
    end: formatTime(slot.end_time),
    location: slot.location?.trim() ?? '',
    personId:
      slot.responsible_person_id ??
      (kind === 'pickup' || kind === 'dropoff' ? fallbackPerson : null),
    gear: normalizeGear(slot.gear ?? []),
    note: slot.note?.trim() ?? ''
  };
}

function entryFromDay(day: SchoolDay, fallbackPerson: number | null): PlanEntry {
  return {
    key: `day:${day.id}`,
    source: 'day',
    id: day.id,
    kind: day.kind ?? 'special',
    title: day.title?.trim() || dayKindLabel(day.kind),
    start: formatTime(day.start_time),
    end: formatTime(day.end_time),
    location: day.location?.trim() ?? '',
    personId: day.pickup_person_id ?? fallbackPerson,
    gear: normalizeGear(day.gear ?? []),
    note: day.note?.trim() ?? ''
  };
}

function byClock(a: PlanEntry, b: PlanEntry): number {
  const am = toMinutes(a.start);
  const bm = toMinutes(b.start);
  if (am == null && bm == null) return a.key.localeCompare(b.key);
  if (am == null) return 1; // untimed entries sink to the bottom of the day
  if (bm == null) return -1;
  return am - bm;
}

export type PlanInput = {
  slots: readonly SchoolSlot[];
  days: readonly SchoolDay[];
  menu: readonly SchoolMenuEntry[];
};

/**
 * One child, one date.
 *
 * A closure (holiday, teacher day, anything with `cancels_classes`) removes the
 * weekly slots but keeps the dated rows — "no school, but the trip leaves at
 * 09:00 from the harbour" is a real Tuesday and the timetable must not bury it.
 */
export function planDay(
  enrollment: SchoolEnrollment,
  iso: string,
  input: PlanInput
): ChildDay {
  const mine = input.days.filter((d) => dayAppliesTo(d, enrollment.id, iso));
  const closed = mine.some((d) => d.cancels_classes === true);
  const fallbackPerson = enrollment.pickup_person_id ?? null;

  const slotEntries = closed
    ? []
    : input.slots
        .filter((s) => s.enrollment_id === enrollment.id && slotAppliesOn(s, iso))
        .map((s) => entryFromSlot(s, fallbackPerson));

  // A closure row is a banner, not a line item — unless it carries a time or a
  // place of its own, in which case it is the only thing happening that day.
  const dayEntries = mine
    .filter((d) => !d.cancels_classes || d.start_time || d.location || d.gear?.length)
    .map((d) => entryFromDay(d, fallbackPerson));

  const entries = [...slotEntries, ...dayEntries].sort(byClock);
  const key = enrollmentMenuKey(enrollment);
  // A closed school serves no lunch — showing the menu on a holiday is the
  // kind of small wrongness that stops the panel being trusted.
  const menu = closed
    ? null
    : input.menu.find((m) => m.date === iso && menuKey(m.organization_id, m.school_name) === key) ?? null;

  return {
    enrollment,
    date: iso,
    entries,
    notices: mine,
    closed,
    pickup: entries.find((e) => e.kind === 'pickup') ?? null,
    gear: normalizeGear(entries.flatMap((e) => e.gear)),
    menu
  };
}

/** Every child, one date — the Today panel. */
export function planDate(
  enrollments: readonly SchoolEnrollment[],
  iso: string,
  input: PlanInput
): ChildDay[] {
  return enrollments.map((e) => planDay(e, iso, input));
}

/** Every child, every day of a week — the board. */
export function planWeek(
  enrollments: readonly SchoolEnrollment[],
  mondayISO: string,
  input: PlanInput,
  days = 7
): { date: string; children: ChildDay[] }[] {
  return weekDates(mondayISO, days).map((date) => ({
    date,
    children: planDate(enrollments, date, input)
  }));
}

/** Is there anything at all on this day — the test for "show it or skip it". */
export function dayHasContent(day: ChildDay): boolean {
  return day.entries.length > 0 || day.notices.length > 0 || !!day.menu;
}
