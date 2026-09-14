import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SchoolDay, SchoolEnrollment, SchoolMenuEntry, SchoolSlot } from './data.ts';
import {
  addDays,
  dayAppliesTo,
  isoWeek,
  menuKey,
  normalizeGear,
  normalizeTime,
  planDay,
  parseGearTags,
  slotAppliesOn,
  startOfWeek,
  toMinutes,
  weekdayOf
} from './schedule.ts';

const child = (over: Partial<SchoolEnrollment> = {}): SchoolEnrollment => ({
  id: 1,
  person_id: 100,
  organization_id: null,
  school_name: 'Hverfisskólinn',
  class_label: '3. bekkur',
  teacher_name: null,
  color: null,
  pickup_person_id: 900,
  year_start: null,
  year_end: null,
  status: 'active',
  note: null,
  sort: null,
  ...over
});

const slot = (over: Partial<SchoolSlot> = {}): SchoolSlot => ({
  id: 1,
  enrollment_id: 1,
  weekday: 4,
  kind: 'class',
  title: 'Sund',
  start_time: '10:00:00',
  end_time: '11:00:00',
  location: 'Sundlaugin',
  responsible_person_id: null,
  gear: ['Swim kit'],
  week_parity: 'every',
  effective_from: null,
  effective_to: null,
  note: null,
  sort: null,
  ...over
});

const dated = (over: Partial<SchoolDay> = {}): SchoolDay => ({
  id: 1,
  enrollment_id: null,
  date: '2026-09-10',
  kind: 'holiday',
  title: 'Starfsdagur',
  start_time: null,
  end_time: null,
  location: null,
  gear: null,
  pickup_person_id: null,
  cancels_classes: true,
  note: null,
  ...over
});

const menuRow = (over: Partial<SchoolMenuEntry> = {}): SchoolMenuEntry => ({
  id: 1,
  organization_id: null,
  school_name: 'Hverfisskólinn',
  date: '2026-09-10',
  meal: 'lunch',
  main: 'Fiskur í raspi',
  side: 'Salat',
  note: null,
  ...over
});

describe('dates', () => {
  it('walks days across a month boundary without drifting', () => {
    assert.equal(addDays('2026-08-31', 1), '2026-09-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  it('reads Sunday as ISO weekday 7, and takes its week back to Monday', () => {
    assert.equal(weekdayOf('2026-09-13'), 7);
    assert.equal(startOfWeek('2026-09-13'), '2026-09-07');
    assert.equal(startOfWeek('2026-09-07'), '2026-09-07');
  });

  it('numbers ISO weeks by the Thursday rule', () => {
    // 1 Jan 2027 is a Friday, so it belongs to week 53 of 2026.
    assert.equal(isoWeek('2027-01-01'), 53);
    assert.equal(isoWeek('2026-09-10'), 37);
  });
});

describe('times', () => {
  it('accepts both the Directus and the <input type=time> spelling', () => {
    assert.equal(toMinutes('08:10:00'), 490);
    assert.equal(toMinutes('08:10'), 490);
    assert.equal(toMinutes(null), null);
    assert.equal(normalizeTime('8:05'), '08:05:00');
    assert.equal(normalizeTime(''), null);
  });
});

describe('kit', () => {
  it('dedupes case-insensitively and keeps the first spelling', () => {
    assert.deepEqual(normalizeGear(['Swim kit', 'swim kit', ' ', null, 'Gym kit']), [
      'Swim kit',
      'Gym kit'
    ]);
  });

  it('parses the comma-separated setting', () => {
    assert.deepEqual(parseGearTags('Swim kit, Gym kit ,, Swim Kit'), ['Swim kit', 'Gym kit']);
    assert.deepEqual(parseGearTags(undefined), []);
  });
});

describe('slot applicability', () => {
  it('matches the weekday only', () => {
    assert.equal(slotAppliesOn(slot(), '2026-09-10'), true); // Thursday
    assert.equal(slotAppliesOn(slot(), '2026-09-11'), false);
  });

  it('respects an effective window on both ends', () => {
    const s = slot({ effective_from: '2026-09-11', effective_to: '2026-12-20' });
    assert.equal(slotAppliesOn(s, '2026-09-10'), false);
    assert.equal(slotAppliesOn(s, '2026-09-17'), true);
    assert.equal(slotAppliesOn(s, '2027-01-07'), false);
  });

  it('alternates on ISO week parity', () => {
    // 2026-09-10 is week 37 (odd); 2026-09-17 is week 38 (even).
    assert.equal(slotAppliesOn(slot({ week_parity: 'odd' }), '2026-09-10'), true);
    assert.equal(slotAppliesOn(slot({ week_parity: 'odd' }), '2026-09-17'), false);
    assert.equal(slotAppliesOn(slot({ week_parity: 'even' }), '2026-09-10'), false);
    assert.equal(slotAppliesOn(slot({ week_parity: 'even' }), '2026-09-17'), true);
  });
});

describe('dated rows', () => {
  it('applies a household-wide row to every child, and a named one to one', () => {
    assert.equal(dayAppliesTo(dated(), 1, '2026-09-10'), true);
    assert.equal(dayAppliesTo(dated(), 2, '2026-09-10'), true);
    assert.equal(dayAppliesTo(dated({ enrollment_id: 2 }), 1, '2026-09-10'), false);
    assert.equal(dayAppliesTo(dated(), 1, '2026-09-11'), false);
  });
});

describe('planDay', () => {
  const empty = { slots: [], days: [], menu: [] };

  it('puts the weekly slots in clock order and collects the kit', () => {
    const day = planDay(child(), '2026-09-10', {
      ...empty,
      slots: [
        slot({ id: 2, title: 'Íþróttir', start_time: '13:00:00', gear: ['Gym kit'] }),
        slot({ id: 1 }),
        slot({ id: 3, kind: 'pickup', title: 'Pickup', start_time: '14:20:00', gear: [] })
      ]
    });
    assert.deepEqual(day.entries.map((e) => e.title), ['Sund', 'Íþróttir', 'Pickup']);
    assert.deepEqual(day.gear, ['Swim kit', 'Gym kit']);
    assert.equal(day.pickup?.start, '14:20');
    assert.equal(day.closed, false);
  });

  it('falls back to the enrollment collector, and lets a slot override it', () => {
    const day = planDay(child(), '2026-09-10', {
      ...empty,
      slots: [
        slot({ id: 3, kind: 'pickup', start_time: '14:20:00' }),
        slot({ id: 4, kind: 'dropoff', start_time: '08:00:00', responsible_person_id: 901 })
      ]
    });
    assert.equal(day.pickup?.personId, 900);
    assert.equal(day.entries[0].personId, 901);
  });

  it('a closure cancels the timetable but never a dated trip', () => {
    const day = planDay(child(), '2026-09-10', {
      ...empty,
      slots: [slot()],
      days: [
        dated(),
        dated({
          id: 2,
          kind: 'trip',
          title: 'Vettvangsferð',
          cancels_classes: false,
          start_time: '09:00:00',
          location: 'Höfnin',
          gear: ['Packed lunch']
        })
      ]
    });
    assert.equal(day.closed, true);
    assert.deepEqual(day.entries.map((e) => e.title), ['Vettvangsferð']);
    assert.deepEqual(day.gear, ['Packed lunch']);
    assert.deepEqual(day.notices.map((n) => n.title), ['Starfsdagur', 'Vettvangsferð']);
  });

  it('keeps a closure with its own time as the day’s one entry', () => {
    const day = planDay(child(), '2026-09-10', {
      ...empty,
      slots: [slot()],
      days: [dated({ title: 'Foreldraviðtal', kind: 'no_school', start_time: '11:30:00' })]
    });
    assert.deepEqual(day.entries.map((e) => e.title), ['Foreldraviðtal']);
    assert.equal(day.entries[0].personId, 900);
  });

  it('matches the menu by school, so siblings read one typed-in row', () => {
    const input = { ...empty, menu: [menuRow()] };
    const a = planDay(child({ id: 1 }), '2026-09-10', input);
    const b = planDay(child({ id: 2, person_id: 101 }), '2026-09-10', input);
    assert.equal(a.menu?.main, 'Fiskur í raspi');
    assert.equal(b.menu?.main, 'Fiskur í raspi');

    const other = planDay(child({ id: 3, school_name: 'Bæjarskólinn' }), '2026-09-10', input);
    assert.equal(other.menu, null);
  });

  it('prefers the organization record over the name when keying a school', () => {
    assert.equal(menuKey(42, 'Hverfisskólinn'), 'org:42');
    assert.equal(menuKey(null, ' Hverfisskólinn '), 'name:hverfisskólinn');
    assert.notEqual(menuKey(42, 'Hverfisskólinn'), menuKey(null, 'Hverfisskólinn'));
  });

  it('serves no lunch on a closed day', () => {
    const day = planDay(child(), '2026-09-10', { ...empty, days: [dated()], menu: [menuRow()] });
    assert.equal(day.menu, null);
  });
});
