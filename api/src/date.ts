import { Temporal } from '@js-temporal/polyfill'
import {
  fieldTypeOf,
  isGroup,
  isRepeater,
  type DateSettings,
  type TungstenComponent,
} from './types.js'

/** Storage is independent of the browser's locale and host timezone. */
export function dateInputValue(value: string | null, settings: DateSettings): string {
  if (!value) return ''
  if ((settings.mode ?? 'date') !== 'datetime') return value
  try {
    return Temporal.Instant.from(value)
      .toZonedDateTimeISO(settings.timeZone ?? 'UTC')
      .toPlainDateTime()
      .toString()
  } catch {
    // Keep incomplete wall-clock entries editable; core validation blocks submit.
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/.test(value) ? value : ''
  }
}

export function dateStorageValue(
  input: string,
  settings: DateSettings,
  previous: string | null = null,
): string | null {
  if (!input) return null
  if ((settings.mode ?? 'date') !== 'datetime') return input
  const plain = Temporal.PlainDateTime.from(input)
  if (plain.microsecond || plain.nanosecond)
    throw new RangeError(JSON.stringify({ messageKey: 'tg_date_precision' }))
  const timeZone = settings.timeZone ?? 'UTC'
  let offset: string | undefined
  try {
    // Preserve the chosen occurrence of an already saved repeated hour.
    if (previous) {
      const saved = Temporal.Instant.from(previous).toZonedDateTimeISO(timeZone)
      if (saved.toPlainDate().equals(plain.toPlainDate()) && saved.hour === plain.hour)
        offset = saved.offset
    }
  } catch {
    /* Previous incomplete entry has no instant yet. */
  }
  const zoned = Temporal.ZonedDateTime.from(
    {
      year: plain.year,
      month: plain.month,
      day: plain.day,
      hour: plain.hour,
      minute: plain.minute,
      second: plain.second,
      millisecond: plain.millisecond,
      microsecond: plain.microsecond,
      nanosecond: plain.nanosecond,
      timeZone,
      ...(offset ? { offset } : {}),
    },
    { disambiguation: settings.disambiguation ?? 'reject', offset: 'prefer' },
  )
  // Earlier/later may resolve a repeated hour, but must never shift a skipped
  // wall-clock hour into another time without the user choosing that time.
  if (!zoned.toPlainDateTime().equals(plain))
    throw new RangeError(JSON.stringify({ messageKey: 'tg_date_nonexistent_time' }))
  return zoned.toInstant().toString()
}

export function validDateTimeZone(timeZone: string): boolean {
  try {
    Temporal.Instant.from('2000-01-01T00:00:00Z').toZonedDateTimeISO(timeZone)
    return true
  } catch {
    return false
  }
}

/** JS owns the timezone database; check templates even when no items are loaded. */
export function checkDateTimeZones(components: readonly TungstenComponent[]): void {
  for (const component of components) {
    if (isGroup(component)) checkDateTimeZones(component.subform)
    else if (isRepeater(component)) checkDateTimeZones(component.template)
    else if (fieldTypeOf(component) === 'date' && component.mode === 'datetime') {
      const timeZone = component.timeZone ?? 'UTC'
      if (typeof timeZone !== 'string' || !validDateTimeZone(timeZone))
        throw new Error(
          JSON.stringify({
            messageKey: 'tg_api_field_has_an_unknown_timezone',
            params: { p0: component.key, p1: String(timeZone) },
          }),
        )
    }
  }
}

/** Locale controls ordering and punctuation; never guess an ambiguous date. */
function dateFormatter(settings: DateSettings, language: string, seconds = false, fraction = 0) {
  const mode = settings.mode ?? 'date'
  return new Intl.DateTimeFormat(language, {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: 'UTC',
    ...(mode !== 'time' ? ({ year: 'numeric', month: '2-digit', day: '2-digit' } as const) : {}),
    ...(mode !== 'date'
      ? ({
          hour: '2-digit',
          minute: '2-digit',
          ...(seconds ? ({ second: '2-digit' } as const) : {}),
          ...(fraction ? { fractionalSecondDigits: Math.min(fraction, 3) as 1 | 2 | 3 } : {}),
        } as const)
      : {}),
  })
}
export function dateDisplayValue(
  value: string | null,
  settings: DateSettings,
  language: string,
): string {
  const input = dateInputValue(value, settings)
  if (!input) return value ?? ''
  const mode = settings.mode ?? 'date'
  try {
    if (mode === 'date') Temporal.PlainDate.from(input)
    else if (mode === 'time') Temporal.PlainTime.from(input)
    else Temporal.PlainDateTime.from(input)
  } catch {
    return value ?? ''
  }
  const wall = new Date(
    `${mode === 'time' ? '1970-01-01T' + input : mode === 'date' ? input + 'T00:00' : input}Z`,
  )
  if (!Number.isFinite(wall.getTime())) return value ?? ''
  const seconds = input.match(/:\d{2}:(\d{2})(?:\.(\d+))?$/)
  return dateFormatter(
    settings,
    language,
    !!seconds && (!!Number(seconds[1]) || !!seconds[2]),
    seconds?.[2]?.length,
  ).format(wall)
}
export function dateEntryFormat(settings: DateSettings, language: string): string {
  const tokens: Record<string, string> = {
    year: 'YYYY',
    month: 'MM',
    day: 'DD',
    hour: 'hh',
    minute: 'mm',
    dayPeriod: 'AM/PM',
  }
  return dateFormatter(settings, language)
    .formatToParts(new Date('2006-11-22T13:45:00Z'))
    .map((part) => tokens[part.type] ?? part.value)
    .join('')
}
export function parseDateEntry(input: string, settings: DateSettings, language: string): string {
  input = input.trim()
  const mode = settings.mode ?? 'date'
  // Explicit canonical wire values are unambiguous in every locale.
  if (mode === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(input))
    return Temporal.PlainDate.from(input).toString()
  if (mode === 'time' && /^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(input))
    return Temporal.PlainTime.from(input).toString()
  if (mode === 'datetime' && /^\d{4}-\d{2}-\d{2}T/.test(input))
    return Temporal.PlainDateTime.from(input).toString()
  const escape = (text: string) =>
    text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')
  let values: Record<string, string> | undefined
  for (const [seconds, fraction] of [
    [false, 0],
    [true, 0],
    [true, 1],
    [true, 2],
    [true, 3],
  ] as const) {
    const fields: string[] = []
    const pattern = dateFormatter(settings, language, seconds, fraction)
      .formatToParts(new Date('2006-11-22T13:45:56.123Z'))
      .map((part) => {
        if (part.type === 'literal') return escape(part.value)
        fields.push(part.type)
        if (part.type === 'dayPeriod') return '([^\\d\\s]+)'
        if (part.type === 'fractionalSecond') return `(\\d{${fraction}})`
        return part.type === 'year' ? '(\\d{4})' : '(\\d{1,2})'
      })
      .join('')
    const match = new RegExp(`^${pattern}$`, 'iu').exec(input)
    if (match) {
      values = Object.fromEntries(fields.map((field, index) => [field, match[index + 1]]))
      break
    }
  }
  if (!values) throw new RangeError('tg_validation_date')
  let hour = Number(values.hour ?? 0)
  if (values.dayPeriod) {
    const periods = [0, 13].map((hour) =>
      dateFormatter(settings, language)
        .formatToParts(new Date(`2000-01-01T${String(hour).padStart(2, '0')}:00:00Z`))
        .find((part) => part.type === 'dayPeriod')
        ?.value.toLocaleLowerCase(language),
    )
    const period = values.dayPeriod.toLocaleLowerCase(language)
    if (hour < 1 || hour > 12 || !periods.includes(period))
      throw new RangeError('tg_validation_date')
    hour = (hour % 12) + (period === periods[1] ? 12 : 0)
  }
  const time = () =>
    Temporal.PlainTime.from(
      {
        hour,
        minute: Number(values.minute),
        second: Number(values.second ?? 0),
        millisecond: Number((values.fractionalSecond ?? '').padEnd(3, '0')),
      },
      { overflow: 'reject' },
    ).toString()
  const date = () =>
    Temporal.PlainDate.from(
      { year: Number(values.year), month: Number(values.month), day: Number(values.day) },
      { overflow: 'reject' },
    ).toString()
  return mode === 'date' ? date() : mode === 'time' ? time() : `${date()}T${time()}`
}
