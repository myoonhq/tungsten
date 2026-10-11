import { parseDateEntry, dateEntryFormat, dateDisplayValue } from './date.js'
import { describe, expect, it } from 'vitest'
import { checkDateTimeZones, dateInputValue, dateStorageValue, validDateTimeZone } from './date.js'

describe('date/time conversion', () => {
  it('keeps calendar dates and clock times independent of host timezones', () => {
    expect(dateStorageValue('2024-02-29', {})).toBe('2024-02-29')
    expect(dateInputValue('09:30:00', { mode: 'time' })).toBe('09:30:00')
    expect(dateStorageValue('', { mode: 'datetime' })).toBeNull()
    expect(dateInputValue(null, {})).toBe('')
  })

  it.each([
    ['Europe/Bratislava', '2026-07-07T09:30', '2026-07-07T07:30:00Z'],
    ['Europe/Bratislava', '2026-01-07T09:30', '2026-01-07T08:30:00Z'],
    ['America/New_York', '2026-07-07T09:30', '2026-07-07T13:30:00Z'],
    ['Asia/Kolkata', '2026-07-07T09:30', '2026-07-07T04:00:00Z'],
    ['+05:45', '2026-07-07T09:30', '2026-07-07T03:45:00Z'],
    ['UTC', '2026-07-07T09:30:00.123', '2026-07-07T09:30:00.123Z'],
  ])('round-trips %s without using the machine timezone', (timeZone, input, stored) => {
    const settings = { mode: 'datetime', timeZone } as const
    expect(dateStorageValue(input, settings)).toBe(stored)
    expect(dateStorageValue(dateInputValue(stored, settings), settings, stored)).toBe(stored)
  })

  it('defaults to UTC', () => {
    expect(dateStorageValue('2026-10-07T09:30', { mode: 'datetime' })).toBe('2026-10-07T09:30:00Z')
  })

  it('rejects precision beyond the supported millisecond format', () => {
    expect(() => dateStorageValue('2026-10-07T09:30:00.1234', { mode: 'datetime' })).toThrow(
      /tg_date_precision/,
    )
  })

  it.each(['reject', 'earlier', 'later'] as const)(
    'rejects skipped hours even with %s disambiguation',
    (disambiguation) => {
      expect(() =>
        dateStorageValue('2026-03-29T02:30', {
          mode: 'datetime',
          timeZone: 'Europe/Bratislava',
          disambiguation,
        }),
      ).toThrow()
    },
  )

  it('requires explicit disambiguation for new repeated times', () => {
    const settings = { mode: 'datetime', timeZone: 'Europe/Bratislava' } as const
    expect(() => dateStorageValue('2026-10-25T02:30', settings)).toThrow()
    expect(dateStorageValue('2026-10-25T02:30', { ...settings, disambiguation: 'earlier' })).toBe(
      '2026-10-25T00:30:00Z',
    )
    expect(dateStorageValue('2026-10-25T02:30', { ...settings, disambiguation: 'later' })).toBe(
      '2026-10-25T01:30:00Z',
    )
    expect(
      dateStorageValue(
        '2026-10-25T02:30',
        { ...settings, disambiguation: 'later' },
        '2026-07-07T07:30:00Z',
      ),
    ).toBe('2026-10-25T01:30:00Z')
    expect(() => dateStorageValue('2026-10-25T02:30', settings, '2026-07-07T07:30:00Z')).toThrow()
  })

  it.each(['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z'])(
    'keeps saved repeated-hour occurrence %s',
    (previous) => {
      const settings = { mode: 'datetime', timeZone: 'Europe/Bratislava' } as const
      expect(dateStorageValue(dateInputValue(previous, settings), settings, previous)).toBe(
        previous,
      )
    },
  )

  it('keeps an incomplete wall-clock entry editable and rejects invalid timezones', () => {
    expect(
      dateInputValue('2026-03-29T02:30', { mode: 'datetime', timeZone: 'Europe/Bratislava' }),
    ).toBe('2026-03-29T02:30')
    expect(validDateTimeZone('MadeUp/Zone')).toBe(false)
    expect(() =>
      checkDateTimeZones([
        {
          type: 'repeater',
          key: 'items',
          render: { type: 'tabs', settings: {} },
          template: [
            { type: 'date', key: 'items.when', mode: 'datetime', timeZone: 'MadeUp/Zone' },
          ],
        },
      ]),
    ).toThrow(/tg_api_field_has_an_unknown_timezone/)
  })
})

describe('explicit locale entry', () => {
  it.each(['th-TH', 'ar-EG', 'fa-IR', 'en-u-ca-buddhist-nu-thai'])(
    'round-trips Gregorian dates and Latin digits across all modes in %s',
    (language) => {
      for (const [mode, value] of [
        ['date', '2026-10-10'],
        ['time', '21:45:56.123'],
        ['datetime', '2026-10-10T21:45:56.123Z'],
      ] as const) {
        const settings = { mode, timeZone: 'UTC' }
        const display = dateDisplayValue(value, settings, language)
        if (mode !== 'time') expect(display).toContain('2026')
        expect(display).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9\u0e50-\u0e59]/)
        expect(dateStorageValue(parseDateEntry(display, settings, language), settings)).toBe(value)
      }
    },
  )
  it.each([
    ['en', '02/03/2024', '2024-02-03'],
    ['sk', '02. 03. 2024', '2024-03-02'],
    ['hu', '2024. 03. 02.', '2024-03-02'],
  ])('uses %s ordering as the intended date', (language, input, expected) => {
    expect(parseDateEntry(input, { mode: 'date' }, language)).toBe(expected)
  })
  it.each(['sk', 'en', 'hu'])(
    'rejects impossible dates and retains explicit canonical support in %s',
    (language) => {
      expect(() => parseDateEntry('2024-02-30', { mode: 'date' }, language)).toThrow()
      expect(parseDateEntry('2024-02-29', { mode: 'date' }, language)).toBe('2024-02-29')
      expect(dateEntryFormat({ mode: 'date' }, language)).toContain('YYYY')
    },
  )
  it('rejects foreign punctuation/order instead of guessing and accepts locale time periods', () => {
    expect(() => parseDateEntry('03/02/2024', { mode: 'date' }, 'sk')).toThrow()
    expect(parseDateEntry('09:45 PM', { mode: 'time' }, 'en')).toBe('21:45:00')
    expect(parseDateEntry('21:45', { mode: 'time' }, 'sk')).toBe('21:45:00')
    expect(() => parseDateEntry('13:45 PM', { mode: 'time' }, 'en')).toThrow()
  })
})

it.each(['en', 'sk', 'hu'])(
  'round-trips localized milliseconds in %s and never displays an impossible date as another day',
  (language) => {
    const settings = { mode: 'time' } as const
    const display = dateDisplayValue('09:30:56.123', settings, language)
    expect(parseDateEntry(display, settings, language)).toBe('09:30:56.123')
    expect(dateDisplayValue('2026-02-30', { mode: 'date' }, language)).toBe('2026-02-30')
  },
)
