import stylesheet from './tungsten.css?inline'

const STYLE_ID = 'tungsten-design-tungsten'

export function installTungstenDesign(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.tungstenDesign = 'tungsten'
  style.textContent = stylesheet
  document.head.append(style)
}
