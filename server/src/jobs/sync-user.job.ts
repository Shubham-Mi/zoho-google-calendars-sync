import { PgBoss } from 'pg-boss'
import { syncUser } from '../services/sync-engine.js'
import { pool } from '../db/client.js'

const JOB_NAME = 'sync-user'

export async function createBoss(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString })
  await boss.start()
  return boss
}

export async function startScheduler(boss: PgBoss): Promise<void> {
  await boss.work<{ userId: string }>(JOB_NAME, { localConcurrency: 5 }, async (jobs) => {
    for (const job of jobs) {
      await syncUser(job.data.userId)
    }
  })

  // Every 5 minutes: enqueue jobs for all fully-connected users
  await boss.schedule(
    'enqueue-all-users',
    '*/5 * * * *',
    {},
    { singletonKey: 'enqueue-all-users' }
  )

  await boss.work('enqueue-all-users', async () => {
    const { rows } = await pool.query(`
      SELECT u.id
      FROM users u
      INNER JOIN zoho_connections zc ON zc.user_id = u.id
      INNER JOIN google_connections gc ON gc.user_id = u.id
      WHERE EXISTS (
        SELECT 1 FROM google_calendars WHERE user_id = u.id AND enabled = true
      )
    `)
    for (const row of rows) {
      await boss.send(JOB_NAME, { userId: row.id }, { retryLimit: 3, retryDelay: 60 })
    }
  })
}

export async function enqueueSyncForUser(boss: PgBoss, userId: string): Promise<string | null> {
  return boss.send(JOB_NAME, { userId }, { retryLimit: 3, retryDelay: 60 })
}
