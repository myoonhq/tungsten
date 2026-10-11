import type { TextSettings, BooleanSettings } from '@myoonhq/tungsten/react'
const textarea: TextSettings = { textarea: true, rows: 3, resizable: false }
const password: TextSettings = { variant: 'password' }
const radio: BooleanSettings = { variant: 'radio', direction: 'row', options: [{ value: false, label: 'No' }] }
// @ts-expect-error Multiline requires an explicit row count.
const missingRows: TextSettings = { textarea: true }
// @ts-expect-error Passwords cannot be rendered as unmasked textareas.
const maskedTextarea: TextSettings = { variant: 'password', textarea: true, rows: 3 }
// @ts-expect-error Boolean choices use booleans rather than string representations.
const stringBoolean: BooleanSettings = { variant: 'radio', options: [{ value: 'false', label: 'No' }] }
// @ts-expect-error Switches do not accept radio layout settings.
const switchLayout: BooleanSettings = { variant: 'switch', direction: 'row' }
void [textarea, password, radio, missingRows, maskedTextarea, stringBoolean, switchLayout]
