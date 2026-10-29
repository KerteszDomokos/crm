import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryEnvFile = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env')

/** Load the repository-local .env for development without overriding real env vars. */
export function loadLocalEnv(): void {
  if (existsSync(repositoryEnvFile)) process.loadEnvFile(repositoryEnvFile)
}
