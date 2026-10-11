import { TungstenRepeaterStack, TungstenRepeaterTabs } from './repeaters.js'
export { TungstenRepeaterStack, TungstenRepeaterTabs }
import {
  TungstenGroup,
  TungstenFragment,
  TungstenSection,
  TungstenPanel,
  TungstenCard,
  TungstenInset,
  TungstenFieldset,
  TungstenRow,
  TungstenColumn,
} from './basic-groups.js'
import {
  TungstenCollapsible,
  TungstenAccordion,
  TungstenDetails,
  TungstenExpansionPanel,
} from './disclosure-groups.js'
import {
  TungstenTabs,
  TungstenSegmentedView,
  TungstenWizard,
  TungstenStepper,
  TungstenPages,
  TungstenCarousel,
} from './sectioned-groups.js'
import { TungstenModal, TungstenDrawer, TungstenSheet } from './overlay-groups.js'

export {
  TungstenGroup,
  TungstenFragment,
  TungstenSection,
  TungstenPanel,
  TungstenCard,
  TungstenInset,
  TungstenFieldset,
  TungstenRow,
  TungstenColumn,
  TungstenCollapsible,
  TungstenAccordion,
  TungstenDetails,
  TungstenExpansionPanel,
  TungstenTabs,
  TungstenSegmentedView,
  TungstenWizard,
  TungstenStepper,
  TungstenPages,
  TungstenCarousel,
  TungstenModal,
  TungstenDrawer,
  TungstenSheet,
}

import type { GroupRendererDefinition, TungstenDesign } from '../../../framework/react/src/types.js'
import { TungstenFileField, TungstenSelectField } from './async-fields.js'
import { TungstenBooleanField } from './boolean-field.js'
import { TungstenDateField } from './date-field.js'
import { TungstenFailure, TungstenForm, TungstenLoading } from './form.js'
import { installTungstenDesign } from './install.js'
import { TungstenNumberField } from './number-field.js'
import { TungstenTextField } from './text-field.js'

export const tungstenGroupRenderers = {
  group: { variant: 'basic', Renderer: TungstenGroup },
  fragment: { variant: 'basic', Renderer: TungstenFragment },
  section: { variant: 'basic', Renderer: TungstenSection },
  panel: { variant: 'basic', Renderer: TungstenPanel },
  card: { variant: 'basic', Renderer: TungstenCard },
  inset: { variant: 'basic', Renderer: TungstenInset },
  fieldset: { variant: 'basic', Renderer: TungstenFieldset },
  row: { variant: 'basic', Renderer: TungstenRow },
  column: { variant: 'basic', Renderer: TungstenColumn },
  collapsible: { variant: 'basic', Renderer: TungstenCollapsible },
  accordion: { variant: 'basic', Renderer: TungstenAccordion },
  details: { variant: 'basic', Renderer: TungstenDetails },
  'expansion-panel': { variant: 'basic', Renderer: TungstenExpansionPanel },
  modal: { variant: 'basic', Renderer: TungstenModal },
  drawer: { variant: 'basic', Renderer: TungstenDrawer },
  sheet: { variant: 'basic', Renderer: TungstenSheet },
  tabs: { variant: 'sectioned', Renderer: TungstenTabs },
  'segmented-view': { variant: 'sectioned', Renderer: TungstenSegmentedView },
  wizard: { variant: 'sectioned', Renderer: TungstenWizard },
  stepper: { variant: 'sectioned', Renderer: TungstenStepper },
  pages: { variant: 'sectioned', Renderer: TungstenPages },
  carousel: { variant: 'sectioned', Renderer: TungstenCarousel },
} satisfies Readonly<Record<string, GroupRendererDefinition>>

export const tungstenRepeaterRenderers = {
  undereachother: TungstenRepeaterStack,
  tabs: TungstenRepeaterTabs,
}

const tungsten: TungstenDesign = {
  groups: tungstenGroupRenderers,
  repeaters: tungstenRepeaterRenderers,
  name: 'tungsten',
  loadingIndicators: ['select'],
  install: installTungstenDesign,
  Form: TungstenForm,
  Loading: TungstenLoading,
  Failure: TungstenFailure,
  fields: {
    file: TungstenFileField,
    select: TungstenSelectField,
    text: TungstenTextField,
    date: TungstenDateField,
    number: TungstenNumberField,
    boolean: TungstenBooleanField,
  },
}

export {
  installTungstenDesign,
  TungstenFileField,
  TungstenSelectField,
  TungstenBooleanField,
  TungstenDateField,
  TungstenFailure,
  TungstenForm,
  TungstenLoading,
  TungstenNumberField,
  TungstenTextField,
}

export default tungsten
