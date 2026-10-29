import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createImportPlan } from './importer.ts'

async function main(): Promise<void> {
  const directory = resolve(process.argv[2] ?? '../../data')
  const [people, companies, notes] = await Promise.all([
    readFile(resolve(directory, 'person.csv'), 'utf8'),
    readFile(resolve(directory, 'company.csv'), 'utf8'),
    readFile(resolve(directory, 'note.csv'), 'utf8'),
  ])
  const plan = createImportPlan({ people, companies, notes })
  process.stdout.write(`${JSON.stringify({
    summary: plan.summary,
    duplicateCandidates: plan.duplicateCandidates,
    issues: plan.issues,
  }, null, 2)}\n`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Import dry run failed: ${message}\n`)
  process.exitCode = 1
})
