import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const root = resolve(import.meta.dirname, '..')
const directory = resolve(root, 'api/src/locales')
const english = JSON.parse(readFileSync(resolve(directory, 'en.json'), 'utf8'))
const groups = {
  validation: 'Field validation',
  ui: 'Form controls and accessibility',
  editor: 'Form editor',
  catalog: 'Editor authoring settings',
  schema: 'Schema diagnostics and authoring metadata',
  source: 'Data sources',
  api: 'Requests and form operations',
  file: 'File uploads',
  date: 'Date and time',
  i18n: 'Translation catalogs',
  warning: 'Runtime warnings',
}
const purposes = {
  tg_validation_required: 'Required-field validation feedback.',
  tg_validation_min_length: 'Text minimum-length validation feedback.',
  tg_validation_max_length: 'Text maximum-length validation feedback.',
  tg_validation_min: 'Numeric minimum validation feedback.',
  tg_validation_max: 'Numeric maximum validation feedback.',
  tg_validation_email: 'Email-address validation feedback.',
  tg_validation_must_be_true: 'Boolean affirmative-value validation feedback.',
  tg_validation_option: 'Unavailable selection validation feedback.',
  tg_validation_file_required: 'Required-file validation feedback.',
  tg_validation_max_files: 'File-count validation feedback.',
  tg_validation_max_size: 'File-size validation feedback.',
  tg_validation_file_type: 'File-type validation feedback.',
  tg_validation_date: 'Date/time value-format validation feedback; format can be a nested message.',
  tg_validation_date_min: 'Date/time lower-bound validation feedback.',
  tg_validation_date_max: 'Date/time upper-bound validation feedback.',
  tg_validation_repeater_min: 'Repeater minimum-instance validation feedback.',
  tg_validation_repeater_max: 'Repeater maximum-instance validation feedback.',
  tg_validation_date_format_date:
    'Canonical date format name inserted into core validation feedback.',
  tg_validation_date_format_time:
    'Canonical time format name inserted into core validation feedback.',
  tg_validation_date_format_datetime:
    'Canonical datetime format name inserted into core validation feedback.',
  tg_ui_submit: 'Submit button.',
  tg_ui_submitting: 'Submit button while submission is in progress.',
  tg_ui_errors: 'Error count in form and group summaries.',
  tg_ui_remove: 'Accessible label for removing a selected option or file.',
  tg_ui_remove_2: 'Remove button for a repeater instance.',
  tg_ui_add_to: 'Add button for a repeater.',
  tg_ui_navigation: 'Accessible label for group or repeater navigation.',
  tg_ui_move_earlier: 'Reorder button moving a repeater instance earlier.',
  tg_ui_move_later: 'Reorder button moving a repeater instance later.',
  tg_ui_repeater_instance: 'Default repeater instance label; index is one-based.',
  tg_ui_b: 'File-size display in bytes.',
  tg_ui_: 'File-size display using a value and unit.',
  tg_ui_file_limit: 'File picker hint describing the maximum number of files.',
  tg_ui_file_size_each: 'File picker size limit for each file.',
  tg_ui_file_size_max: 'File picker maximum size hint.',
  tg_ui_calendar_month: 'Calendar month heading.',
  tg_ui_calendar_day: 'Accessible name for a date in the calendar.',
  tg_ui_choose_for: 'Accessible label for opening a field’s date/time picker.',
  tg_ui_mode_time: 'Time mode name inserted into picker labels.',
  tg_ui_mode_date: 'Date mode name inserted into picker labels.',
  tg_ui_mode_datetime: 'Date-and-time mode name inserted into picker labels.',
  tg_ui_timezone: 'Timezone hint below a date/time field.',
  tg_ui_save_dirty: 'Status indicating unsaved changes.',
  tg_ui_save_pending: 'Draft-save status while saving.',
  tg_ui_save_success: 'Acknowledged draft-save status.',
  tg_ui_save_error: 'Failed draft-save status.',
  tg_ui_submit_pending: 'Submission status while sending.',
  tg_ui_submit_success: 'Acknowledged submission status.',
  tg_ui_submit_error: 'Failed submission status.',
  tg_editor_move: 'Accessible component move label; p1 supplies the direction.',
  tg_editor_drag_onto_the_layout_or_click_to_add:
    'Palette component tooltip; p0 supplies the component description.',
}
const template = Object.fromEntries(Object.keys(english).map((key) => [key, '']))
const reference = Object.entries(english).map(([key, entry]) => {
  const group = key.split('_')[1]
  const text = typeof entry === 'string' ? entry : entry.other
  return {
    key,
    area: groups[group],
    purpose: purposes[key] ?? `${groups[group]}: ${text.trim()}`,
    default: entry,
    parameters: [
      ...new Set(
        Object.values(typeof entry === 'string' ? { text } : entry).flatMap((value) =>
          [...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((match) => match[1]),
        ),
      ),
    ].sort(),
  }
})
for (const [file, value] of [
  ['template.json', template],
  ['reference.json', reference],
]) {
  const path = resolve(directory, file)
  const content = `${JSON.stringify(value, null, 2)}\n`
  if (process.argv.includes('--write')) writeFileSync(path, content)
  else if (!isDeepStrictEqual(JSON.parse(readFileSync(path, 'utf8')), value)) {
    throw new Error(`${file} is stale; run pnpm --filter @myoonhq/tungsten generate:locales.`)
  }
}
console.log('Translation template and message reference match the English catalog.')
