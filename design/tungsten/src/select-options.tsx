import { useRendererClasses } from './appearance.js'
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** Large menus window their DOM, not their data. Rows keep natural wrapped heights;
 * measured offsets preserve scrolling and the active descendant is always mounted.
 * Small menus retain their complete DOM and ordinary browser interaction.
 */
export function SelectOptions({
  count,
  active,
  id,
  label,
  multiple,
  children,
}: {
  count: number
  active: number
  id: string
  label: string
  multiple: boolean
  children: (index: number) => ReactNode
}) {
  const classes = useRendererClasses()
  const ref = useRef<HTMLUListElement>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 240 })
  const [heights, setHeights] = useState<ReadonlyMap<number, number>>(new Map())
  const windowed = count > 200
  const offsets = useMemo(() => {
    const offsets = [0]
    for (let i = 0; i < count; i++) offsets.push(offsets[i] + (heights.get(i) ?? 36))
    return offsets
  }, [count, heights])
  function rowAt(offset: number) {
    let low = 0,
      high = count
    while (low < high) {
      const mid = (low + high) >>> 1
      if (offsets[mid + 1] <= offset) low = mid + 1
      else high = mid
    }
    return low
  }
  const start = windowed ? Math.max(0, rowAt(viewport.top) - 5) : 0
  const end = windowed ? Math.min(count, rowAt(viewport.top + viewport.height) + 6) : count
  const indices = Array.from({ length: end - start }, (_, i) => start + i)
  if (windowed && active >= 0 && active < count && !indices.includes(active)) indices.push(active)
  indices.sort((a, b) => a - b)
  const signature = indices.join(',')
  useLayoutEffect(() => {
    if (!windowed || !ref.current) return
    const list = ref.current
    const measure = () => {
      const measured = [...list.querySelectorAll<HTMLElement>('[data-option-index]')].map(
        (row) => [Number(row.dataset.optionIndex), row.offsetHeight] as const,
      )
      setHeights((previous) => {
        if (
          !measured.some(([index, height]) => height > 0 && height !== (previous.get(index) ?? 36))
        )
          return previous
        const next = new Map(previous)
        for (const [index, height] of measured) if (height > 0) next.set(index, height)
        return next
      })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    for (const row of list.querySelectorAll('[data-option-index]')) observer?.observe(row)
    return () => observer?.disconnect()
  }, [windowed, signature])
  let previous = 0
  return (
    <ul
      className={classes('tg-select-menu')}
      ref={ref}
      id={id}
      role="listbox"
      aria-label={label}
      aria-multiselectable={multiple || undefined}
      onScroll={(event) => {
        if (windowed)
          setViewport({
            top: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight,
          })
      }}
    >
      {indices.map((index) => {
        const gap = offsets[index] - offsets[previous]
        previous = index + 1
        return (
          <Fragment key={index}>
            {gap > 0 ? <li role="presentation" aria-hidden="true" style={{ height: gap }} /> : null}
            {children(index)}
          </Fragment>
        )
      })}
      {previous < count ? (
        <li
          role="presentation"
          aria-hidden="true"
          style={{ height: offsets[count] - offsets[previous] }}
        />
      ) : null}
      {count === (multiple ? 0 : 1) ? children(-1) : null}
    </ul>
  )
}
