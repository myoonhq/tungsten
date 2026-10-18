import material, { createMaterialDesign, MaterialForm, MaterialLoading, MaterialFailure } from '@myoon/tungsten/react/design/material'
import {
  Tungsten,
  TungstenThemeProvider,
  useTungstenColorScheme,
  type TungstenColorScheme,
  TungstenEditor,
  getAuthoringCatalog,
  ApiClient,
  supportedLanguages,
  type TungstenConfig,
  type DataSources,
  type FileSettings,
  type SelectSettings,
  type DateSettings,
  type TungstenController,
  type TungstenSnapshot,
  type AuthoringCatalog,
  type TungstenDesign,
  type TungstenSchema,
  type TungstenValues,
} from '@myoon/tungsten/react'
import bootstrap from '@myoon/tungsten/react/design/bootstrap'
import tungsten from '@myoon/tungsten/react/design/tungsten'

const schema: TungstenSchema = { schemaVersion: 'sprout', form: [] }
const design: TungstenDesign = tungsten
const onSubmit = (values: TungstenValues): void => {
  void values
}

const initialValues: TungstenValues = { name: 'Ada', enabled: false, count: 0, optional: null }
const form = Tungsten({ schema, design, initialValues, onSubmit })
const defaultsOnly = Tungsten({ schema, initialValues: null, onSubmit })
void defaultsOnly
void form

const repeatedSchema: TungstenSchema = { schemaVersion: 'sprout', form: [{
  type: 'repeater', key: 'person', template: [{ type: 'text', key: 'person.name' }],
  render: { type: 'tabs', settings: {} }, min: 0, max: 5, reorder: true,
}] }
const repeatedValues: TungstenValues = { person: [{ name: 'Ada' }] }
void Tungsten({ schema: repeatedSchema, initialValues: repeatedValues, onSubmit })

const onStateChange = (snapshot: TungstenSnapshot): void => { void snapshot.values; void snapshot.state; void snapshot.valid }
void Tungsten({ schema, onSubmit, onStateChange })
void TungstenEditor({ initialSchema: schema, initialValues: null, design, onChange: (accepted: TungstenSchema) => { void accepted } })
const discovery: Promise<AuthoringCatalog> = getAuthoringCatalog()
void discovery


const config: TungstenConfig = { apis: { main: { baseUrl: 'https://example.com/api/', headers: async () => ({ Authorization: 'host-token' }) } }, request: async (request) => { void request.body; void request.signal; return { data: null, status: 200 } } }
const dataSources: DataSources = { options: { api: 'main', endpoint: 'options', resultPath: '/data', schema: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, label: { type: 'string' } }, required: ['value', 'label'] } } } }
const fileSettings: FileSettings = { upload: { api: 'main', endpoint: 'files', timing: 'selection' }, multiple: true }
const selectSettings: SelectSettings = { selectFirstOption: true }
const dateSettings: DateSettings = { mode: 'datetime', timeZone: 'Europe/Bratislava', disambiguation: 'later' }
const dateSchema: TungstenSchema = { schemaVersion: 'sprout', form: [{ type: 'date', key: 'meeting', ...dateSettings }] }
void Tungsten({ schema: dateSchema, onSubmit })
// @ts-expect-error unsupported date mode
const invalidDateSettings: DateSettings = { mode: 'timestamp' }
void invalidDateSettings
// @ts-expect-error first-option selection requires a boolean
const invalidSelectSettings: SelectSettings = { selectFirstOption: 'true' }
void invalidSelectSettings
// @ts-expect-error unsupported upload timing
const invalidFileSettings: FileSettings = { upload: { api: 'main', endpoint: 'files', timing: 'never' } }
void invalidFileSettings
const asyncSchema: TungstenSchema = { schemaVersion: 'sprout', form: [{ type: 'file', key: 'attachment', ...fileSettings }, { type: 'select', key: 'choice', ...selectSettings, bindings: { options: { source: 'options' } } }] }
const durableValues: TungstenValues = { attachment: { files: [{ id: 'one', name: 'one.pdf', size: 10, mediaType: 'application/pdf', uploaded: true }] } }
void Tungsten({ schema: asyncSchema, config, dataSources, initialValues: durableValues, onSubmit, onReady: (controller: TungstenController) => { void controller.prepareFiles({ allowInvalid: true }) } })
void TungstenEditor({ initialSchema: asyncSchema, config, dataSources })
const api = new ApiClient(config)
void api.request({ api: 'main', endpoint: 'submit', method: 'POST' }, { operation: 'submit', key: 'form' }, { body: durableValues })


const managedConfig: TungstenConfig = {
  maxProcessingSteps: 1000,
  warnings: 'silent',
  apis: { main: { baseUrl: 'https://example.com/api/' } },
  autosave: { endpoint: { api: 'main', endpoint: 'drafts/42' }, debounceMs: 200, showStatus: false },
  submission: { endpoint: { api: 'main', endpoint: 'forms/42' } },
}
void Tungsten({schema, config: managedConfig}) // Endpoint-only requires no dummy handler.
void Tungsten({
  schema,
  config: managedConfig,
  onSave: async (values, context) => { void values; void context?.revision; void context?.status; void context?.error },
  onDiagnostic: diagnostic => { void diagnostic.severity; void diagnostic.messageKey; void diagnostic.params; void diagnostic.message },
  onReady: controller => { void controller.reset() },
})
// @ts-expect-error Processing limits must be numbers, not strings.
const invalidProcessingLimit: TungstenConfig = {maxProcessingSteps: '100'}
// @ts-expect-error Warnings can only be logged or silenced.
const invalidWarningPolicy: TungstenConfig = {warnings: 'none'}
void [invalidProcessingLimit, invalidWarningPolicy]

const germanName: string = supportedLanguages.de
void germanName
// @ts-expect-error The supported-language inventory is immutable.
supportedLanguages.de = 'Changed'

const colorScheme: TungstenColorScheme = 'dark'
TungstenThemeProvider({ colorScheme, children: null })
Tungsten({ schema, colorScheme })
TungstenEditor({ initialSchema: schema, colorScheme })
void useTungstenColorScheme
// @ts-expect-error System preference is resolved by the application.
const unsupportedScheme: TungstenColorScheme = 'system'
void unsupportedScheme

const bootstrapDesign: TungstenDesign = bootstrap
void Tungsten({ schema, design: bootstrapDesign, colorScheme: 'dark' })

const materialDesign: TungstenDesign = material
void Tungsten({ schema, design: materialDesign, colorScheme: 'dark' })
void TungstenEditor({ initialSchema: schema, design: materialDesign, language: 'de' })
const brandedMaterial: TungstenDesign = createMaterialDesign(mode => ({ palette: { primary: { main: mode === 'dark' ? '#90caf9' : '#1976d2' } } }))
void brandedMaterial

// @ts-expect-error Tungsten owns scoped color schemes; document-wide MUI variables are not adapter options.
createMaterialDesign({ cssVariables: true })

void [MaterialForm, MaterialLoading, MaterialFailure]
