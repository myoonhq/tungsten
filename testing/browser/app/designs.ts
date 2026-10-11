import material from '@myoonhq/tungsten/react/design/material'
import '@myoonhq/tungsten/react/design/material.css'
import bootstrap from '@myoonhq/tungsten/react/design/bootstrap'
import 'bootstrap/dist/css/bootstrap.min.css'
import '@myoonhq/tungsten/react/design/bootstrap.css'
import tungsten from '@myoonhq/tungsten/react/design/tungsten'
import '@myoonhq/tungsten/react/design/tungsten.css'
import type { TungstenDesign } from '@myoonhq/tungsten/react'

// Only implemented public adapters are registered; all three designs share interaction contracts.
// An unknown design must fail; never silently qualify it using Tungsten's renderer.
export const designs: Record<string, TungstenDesign> = { tungsten, bootstrap, material }
