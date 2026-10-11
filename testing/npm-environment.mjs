/** pnpm's private environment settings are not npm configuration options. */
export function npmEnvironment(source = process.env) {
  const env = { ...source }
  for (const key of Object.keys(env)) {
    if (/^npm_config_(?:recursive|verify_deps_before_run|.+[:_-]registry)$/i.test(key))
      delete env[key]
  }
  return env
}
