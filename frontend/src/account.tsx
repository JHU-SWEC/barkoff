import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// The signed-in player. Elo and the win/loss record come from Postgres;
// solo barks and calibration still live in this browser.
export interface Account {
  id: string
  email: string
  displayName: string
  elo: number
  wins: number
  losses: number
}

const UNREACHABLE = 'The server isn’t reachable. Start it with python backend/server.py.'

async function post(path: string, body?: unknown): Promise<Account | null> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error(UNREACHABLE)
  }
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw new Error(payload?.error ?? UNREACHABLE)
  return (payload?.account as Account | undefined) ?? null
}

export async function fetchAccount(): Promise<Account | null> {
  let res: Response
  try {
    res = await fetch('/api/me')
  } catch {
    return null
  }
  if (!res.ok) return null
  const payload = await res.json().catch(() => null)
  return (payload?.account as Account | undefined) ?? null
}

export function registerAccount(email: string, password: string, displayName: string) {
  return post('/api/register', { email, password, displayName })
}

export function loginAccount(email: string, password: string) {
  return post('/api/login', { email, password })
}

export function logoutAccount() {
  return post('/api/logout')
}

export async function saveDisplayName(displayName: string): Promise<Account> {
  let res: Response
  try {
    res = await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    })
  } catch {
    throw new Error(UNREACHABLE)
  }
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.account) throw new Error(payload?.error ?? UNREACHABLE)
  return payload.account as Account
}

interface AccountContextValue {
  account: Account | null
  ready: boolean
  setAccount: (account: Account | null) => void
}

const AccountContext = createContext<AccountContextValue | null>(null)

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    fetchAccount().then((next) => {
      setAccount(next)
      setReady(true)
    })
  }, [])

  return <AccountContext.Provider value={{ account, ready, setAccount }}>{children}</AccountContext.Provider>
}

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext)
  if (!value) throw new Error('useAccount must be used inside AccountProvider')
  return value
}
