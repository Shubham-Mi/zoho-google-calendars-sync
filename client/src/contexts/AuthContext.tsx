import { createContext, useContext, useState, type ReactNode } from 'react'
import { api } from '../lib/api'

interface AuthUser {
  userId: string
}

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

function parseJwt(token: string): AuthUser | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return { userId: payload.userId }
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'))
  const [user, setUser] = useState<AuthUser | null>(token ? parseJwt(token) : null)
  const [isLoading, setIsLoading] = useState(false)

  const login = async (email: string, password: string) => {
    setIsLoading(true)
    try {
      const { data } = await api.post<{ token: string }>('/auth/login', { email, password })
      const parsed = parseJwt(data.token)
      if (!parsed) {
        localStorage.removeItem('token')
        return
      }
      localStorage.setItem('token', data.token)
      setToken(data.token)
      setUser(parsed)
    } finally {
      setIsLoading(false)
    }
  }

  const register = async (email: string, password: string) => {
    setIsLoading(true)
    try {
      const { data } = await api.post<{ token: string }>('/auth/register', { email, password })
      const parsed = parseJwt(data.token)
      if (!parsed) {
        localStorage.removeItem('token')
        return
      }
      localStorage.setItem('token', data.token)
      setToken(data.token)
      setUser(parsed)
    } finally {
      setIsLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem('token')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
