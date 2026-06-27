import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { authRoutes } from '../routes/auth.js'

// Mock bcrypt to speed up tests
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(async (pw: string) => `hashed:${pw}`),
    compare: vi.fn(async (pw: string, hash: string) => hash === `hashed:${pw}`),
  },
}))

// Mock pool
vi.mock('../db/client.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

import { pool } from '../db/client.js'
const mockQuery = pool.query as ReturnType<typeof vi.fn>

describe('POST /api/auth/register', () => {
  const app = Fastify()

  beforeAll(async () => {
    await app.register(fastifyJwt, { secret: 'test-secret' })
    await app.register(authRoutes, { prefix: '/api/auth' })
    await app.ready()
  })

  afterAll(() => app.close())

  it('returns a token on successful registration', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-uuid-123' }] })

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'test@example.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveProperty('token')
  })

  it('returns 409 if email already exists', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'existing@example.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(409)
  })
})

describe('POST /api/auth/login', () => {
  const app = Fastify()

  beforeAll(async () => {
    await app.register(fastifyJwt, { secret: 'test-secret' })
    await app.register(authRoutes, { prefix: '/api/auth' })
    await app.ready()
  })

  afterAll(() => app.close())

  it('returns token for valid credentials', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'user-uuid-123', password_hash: 'hashed:correctpassword' }],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'test@example.com', password: 'correctpassword' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveProperty('token')
  })

  it('returns 401 for wrong password', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'user-uuid-123', password_hash: 'hashed:correctpassword' }],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'test@example.com', password: 'wrongpassword' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('returns 401 if user not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: 'password' },
    })

    expect(res.statusCode).toBe(401)
  })
})
