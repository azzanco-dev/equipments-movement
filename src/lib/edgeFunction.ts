import { supabase } from '@/lib/supabase'

export type EdgeFunctionErrorCode =
  | 'network'
  | 'sessionExpired'
  | 'forbidden'
  | 'notFound'
  | 'validation'
  | 'server'

export class EdgeFunctionError extends Error {
  constructor(
    public readonly code: EdgeFunctionErrorCode,
    public readonly status?: number,
    public readonly serverCode?: string,
  ) {
    super(code)
    this.name = 'EdgeFunctionError'
  }
}

function errorForStatus(status: number) {
  if (status === 401) return new EdgeFunctionError('sessionExpired', status)
  if (status === 403) return new EdgeFunctionError('forbidden', status)
  if (status === 404) return new EdgeFunctionError('notFound', status)
  if (status >= 400 && status < 500)
    return new EdgeFunctionError('validation', status)
  return new EdgeFunctionError('server', status)
}

async function getAccessToken(forceRefresh: boolean) {
  if (forceRefresh) {
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data.session)
      throw new EdgeFunctionError('sessionExpired', error?.status)
    return data.session.access_token
  }

  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session)
    throw new EdgeFunctionError('sessionExpired', error?.status)
  return data.session.access_token
}

export async function callEdgeFunction<T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let token: string
    try {
      token = await getAccessToken(attempt === 1)
    } catch (error) {
      if (error instanceof EdgeFunctionError) throw error
      throw new EdgeFunctionError('network')
    }

    let response: Response
    try {
      response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${functionName}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        },
      )
    } catch {
      throw new EdgeFunctionError('network')
    }

    if (response.status === 401 && attempt === 0) continue
    if (!response.ok) {
      let serverCode: string | undefined
      try {
        const errorBody = (await response.json()) as { code?: unknown }
        if (typeof errorBody.code === 'string') serverCode = errorBody.code
      } catch {
        // The HTTP status remains enough to show a safe user-facing error.
      }
      const statusError = errorForStatus(response.status)
      throw new EdgeFunctionError(
        statusError.code,
        statusError.status,
        serverCode,
      )
    }

    try {
      return (await response.json()) as T
    } catch {
      throw new EdgeFunctionError('server', response.status)
    }
  }

  throw new EdgeFunctionError('sessionExpired', 401)
}
