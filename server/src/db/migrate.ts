import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function migrate() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const migrationsDir = join(__dirname, 'migrations')
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

  for (const file of files) {
    const { rows } = await client.query('SELECT 1 FROM migrations WHERE name = $1', [file])
    if (rows.length > 0) continue

    console.log(`Running migration: ${file}`)
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    await client.query(sql)
    await client.query('INSERT INTO migrations (name) VALUES ($1)', [file])
    console.log(`Done: ${file}`)
  }

  await client.end()
  console.log('All migrations complete.')
}

migrate().catch(err => {
  console.error(err)
  process.exit(1)
})
