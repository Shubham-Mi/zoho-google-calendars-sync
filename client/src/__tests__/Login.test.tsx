import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Login } from '../pages/Login'

const mockLogin = vi.fn()
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin, isLoading: false }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderLogin() {
  return render(<MemoryRouter><Login /></MemoryRouter>)
}

describe('Login page', () => {
  it('renders email and password fields', () => {
    renderLogin()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('calls login and redirects on success', async () => {
    mockLogin.mockResolvedValueOnce(undefined)
    renderLogin()
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123'))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'))
  })

  it('shows error message on failed login', async () => {
    mockLogin.mockRejectedValueOnce({ response: { data: { error: 'Invalid credentials' } } })
    renderLogin()
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'bad@example.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    await waitFor(() => expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument())
  })
})
