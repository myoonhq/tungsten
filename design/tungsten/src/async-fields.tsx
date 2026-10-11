import { useRendererClasses, useRendererComponents } from './appearance.js'
import { TungstenLang, useTungstenLang } from '../../../framework/react/src/i18n.js'
import type { FieldRendererProps } from '../../../framework/react/src/types.js'
import type { FileSettings } from '../../../api/src/types.js'
import { TungstenFieldShell, describedBy } from './field-shell.js'

function FileIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </svg>
  )
}

function formatFileSize(bytes: number, language: string): string {
  const unit = bytes < 1024 ? 'B' : bytes < 1024 * 1024 ? 'KB' : 'MB'
  const amount = unit === 'B' ? bytes : bytes / (unit === 'KB' ? 1024 : 1024 * 1024)
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(amount)} ${unit}`
}

export { TungstenSelectField } from './select-field.js'

export function TungstenFileField({
  field,
  state,
  inputId,
  required,
  disabled,
  readOnly,
  onFilesChange,
  onValueChange,
  onRetry,
}: FieldRendererProps) {
  const classes = useRendererClasses()
  const { Button } = useRendererComponents()
  const { t, language } = useTungstenLang()
  if (!state.value || typeof state.value !== 'object' || Array.isArray(state.value))
    throw new TypeError(
      JSON.stringify({
        messageKey: 'tg_ui_file_expects_a_file_reference_object',
        params: {},
      }),
    )
  const settings = field as typeof field & FileSettings
  const errors = state.uploadError ? [...state.errors, state.uploadError] : state.errors
  const files = state.value.files
  const inactive = disabled || readOnly
  const constraints = [
    settings.accept?.join(', '),
    settings.multiple && settings.maxFiles
      ? t('tg_ui_file_limit', { count: settings.maxFiles })
      : !settings.multiple
        ? t('tg_ui_one_file')
        : null,
    settings.maxSize
      ? t(settings.multiple ? 'tg_ui_file_size_each' : 'tg_ui_file_size_max', {
          size: formatFileSize(settings.maxSize, language),
        })
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const hintId = `${inputId}-file-hint`
  return (
    <TungstenFieldShell
      inputId={inputId}
      view={field.view}
      fallbackLabel={field.key}
      required={required}
      errors={errors}
    >
      <div
        className={classes('tg-file-picker')}
        data-disabled={inactive}
        data-invalid={errors.length > 0}
      >
        <input
          className={classes('tg-file-input')}
          id={inputId}
          name={field.key}
          type="file"
          multiple={settings.multiple}
          accept={settings.accept?.join(',')}
          disabled={disabled}
          aria-disabled={readOnly || undefined}
          aria-invalid={errors.length > 0}
          aria-describedby={[hintId, describedBy(inputId, field.view, errors)]
            .filter(Boolean)
            .join(' ')}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? [])
            if (!inactive && selected.length > 0) onFilesChange?.(selected)
            event.target.value = ''
          }}
          onClick={(event) => {
            if (readOnly) event.preventDefault()
          }}
          onKeyDown={(event) => {
            if (readOnly && ['Enter', ' '].includes(event.key)) event.preventDefault()
          }}
        />
        <span className={classes('tg-file-picker-icon')}>
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 16V3m-5 5 5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          </svg>
        </span>
        <span className={classes('tg-file-picker-copy')}>
          <span className={classes('tg-file-picker-title')}>
            <TungstenLang>
              {files.length > 0 ? 'tg_ui_replace_selected_files' : 'tg_ui_attach_your_files'}
            </TungstenLang>
          </span>
          <span className={classes('tg-file-hint')} id={hintId}>
            {constraints || <TungstenLang>tg_ui_browse_files_on_your_device</TungstenLang>}
          </span>
        </span>
        <span className={classes('tg-file-browse')} aria-hidden="true">
          <TungstenLang>{files.length > 0 ? 'tg_ui_replace' : 'tg_ui_browse'}</TungstenLang>
        </span>
      </div>
      {files.length > 0 ? (
        <ul className={classes('tg-file-list')}>
          {files.map((file) => (
            <li className={classes('tg-file-item')} key={file.id}>
              <span className={classes('tg-file-item-icon')}>
                <FileIcon />
              </span>
              <span className={classes('tg-file-info')}>
                <span className={classes('tg-file-name')} title={file.name}>
                  {file.name}
                </span>
                <span className={classes('tg-file-size')}>
                  {formatFileSize(file.size, language)}
                </span>
              </span>
              <span
                role="status"
                className={classes(
                  `tg-file-status${file.uploaded ? ' tg-file-status--uploaded' : ''}`,
                )}
              >
                {state.uploading && !file.uploaded ? (
                  <span className={classes('tg-spinner')} aria-hidden="true" />
                ) : null}
                <TungstenLang>
                  {file.uploaded
                    ? 'tg_ui_uploaded'
                    : state.uploading
                      ? 'tg_ui_uploading'
                      : 'tg_ui_pending_upload'}
                </TungstenLang>
              </span>
              <Button
                className={classes('tg-file-remove')}
                type="button"
                aria-label={t('tg_ui_remove', { label: file.name })}
                disabled={inactive}
                onClick={() => onValueChange({ files: files.filter((f) => f.id !== file.id) })}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="m6 6 12 12M6 18 18 6" />
                </svg>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {state.uploadError ? (
        <Button
          className={classes('tg-file-retry')}
          type="button"
          onClick={onRetry}
          disabled={inactive}
        >
          <TungstenLang>tg_ui_retry_upload</TungstenLang>
        </Button>
      ) : null}
    </TungstenFieldShell>
  )
}
