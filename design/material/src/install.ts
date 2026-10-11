import { installTungstenDesign } from '../../tungsten/src/install.js'
import stylesheet from './material.css?inline'

const STYLE_ID = 'tungsten-design-material'

export function installMaterialDesign(): void {
  if (typeof document === 'undefined') return
  installTungstenDesign()
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.tungstenDesign = 'material'
  style.textContent = stylesheet
  document.head.append(style)
}
