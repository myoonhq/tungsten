import { expect, type Page } from '@playwright/test'

/** Check relationships rather than freezing old coordinates, colors or label positions. */
export async function expectClearFieldLayout(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const problems: string[] = []
        const visible = (node: Element) => {
          const rect = node.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden'
        }
        const fields = [...document.querySelectorAll<HTMLElement>('.tg-field')].filter(visible)
        for (const field of fields) {
          const label = field.querySelector<HTMLLabelElement>('.MuiInputLabel-root, .tg-label')
          const input = label?.htmlFor ? document.getElementById(label.htmlFor) : null
          if (!label || !input || !visible(input)) continue
          const name = input.getAttribute('name') ?? label.textContent
          const labelRect = label.getBoundingClientRect(),
            inputRect = input.getBoundingClientRect()
          if (label.classList.contains('MuiInputLabel-root')) {
            if (label.dataset.shrink === 'true') {
              const padding = parseFloat(getComputedStyle(input).paddingTop) || 0
              const selectText = field.querySelector(
                '.tg-select-chip-label, .tg-select-value, .tg-select-placeholder',
              )
              const textTop =
                selectText && visible(selectText)
                  ? selectText.getBoundingClientRect().top
                  : inputRect.top + padding
              if (labelRect.bottom > textTop + 2)
                problems.push(`${name}: floating label overlaps the value area`)
            } else if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
              if (
                input.placeholder &&
                Number(getComputedStyle(input, '::placeholder').opacity) > 0.01
              )
                problems.push(`${name}: placeholder is visible behind an unshrunk label`)
            }
          } else if (labelRect.bottom > inputRect.top + 1)
            problems.push(`${name}: label overlaps its control`)
          const control =
            input.closest('.MuiFormControl-root') ?? input.closest('.tg-select-wrap') ?? input
          for (const hint of field.querySelectorAll(
            ':scope > .tg-description, :scope > .tg-errors',
          )) {
            if (
              visible(hint) &&
              hint.getBoundingClientRect().top < control.getBoundingClientRect().bottom - 1
            )
              problems.push(`${name}: hint or error overlaps its control`)
          }
        }
        for (let a = 0; a < fields.length; a++)
          for (let b = a + 1; b < fields.length; b++) {
            if (fields[a].contains(fields[b]) || fields[b].contains(fields[a])) continue
            const x = fields[a].getBoundingClientRect(),
              y = fields[b].getBoundingClientRect()
            if (
              Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1 &&
              Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1
            )
              problems.push('Sibling fields overlap')
          }
        for (const heading of document.querySelectorAll(
          '.tg-group-title, .tg-group-dialog-header, .tg-repeater-heading',
        )) {
          if (!visible(heading)) continue
          const container = heading.closest(
            '.tg-group, .tg-group-dialog, .tg-repeater-instance, .tg-repeater',
          )
          const below = fields.filter((field) => container?.contains(field))
          if (
            below.some(
              (field) =>
                field.getBoundingClientRect().top < heading.getBoundingClientRect().bottom - 1,
            )
          )
            problems.push(
              `${heading.textContent?.trim()}: heading or actions overlap the nested fields`,
            )
        }
        for (const field of fields) {
          const container = field.closest(
            '.tg-group--card, .tg-group--panel, .tg-group--inset, .tg-group--fieldset, .tg-repeater-instance, .tg-group-dialog',
          )
          if (!container) continue
          const parent = container.getBoundingClientRect(),
            child = field.getBoundingClientRect()
          const style = getComputedStyle(container)
          if (
            child.left < parent.left + parseFloat(style.paddingLeft) - 1 ||
            child.right > parent.right - parseFloat(style.paddingRight) + 1
          )
            problems.push('A nested field escapes its group or repeater padding')
        }
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
          problems.push('Content overflows the viewport horizontally')
        return problems
      }),
    )
    .toEqual([])
}
