import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { TungstenFileField } from '../../../design/tungsten/src/async-fields.js'
import type { FieldRendererProps } from './types.js'

it('keeps the upload spinner in the status badge and preserves the file row structure', () => {
  const file = {
    id: 'local-1',
    name: 'notes.txt',
    size: 128,
    mediaType: 'text/plain',
    uploaded: false,
  }
  const props: FieldRendererProps = {
    field: { type: 'file', key: 'files', view: { label: 'Attachments' } },
    inputId: 'files',
    required: false,
    disabled: false,
    readOnly: false,
    onValueChange: vi.fn(),
    state: { value: { files: [file] }, errors: [], hidden: false },
  }
  const { container, rerender } = render(<TungstenFileField {...props} />)
  const children = container.querySelector('.tg-field')?.childElementCount
  expect(screen.getByRole('status')).toHaveTextContent('Pending upload')
  rerender(<TungstenFileField {...props} state={{ ...props.state, uploading: true }} />)
  expect(screen.getByRole('status')).toHaveTextContent('Uploading')
  expect(screen.getByRole('status').querySelector('.tg-spinner')).toBeInTheDocument()
  expect(container.querySelector('.tg-file-progress')).not.toBeInTheDocument()
  expect(container.querySelector('.tg-field')?.childElementCount).toBe(children)
  rerender(
    <TungstenFileField
      {...props}
      state={{ ...props.state, value: { files: [{ ...file, uploaded: true }] } }}
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent('Uploaded')
  expect(container.querySelector('.tg-spinner')).not.toBeInTheDocument()
  expect(container.querySelector('.tg-field')?.childElementCount).toBe(children)
})
