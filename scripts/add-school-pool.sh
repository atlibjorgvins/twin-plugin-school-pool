#!/usr/bin/env bash
# School Pool — the four collections behind /tools/school-pool.
#
#   school_enrollment  a child (core Person) at a school for a year
#   school_slot        the weekly timetable: lessons, gym, swimming, pickups
#   school_day         what one date does differently — holidays, trips, a
#                      different person collecting
#   school_menu        the canteen menu, one row per school per date
#
# Additive and idempotent — safe to re-run, and safe to point at a second
# instance. Run from the twin repo root, after the plugin has been fetched:
#
#   bash src/lib/plugins/school-pool/scripts/add-school-pool.sh
#   TWIN_ENV_FILE=.env.klak bash src/lib/plugins/school-pool/scripts/add-school-pool.sh
#
# Every foreign key is declared ON THE FIELD at creation and asserted
# afterwards. PATCHing schema.on_delete onto an existing column silently does
# nothing (twin has been bitten: orphaned rows, no cascade, no error) — so a
# missing constraint aborts this script rather than reporting success.
set -eo pipefail

ENV_FILE="${TWIN_ENV_FILE:-.env}"
case "$ENV_FILE" in /*) ;; *) ENV_FILE="$(pwd)/$ENV_FILE" ;; esac
eval "$(grep -E '^(PUBLIC_DIRECTUS_URL|PUBLIC_DIRECTUS_TOKEN|DIRECTUS_ADMIN_URL)=' "$ENV_FILE" | sed 's/^/export /')"
URL="${DIRECTUS_ADMIN_URL:-$PUBLIC_DIRECTUS_URL}"; URL="${URL%/}"
TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

ensure_collection() {
  local name="$1" payload="$2"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$name")
  if [ "$code" = "200" ]; then echo "  collection $name exists — skipping."; return; fi
  echo "  creating collection $name…"
  curl -fsS "${AUTH[@]}" "$URL/collections" -d "$payload" >/dev/null
}

add_field() {
  local coll="$1" name="$2" payload="$3"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then echo "  field $coll.$name exists — skipping."; return; fi
  echo "  adding field $coll.$name…"
  curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}

# A nullable m2o with a real database constraint. No reverse alias is created
# on the related collection: School Pool is a plugin and must not bolt fields
# onto core Person/organization, which every other instance also owns.
ensure_m2o() {
  local coll="$1" field="$2" related="$3" ondel="$4" note="$5"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$field")
  if [ "$code" != "200" ]; then
    echo "  adding m2o $coll.$field (FK → $related.id, $ondel)…"
    curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "{
      \"field\": \"$field\", \"type\": \"integer\",
      \"schema\": { \"is_nullable\": true,
                    \"foreign_key_table\": \"$related\", \"foreign_key_column\": \"id\" },
      \"meta\": { \"interface\": \"select-dropdown-m2o\", \"special\": [\"m2o\"], \"width\": \"half\",
                  \"note\": \"$note\" }
    }" >/dev/null
  else
    echo "  field $coll.$field exists — skipping."
  fi

  local have; have=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o '"related_collection":"'"$related"'"' | head -1 || true)
  if [ -z "$have" ]; then
    echo "  creating relation $coll.$field → $related ($ondel)…"
    curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
      \"collection\": \"$coll\",
      \"field\": \"$field\",
      \"related_collection\": \"$related\",
      \"schema\": { \"on_delete\": \"$ondel\" }
    }" >/dev/null
  fi

  local sch; sch=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o '"on_delete":"[A-Z ]*"' | head -1 || true)
  if [ -z "$sch" ]; then
    echo "  !! $coll.$field has no database foreign key — the cascade will NOT fire." >&2
    echo "     Drop the field in Directus and re-run so it is created with the FK in place." >&2
    exit 1
  fi
  echo "  verified $coll.$field constraint: $sch"
}

stamp_fields() {
  local coll="$1"
  add_field "$coll" user_created '{
    "field": "user_created", "type": "uuid",
    "meta": { "special": ["user-created"], "interface": "select-dropdown-m2o", "readonly": true, "hidden": true },
    "schema": { "is_nullable": true, "foreign_key_table": "directus_users", "foreign_key_column": "id", "on_delete": "SET NULL" }
  }'
  add_field "$coll" date_created '{
    "field": "date_created", "type": "timestamp",
    "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }
  }'
  add_field "$coll" date_updated '{
    "field": "date_updated", "type": "timestamp",
    "meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true }
  }'
}

# ── school_enrollment ───────────────────────────────────────────────────────
echo "▶ school_enrollment"
ensure_collection school_enrollment '{
  "collection": "school_enrollment",
  "schema": { "name": "school_enrollment" },
  "meta": {
    "icon": "school",
    "note": "A child (core Person) at a school for a year. Everything else in School Pool hangs off one of these.",
    "display_template": "{{school_name}} — {{class_label}}",
    "sort_field": "sort",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "active"
  }
}'
ensure_m2o school_enrollment person_id Person "SET NULL" "The child. A core Person record — School Pool never stores a person of its own."
ensure_m2o school_enrollment organization_id organization "SET NULL" "The school as an organization record, when one exists."
ensure_m2o school_enrollment pickup_person_id Person "SET NULL" "Who normally collects. A slot or a single date can override it."
add_field school_enrollment school_name '{
  "field": "school_name", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "School name. Also the menu key when there is no organization record." },
  "schema": { "max_length": 160 }
}'
add_field school_enrollment class_label '{
  "field": "class_label", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Class or year, e.g. 3. bekkur." },
  "schema": { "max_length": 80 }
}'
add_field school_enrollment teacher_name '{
  "field": "teacher_name", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": { "max_length": 120 }
}'
add_field school_enrollment color '{
  "field": "color", "type": "string",
  "meta": { "interface": "select-color", "width": "half", "note": "Chip colour on the week board." },
  "schema": { "max_length": 32 }
}'
add_field school_enrollment year_start '{
  "field": "year_start", "type": "date",
  "meta": { "interface": "datetime", "width": "half" }
}'
add_field school_enrollment year_end '{
  "field": "year_end", "type": "date",
  "meta": { "interface": "datetime", "width": "half" }
}'
add_field school_enrollment status '{
  "field": "status", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half", "display": "labels",
    "options": { "choices": [ { "text": "Active", "value": "active" }, { "text": "Archived", "value": "archived" } ] } },
  "schema": { "default_value": "active" }
}'
add_field school_enrollment note '{
  "field": "note", "type": "text",
  "meta": { "interface": "input-multiline" }
}'
add_field school_enrollment sort '{
  "field": "sort", "type": "integer",
  "meta": { "interface": "input", "hidden": true }
}'
stamp_fields school_enrollment

# ── school_slot ─────────────────────────────────────────────────────────────
echo "▶ school_slot"
ensure_collection school_slot '{
  "collection": "school_slot",
  "schema": { "name": "school_slot" },
  "meta": {
    "icon": "schedule",
    "note": "The weekly timetable: what repeats on a weekday. Dates never appear here — school_day owns those.",
    "display_template": "{{title}}",
    "sort_field": "sort"
  }
}'
ensure_m2o school_slot enrollment_id school_enrollment "CASCADE" "The child this repeats for."
ensure_m2o school_slot responsible_person_id Person "SET NULL" "Who does this drop-off or pickup, when it is not the usual person."
add_field school_slot weekday '{
  "field": "weekday", "type": "integer",
  "meta": { "interface": "select-dropdown", "width": "half", "note": "ISO weekday: 1 = Monday … 7 = Sunday.",
    "options": { "choices": [
      { "text": "Monday", "value": 1 }, { "text": "Tuesday", "value": 2 }, { "text": "Wednesday", "value": 3 },
      { "text": "Thursday", "value": 4 }, { "text": "Friday", "value": 5 },
      { "text": "Saturday", "value": 6 }, { "text": "Sunday", "value": 7 } ] } }
}'
add_field school_slot kind '{
  "field": "kind", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half", "display": "labels",
    "options": { "choices": [
      { "text": "Lesson", "value": "class" }, { "text": "Activity", "value": "activity" },
      { "text": "Drop-off", "value": "dropoff" }, { "text": "Pickup", "value": "pickup" },
      { "text": "After-school", "value": "afterschool" } ] } },
  "schema": { "default_value": "class", "max_length": 24 }
}'
add_field school_slot title '{
  "field": "title", "type": "string",
  "meta": { "interface": "input", "note": "What it is — Sund, Íþróttir, Pickup." },
  "schema": { "max_length": 160 }
}'
add_field school_slot start_time '{
  "field": "start_time", "type": "time",
  "meta": { "interface": "datetime", "width": "half" }
}'
add_field school_slot end_time '{
  "field": "end_time", "type": "time",
  "meta": { "interface": "datetime", "width": "half" }
}'
add_field school_slot location '{
  "field": "location", "type": "string",
  "meta": { "interface": "input", "note": "Where — the pool, the gym, the side entrance." },
  "schema": { "max_length": 200 }
}'
add_field school_slot gear '{
  "field": "gear", "type": "json",
  "meta": { "interface": "tags", "note": "What has to be in the bag: swim kit, gym kit, library book." }
}'
add_field school_slot week_parity '{
  "field": "week_parity", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half", "note": "Fortnightly timetables alternate on the ISO week number.",
    "options": { "choices": [
      { "text": "Every week", "value": "every" }, { "text": "Odd weeks", "value": "odd" }, { "text": "Even weeks", "value": "even" } ] } },
  "schema": { "default_value": "every", "max_length": 16 }
}'
add_field school_slot effective_from '{
  "field": "effective_from", "type": "date",
  "meta": { "interface": "datetime", "width": "half", "note": "Optional — the timetable changed mid-year." }
}'
add_field school_slot effective_to '{
  "field": "effective_to", "type": "date",
  "meta": { "interface": "datetime", "width": "half" }
}'
add_field school_slot note '{
  "field": "note", "type": "text",
  "meta": { "interface": "input-multiline" }
}'
add_field school_slot sort '{
  "field": "sort", "type": "integer",
  "meta": { "interface": "input", "hidden": true }
}'
stamp_fields school_slot

# ── school_day ──────────────────────────────────────────────────────────────
echo "▶ school_day"
ensure_collection school_day '{
  "collection": "school_day",
  "schema": { "name": "school_day" },
  "meta": {
    "icon": "event",
    "note": "What one date does differently: holidays, teacher days, short days, trips. enrollment_id null = every child.",
    "display_template": "{{date}} — {{title}}"
  }
}'
ensure_m2o school_day enrollment_id school_enrollment "CASCADE" "The child, or empty for every child you follow."
ensure_m2o school_day pickup_person_id Person "SET NULL" "Who collects on this date, when it is not the usual person."
add_field school_day date '{
  "field": "date", "type": "date",
  "meta": { "interface": "datetime", "width": "half" },
  "schema": { "is_nullable": false }
}'
add_field school_day kind '{
  "field": "kind", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half", "display": "labels",
    "options": { "choices": [
      { "text": "Holiday", "value": "holiday" }, { "text": "No school", "value": "no_school" },
      { "text": "Teacher day", "value": "teacher_day" }, { "text": "Short day", "value": "short_day" },
      { "text": "Trip", "value": "trip" }, { "text": "Special", "value": "special" } ] } },
  "schema": { "default_value": "special", "max_length": 24 }
}'
add_field school_day title '{
  "field": "title", "type": "string",
  "meta": { "interface": "input" },
  "schema": { "max_length": 200 }
}'
add_field school_day start_time '{
  "field": "start_time", "type": "time",
  "meta": { "interface": "datetime", "width": "half" }
}'
add_field school_day end_time '{
  "field": "end_time", "type": "time",
  "meta": { "interface": "datetime", "width": "half" }
}'
add_field school_day location '{
  "field": "location", "type": "string",
  "meta": { "interface": "input", "note": "Where they are that day, if it is not the school." },
  "schema": { "max_length": 200 }
}'
add_field school_day gear '{
  "field": "gear", "type": "json",
  "meta": { "interface": "tags", "note": "Extra kit this date needs." }
}'
add_field school_day cancels_classes '{
  "field": "cancels_classes", "type": "boolean",
  "meta": { "interface": "boolean", "width": "half", "note": "True for closures: the weekly timetable does not run that day." },
  "schema": { "default_value": false }
}'
add_field school_day note '{
  "field": "note", "type": "text",
  "meta": { "interface": "input-multiline" }
}'
stamp_fields school_day

# ── school_menu ─────────────────────────────────────────────────────────────
echo "▶ school_menu"
ensure_collection school_menu '{
  "collection": "school_menu",
  "schema": { "name": "school_menu" },
  "meta": {
    "icon": "restaurant",
    "note": "The canteen menu, typed in by hand. Keyed on the SCHOOL, not the child — two siblings at one school read one row.",
    "display_template": "{{date}} — {{main}}"
  }
}'
ensure_m2o school_menu organization_id organization "SET NULL" "The school as an organization record, when one exists."
add_field school_menu school_name '{
  "field": "school_name", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "The menu key when the school has no organization record." },
  "schema": { "max_length": 160 }
}'
add_field school_menu date '{
  "field": "date", "type": "date",
  "meta": { "interface": "datetime", "width": "half" },
  "schema": { "is_nullable": false }
}'
add_field school_menu meal '{
  "field": "meal", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [ { "text": "Lunch", "value": "lunch" }, { "text": "Snack", "value": "snack" } ] } },
  "schema": { "default_value": "lunch", "max_length": 16 }
}'
add_field school_menu main '{
  "field": "main", "type": "string",
  "meta": { "interface": "input" },
  "schema": { "max_length": 300 }
}'
add_field school_menu side '{
  "field": "side", "type": "string",
  "meta": { "interface": "input", "note": "Salad bar, soup, the vegetarian option." },
  "schema": { "max_length": 300 }
}'
add_field school_menu note '{
  "field": "note", "type": "text",
  "meta": { "interface": "input-multiline" }
}'
stamp_fields school_menu

echo "✓ School Pool schema ready."
echo "  Next: add school_enrollment school_slot school_day school_menu to PERSONAL in"
echo "  scripts/add-member-role.sh, then run: bash scripts/add-member-role.sh"
