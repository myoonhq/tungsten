import type { Logger, Plugin } from 'vite'

export function strictBuildLogger(): Logger
export const vendorChunks: { name: string; test: RegExp }[]
export function javascriptSizeBudget(): Plugin
