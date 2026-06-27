import { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcrypt'
import { pool } from '../db/client.js'

interface AuthBody {
  email: string
  password: string
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: AuthBody }>('/register', async (request, reply) => {
    const { email, password } = request.body
    const hash = await bcrypt.hash(password, 12)
    try {
      const { rows } = await pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
        [email, hash]
      )
      const token = app.jwt.sign({ userId: rows[0].id }, { expiresIn: '7d' })
      return { token }
    } catch (err: any) {
      if (err.code === '23505') {
        return reply.status(409).send({ error: 'Email already registered' })
      }
      throw err
    }
  })

  app.post<{ Body: AuthBody }>('/login', async (request, reply) => {
    const { email, password } = request.body
    const { rows } = await pool.query(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [email]
    )
    if (!rows[0]) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }
    const valid = await bcrypt.compare(password, rows[0].password_hash)
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }
    const token = app.jwt.sign({ userId: rows[0].id }, { expiresIn: '7d' })
    return { token }
  })
}
