// School Pool — data access.
//
// Everything goes through twin's neutral `repo` port, never @directus/sdk, so
// the plugin is born backend-agnostic (docs/plugin-contract.md, invariant 2).
//
// Four collections, and the split between them is the whole model:
//
//   school_enrollment  one child at one school for one year. person_id is a
//                      core Person; the school is a core organization when you
//                      have a record for it, and a plain name when you don't.
//   school_slot        what repeats every week — lessons, gym, swimming, the
//                      pickup. Weekday + time, not dates.
//   school_day         what a single date does differently: holidays, short
//                      days, trips, a different person collecting. Overrides.
//   school_menu        the canteen menu, one row per school per date. Typed in
//                      by hand once a week, which is why it keys on the school
//                      and not on the child — two siblings at one school is the
//                      normal case, and nobody types it twice.
import { repo } from '$lib/data/repo';

// ── Row shapes ──────────────────────────────────────────────────────────────

export type SchoolEnrollment = {
  id: number;
  /** Core Person — the child. */
  person_id: number | null;
  /** Core organization for the school, when one exists. */
  organization_id: number | null;
  /** Free-text school name; the label, and the menu key when there is no org. */
  school_name: string | null;
  class_label: string | null;
  teacher_name: string | null;
  /** Chip colour, any CSS colour. Falls back to a generated one. */
  color: string | null;
  /** Who normally collects — a core Person. A slot or a day can override it. */
  pickup_person_id: number | null;
  year_start: string | null;
  year_end: string | null;
  status: string | null;
  note: string | null;
  sort: number | null;
  date_created?: string | null;
};

export type SchoolSlotKind = 'class' | 'activity' | 'pickup' | 'dropoff' | 'afterschool';

export type SchoolSlot = {
  id: number;
  enrollment_id: number | null;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number | null;
  kind: SchoolSlotKind | string | null;
  title: string | null;
  /** 'HH:MM' or 'HH:MM:SS' — Directus `time` hands back seconds. */
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  /** Overrides the enrollment's default collector for this slot. */
  responsible_person_id: number | null;
  gear: string[] | null;
  /** 'every' | 'odd' | 'even' — alternating-week timetables. */
  week_parity: string | null;
  effective_from: string | null;
  effective_to: string | null;
  note: string | null;
  sort: number | null;
};

export type SchoolDayKind =
  | 'holiday'
  | 'no_school'
  | 'short_day'
  | 'special'
  | 'trip'
  | 'teacher_day';

export type SchoolDay = {
  id: number;
  /** null = every child you follow (a national holiday, a family trip). */
  enrollment_id: number | null;
  date: string | null;
  kind: SchoolDayKind | string | null;
  title: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  gear: string[] | null;
  pickup_person_id: number | null;
  /** True for holidays and closures: the weekly slots do not run that day. */
  cancels_classes: boolean | null;
  note: string | null;
};

export type SchoolMenuEntry = {
  id: number;
  organization_id: number | null;
  school_name: string | null;
  date: string | null;
  meal: string | null;
  main: string | null;
  side: string | null;
  note: string | null;
};

const ENROLLMENT_FIELDS = [
  'id', 'person_id', 'organization_id', 'school_name', 'class_label', 'teacher_name',
  'color', 'pickup_person_id', 'year_start', 'year_end', 'status', 'note', 'sort', 'date_created'
] as const;

const SLOT_FIELDS = [
  'id', 'enrollment_id', 'weekday', 'kind', 'title', 'start_time', 'end_time', 'location',
  'responsible_person_id', 'gear', 'week_parity', 'effective_from', 'effective_to', 'note', 'sort'
] as const;

const DAY_FIELDS = [
  'id', 'enrollment_id', 'date', 'kind', 'title', 'start_time', 'end_time', 'location',
  'gear', 'pickup_person_id', 'cancels_classes', 'note'
] as const;

const MENU_FIELDS = [
  'id', 'organization_id', 'school_name', 'date', 'meal', 'main', 'side', 'note'
] as const;

// ── Enrollments (children) ──────────────────────────────────────────────────

export async function listEnrollments(includeArchived = false): Promise<SchoolEnrollment[]> {
  const rows = await repo.list<SchoolEnrollment>('school_enrollment', {
    fields: [...ENROLLMENT_FIELDS],
    sort: ['sort', 'id'],
    limit: 200
  });
  return includeArchived ? rows : rows.filter((r) => (r.status ?? 'active') !== 'archived');
}

export async function createEnrollment(patch: Partial<SchoolEnrollment>): Promise<SchoolEnrollment> {
  return repo.create<SchoolEnrollment>('school_enrollment', {
    status: 'active',
    ...(patch as Record<string, unknown>)
  });
}

export async function updateEnrollment(
  id: number,
  patch: Partial<SchoolEnrollment>
): Promise<SchoolEnrollment> {
  return repo.update<SchoolEnrollment>('school_enrollment', id, patch as Record<string, unknown>);
}

/** Removes the child's slots and dated days first — the rows are meaningless
 *  without their enrollment, and a DB-level cascade is not something a plugin
 *  may assume every backend gives it. */
export async function deleteEnrollment(id: number): Promise<void> {
  const [slots, days] = await Promise.all([
    repo.list<{ id: number }>('school_slot', {
      fields: ['id'],
      where: { field: 'enrollment_id', op: 'eq', value: id },
      limit: 500
    }),
    repo.list<{ id: number }>('school_day', {
      fields: ['id'],
      where: { field: 'enrollment_id', op: 'eq', value: id },
      limit: 500
    })
  ]);
  if (slots.length) await repo.removeMany('school_slot', slots.map((s) => s.id));
  if (days.length) await repo.removeMany('school_day', days.map((d) => d.id));
  await repo.remove('school_enrollment', id);
}

// ── Weekly slots ────────────────────────────────────────────────────────────

export async function listSlots(enrollmentIds: number[]): Promise<SchoolSlot[]> {
  if (enrollmentIds.length === 0) return [];
  return repo.list<SchoolSlot>('school_slot', {
    fields: [...SLOT_FIELDS],
    where: { field: 'enrollment_id', op: 'in', value: enrollmentIds },
    sort: ['weekday', 'start_time', 'sort', 'id'],
    limit: 1000
  });
}

export async function createSlot(patch: Partial<SchoolSlot>): Promise<SchoolSlot> {
  return repo.create<SchoolSlot>('school_slot', patch as Record<string, unknown>);
}

export async function updateSlot(id: number, patch: Partial<SchoolSlot>): Promise<SchoolSlot> {
  return repo.update<SchoolSlot>('school_slot', id, patch as Record<string, unknown>);
}

export async function deleteSlot(id: number): Promise<void> {
  await repo.remove('school_slot', id);
}

// ── Dated days (holidays, short days, trips) ────────────────────────────────

/** Every dated entry in [fromISO, toISO], for these children *and* the
 *  household-wide rows (enrollment_id null) that apply to all of them. */
export async function listDays(fromISO: string, toISO: string): Promise<SchoolDay[]> {
  return repo.list<SchoolDay>('school_day', {
    fields: [...DAY_FIELDS],
    where: {
      and: [
        { field: 'date', op: 'gte', value: fromISO },
        { field: 'date', op: 'lte', value: toISO }
      ]
    },
    sort: ['date', 'start_time', 'id'],
    limit: 500
  });
}

/** Dated entries from today forward — the "what is coming" list. */
export async function listUpcomingDays(fromISO: string, limit = 100): Promise<SchoolDay[]> {
  return repo.list<SchoolDay>('school_day', {
    fields: [...DAY_FIELDS],
    where: { field: 'date', op: 'gte', value: fromISO },
    sort: ['date', 'start_time', 'id'],
    limit
  });
}

export async function createDay(patch: Partial<SchoolDay>): Promise<SchoolDay> {
  return repo.create<SchoolDay>('school_day', patch as Record<string, unknown>);
}

export async function updateDay(id: number, patch: Partial<SchoolDay>): Promise<SchoolDay> {
  return repo.update<SchoolDay>('school_day', id, patch as Record<string, unknown>);
}

export async function deleteDay(id: number): Promise<void> {
  await repo.remove('school_day', id);
}

// ── Lunch menu ──────────────────────────────────────────────────────────────

export async function listMenu(fromISO: string, toISO: string): Promise<SchoolMenuEntry[]> {
  return repo.list<SchoolMenuEntry>('school_menu', {
    fields: [...MENU_FIELDS],
    where: {
      and: [
        { field: 'date', op: 'gte', value: fromISO },
        { field: 'date', op: 'lte', value: toISO }
      ]
    },
    sort: ['date', 'id'],
    limit: 500
  });
}

export type MenuDraft = {
  organization_id: number | null;
  school_name: string | null;
  date: string;
  meal: string;
  main: string;
  side: string;
  note: string;
};

/**
 * One cell of the week grid. Typing into an empty cell creates the row, editing
 * a filled one patches it, and clearing every field deletes it — so the grid
 * never leaves behind blank rows that look like an entered-but-empty menu.
 *
 * `existing` is the already-loaded row for that school+date+meal, if any; the
 * caller has the week in memory and matching there beats a round-trip.
 */
export async function saveMenuCell(
  draft: MenuDraft,
  existing: SchoolMenuEntry | null
): Promise<SchoolMenuEntry | null> {
  const empty = !draft.main.trim() && !draft.side.trim() && !draft.note.trim();
  if (empty) {
    if (existing) await repo.remove('school_menu', existing.id);
    return null;
  }
  const patch = {
    organization_id: draft.organization_id,
    school_name: draft.school_name,
    date: draft.date,
    meal: draft.meal,
    main: draft.main.trim() || null,
    side: draft.side.trim() || null,
    note: draft.note.trim() || null
  };
  return existing
    ? repo.update<SchoolMenuEntry>('school_menu', existing.id, patch)
    : repo.create<SchoolMenuEntry>('school_menu', patch);
}

export async function deleteMenuEntry(id: number): Promise<void> {
  await repo.remove('school_menu', id);
}
