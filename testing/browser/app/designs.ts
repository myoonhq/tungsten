import material from '@myoon/tungsten/react/design/material'
import '@myoon/tungsten/react/design/material.css'
import bootstrap from '@myoon/tungsten/react/design/bootstrap'
import 'bootstrap/dist/css/bootstrap.min.css'
import '@myoon/tungsten/react/design/bootstrap.css'
import tungsten from '@myoon/tungsten/react/design/tungsten'
import '@myoon/tungsten/react/design/tungsten.css'
import type { TungstenDesign } from '@myoon/tungsten/react'

// Only implemented public adapters are registered; all three designs share interaction contracts.
// An unknown design must fail; never silently qualify it using Tungsten's renderer.
export const designs: Record<string, TungstenDesign> = { tungsten, bootstrap, material }
