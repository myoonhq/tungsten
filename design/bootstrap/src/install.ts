import { installTungstenDesign } from '../../tungsten/src/install.js'
import stylesheet from './bootstrap.css?inline'

const STYLE_ID = 'tungsten-design-bootstrap'

export function installBootstrapDesign(): void {
  if (typeof document === 'undefined') return
  installTungstenDesign()
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.tungstenDesign = 'bootstrap'
  style.textContent = stylesheet
  document.head.append(style)
}
