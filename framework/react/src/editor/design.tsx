import tungsten, { TungstenForm } from '../../../../design/tungsten/src/index.js'
import type { DesignFormProps, TungstenDesign } from '../types.js'

function EditorForm(props: DesignFormProps) {
  return <TungstenForm {...props} submitLabel="tg_editor_apply_changes" />
}

export const editorDesign: TungstenDesign = {
  ...tungsten,
  name: 'tungsten-editor',
  Form: EditorForm,
}
