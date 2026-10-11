import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { inputIds } from './input-ids.js'
import { TungstenLang } from './i18n.js'
import { fieldsOf, fieldTypeOf, isGroup, isRepeater } from '../../../api/src/types.js'
import { FormViewStore, type ErrorCounts, type ViewLayout } from './view-store.js'
import type {
  FormState,
  GroupRevealRequest,
  GroupSection,
  RepeaterSection,
  ScalarValue,
  TungstenComponent,
  TungstenDesign,
  TungstenField,
  TungstenGroup,
  TungstenRepeater,
  TungstenSchema,
} from './types.js'
import type { RepeaterOperation } from '../../../api/src/engine/protocol.js'

type ViewContext = {
  store: FormViewStore
  layout: ViewLayout
  design: TungstenDesign
  instanceId: string
  busy: boolean
  reveal: GroupRevealRequest | null
  onChange: (field: TungstenField, value: ScalarValue) => void | Promise<void>
  onFiles: (field: TungstenField, files: readonly File[]) => void
  onStructure: (operation: RepeaterOperation) => void
  onRetry: (field: TungstenField, upload?: boolean) => void
}
type Props = Omit<ViewContext, 'layout'> & {
  schema: TungstenSchema
  repeaters: FormState['repeaters']
}

const ViewContext = createContext<ViewContext | null>(null)
function useViewContext(): ViewContext {
  const context = useContext(ViewContext)
  if (!context) throw new Error('Form views require their context')
  return context
}

/** Cache structure separately from temporary busy/reveal/design inputs. */
export const FormView = memo(function FormView({ schema, repeaters, ...props }: Props) {
  const content = useMemo(
    () => buildLayout(schema, repeaters, props.store, props.instanceId),
    [schema, repeaters, props.store, props.instanceId],
  )
  return (
    <ViewContext.Provider value={{ ...props, layout: repeaters ?? null }}>
      {content}
    </ViewContext.Provider>
  )
})
// React clones sibling fibers even when leaf components bail out. A bounded
// logical tree limits that traversal for large static field lists. Fragments
// add no DOM; repeated row identity remains owned by the repeater renderer.
const ViewBranch = memo(function ViewBranch({ children }: { children: ReactNode }) {
  return <>{children}</>
})
function branch(children: readonly ReactNode[]): ReactNode {
  if (children.length <= 64) return children
  const branches: ReactNode[] = []
  for (let i = 0; i < children.length; i += 64)
    branches.push(<ViewBranch key={i}>{branch(children.slice(i, i + 64))}</ViewBranch>)
  return branch(branches)
}

function buildLayout(
  schema: TungstenSchema,
  repeaters: FormState['repeaters'],
  store: FormViewStore,
  instanceId: string,
): ReactNode {
  const context = { store, instanceId, layout: repeaters ?? null }
  const state = store.snapshot(context.layout)
  const ids = inputIds(schema, state, instanceId)
  const keysIn = (form: readonly TungstenComponent[]) =>
    fieldsOf(form, state).map((field) => field.key)
  function render(component: TungstenComponent): ReactNode {
    const key = component.key.includes('].') ? component.key.split('].').at(-1)! : component.key
    if (isRepeater(component)) {
      const collection = repeaters?.[component.key]
      if (!collection) return <MissingRepeater key={key} fieldKey={component.key} />
      const instances = collection.instances.map((instance) => ({
        id: instance.id,
        label: instance.label,
        fieldKeys: keysIn(instance.form),
        errorCount: 0,
        content: branch(instance.form.map(render)),
      }))
      const counts = context.store.errorCounts(
        instances.map((instance) => instance.fieldKeys),
        context.layout,
      )
      return (
        <RepeaterView
          key={key}
          repeater={component}
          state={collection}
          instances={instances}
          counts={counts}
        />
      )
    }
    if (isGroup(component)) {
      const sections =
        component.variant === 'sectioned'
          ? component.subform.map((child) => {
              if (!isGroup(child))
                throw new Error(
                  JSON.stringify({ messageKey: 'tg_ui_invalid_compiled_section', params: {} }),
                )
              return {
                group: child,
                id: `tungsten-${context.instanceId}-section-${child.key}`,
                label: child.view?.label ?? child.key,
                fieldKeys: keysIn(child.subform),
                errorCount: 0,
                content: render(child),
              }
            })
          : []
      const counts = context.store.errorCounts(
        [keysIn(component.subform), ...sections.map((section) => section.fieldKeys)],
        context.layout,
      )
      return (
        <GroupView key={key} group={component} sections={sections} counts={counts}>
          {component.variant === 'sectioned' ? null : branch(component.subform.map(render))}
        </GroupView>
      )
    }
    return <FieldView key={key} field={component} inputId={ids.get(component.key)!} />
  }
  return <>{branch(schema.form.map(render))}</>
}

function MissingRepeater({ fieldKey }: { fieldKey: string }) {
  const { design } = useViewContext()
  return (
    <design.Failure
      message={{ messageKey: 'tg_ui_missing_repeater_state', params: { key: fieldKey } }}
    />
  )
}

function FieldView({ field, inputId }: { field: TungstenField; inputId: string }) {
  const context = useViewContext()
  const { store, design, busy, onChange, onFiles, onRetry: retry } = context
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(field.key, listener),
    [store, field.key],
  )
  const read = useCallback(
    () => store.field(field.key, context.layout),
    [store, field.key, context.layout],
  )
  const state = useSyncExternalStore(subscribe, read, read)
  const onValueChange = useCallback(
    (value: ScalarValue) => onChange(field, value),
    [onChange, field],
  )
  const onFilesChange = useCallback(
    (files: readonly File[]) => onFiles(field, files),
    [onFiles, field],
  )
  const onRetry = useCallback(() => retry(field), [retry, field])
  if (!state)
    return (
      <design.Failure
        message={{ messageKey: 'tg_ui_missing_field_state', params: { key: field.key } }}
      />
    )
  if (state.hidden) return null
  const type = fieldTypeOf(field)
  const Renderer = design.fields[type]
  return (
    <div>
      {(state.loadingSources?.length ?? 0) > 0 && !design.loadingIndicators?.includes(type) ? (
        <p role="status">
          <TungstenLang>tg_ui_loading_data</TungstenLang>
        </p>
      ) : null}
      {Object.keys(state.sourceErrors ?? {}).length > 0 ? (
        <div className="tg-source-error" role="alert">
          <span>
            {Object.values(state.sourceErrors!).map((error, index) => (
              <TungstenLang key={index}>{error}</TungstenLang>
            ))}
          </span>{' '}
          <button
            type="button"
            disabled={busy || !!state.loadingSources?.length}
            onClick={() => context.onRetry(field, false)}
          >
            <TungstenLang>tg_ui_retry_loading</TungstenLang>
          </button>
        </div>
      ) : null}
      <FieldRenderer
        Renderer={Renderer}
        field={field}
        state={state}
        inputId={inputId}
        required={field.validators?.some((validator) => validator.kind === 'required') ?? false}
        disabled={!!state.disabled || busy || !!state.loadingSources?.length || !!state.uploading}
        readOnly={!!state.readOnly}
        onValueChange={onValueChange}
        onFilesChange={onFilesChange}
        onRetry={onRetry}
      />
    </div>
  )
}

// Context changes still reach FieldView (busy/reveal/design). Unchanged renderer
// props can stop there; language consumers retain their normal context updates.
const FieldRenderer = memo(function FieldRenderer({
  Renderer,
  ...props
}: import('./types.js').FieldRendererProps & { Renderer: TungstenDesign['fields'][string] }) {
  return <Renderer {...props} />
})

function GroupView({
  group,
  sections,
  counts,
  children,
}: {
  group: TungstenGroup
  sections: readonly GroupSection[]
  counts: ErrorCounts
  children: ReactNode
}) {
  const context = useViewContext()
  const errors = useSyncExternalStore(counts.subscribe, counts.snapshot, counts.snapshot)
  const Renderer = context.design.groups![group.render.type].Renderer
  return (
    <Renderer
      group={group}
      groupId={`tungsten-${context.instanceId}-group-${group.key}`}
      disabled={context.busy}
      reveal={context.reveal}
      errorCount={errors[0]}
      sections={sections.map((section, index) => ({ ...section, errorCount: errors[index + 1] }))}
    >
      {children}
    </Renderer>
  )
}

function RepeaterView({
  repeater,
  state,
  instances,
  counts,
}: {
  repeater: TungstenRepeater
  state: NonNullable<FormState['repeaters']>[string]
  instances: readonly RepeaterSection[]
  counts: ErrorCounts
}) {
  const context = useViewContext()
  const errors = useSyncExternalStore(counts.subscribe, counts.snapshot, counts.snapshot)
  const Renderer = context.design.repeaters![repeater.render.type]
  return (
    <Renderer
      repeater={repeater}
      state={state}
      repeaterId={`tungsten-${context.instanceId}-repeater-${repeater.key}`}
      disabled={context.busy}
      reveal={context.reveal}
      instances={instances.map((instance, index) => ({ ...instance, errorCount: errors[index] }))}
      onAdd={() => context.onStructure({ kind: 'add', key: repeater.key })}
      onRemove={(index) => context.onStructure({ kind: 'remove', key: repeater.key, index })}
      onReorder={(from, to) =>
        context.onStructure({ kind: 'reorder', key: repeater.key, from, to })
      }
    />
  )
}
