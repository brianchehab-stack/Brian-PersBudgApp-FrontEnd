const configuredBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim() || import.meta.env.VITE_API_URL?.trim() || ''

function isLocalHostName(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function parseCandidateBaseUrl(candidate, runningInBrowser) {
  const trimmedCandidate = candidate.trim() 
  if (!trimmedCandidate) {
    return null
  }

  try {
    const parsedUrl = new URL(trimmedCandidate)

    // Ignore localhost API URLs when the app itself is hosted remotely.
    if (runningInBrowser && !isLocalHostName(window.location.hostname) && isLocalHostName(parsedUrl.hostname)) {
      return null
    }

    return parsedUrl.href.replace(/\/+$/, '')
  } catch {
    if (trimmedCandidate.startsWith('/')) {
      return trimmedCandidate.replace(/\/+$/, '')
    }

    return null
  }
}

function resolveApiBaseUrl(rawValue) {
  const trimmedValue = rawValue.trim()
  if (!trimmedValue) {
    return {
      apiBaseUrl: '',
      warning: 'Backend URL is not configured. Set VITE_API_BASE_URL to your backend /api URL.',
    }
  }

  const runningInBrowser = typeof window !== 'undefined'
  const candidates = trimmedValue.includes(',')
    ? trimmedValue
      .split(',')
      .map((candidate) => candidate.trim())
      .filter(Boolean)
    : [trimmedValue]

  const parsedCandidates = candidates
    .map((candidate) => parseCandidateBaseUrl(candidate, runningInBrowser))
    .filter(Boolean)

  if (parsedCandidates.length > 0) {
    return {
      // If multiple URLs are provided, prefer the last one (usually backend URL in host configs).
      apiBaseUrl: parsedCandidates[parsedCandidates.length - 1],
      warning:
        candidates.length > 1
          ? 'Multiple API URLs were detected. Using the last valid URL. Keep only one VITE_API_BASE_URL value.'
          : '',
    }
  }

  if (runningInBrowser && !isLocalHostName(window.location.hostname) && trimmedValue.includes('localhost')) {
    return {
      apiBaseUrl: '',
      warning:
        'Backend URL points to localhost, which is unreachable from this deployed app. Set VITE_API_BASE_URL to your live backend /api URL.',
    }
  }

  return {
    apiBaseUrl: '',
    warning:
      'Backend URL should be an absolute URL (https://...) or a same-origin path (/api). Check VITE_API_BASE_URL.',
  }
}

const resolvedApiConfig = resolveApiBaseUrl(configuredBaseUrl)
const apiBaseUrl = resolvedApiConfig.apiBaseUrl
export const apiConfigurationWarning = resolvedApiConfig.warning

export const isBackendConfigured = apiBaseUrl.length > 0
let authToken = ''

export function setApiAuthToken(token) {
  authToken = typeof token === 'string' ? token : ''
}

function buildUrl(path) {
  if (!isBackendConfigured) {
    throw new Error('VITE_API_BASE_URL is not configured.')
  }

  return `${apiBaseUrl}${path}`
}

function buildApiFallbackUrl(path) {
  if (!isBackendConfigured || path.startsWith('/api/')) {
    return null
  }

  try {
    const parsedBase = new URL(apiBaseUrl)

    // Only fallback when the configured base URL is host root (no path prefix).
    if (parsedBase.pathname !== '/' && parsedBase.pathname !== '') {
      return null
    }

    return `${parsedBase.origin}/api${path}`
  } catch {
    return null
  }
}

async function requestJson(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  }

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }

  const response = await fetch(buildUrl(path), {
    headers,
    ...options,
  })

  if (response.status === 404) {
    const fallbackUrl = buildApiFallbackUrl(path)
    if (fallbackUrl) {
      const fallbackResponse = await fetch(fallbackUrl, {
        headers,
        ...options,
      })

      if (!fallbackResponse.ok) {
        const message = await fallbackResponse.text().catch(() => '')
        throw new Error(message || `Request failed with status ${fallbackResponse.status}`)
      }

      if (fallbackResponse.status === 204) {
        return null
      }

      return fallbackResponse.json()
    }
  }

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

function parseAuthPayload(payload, options = {}) {
  const { requireToken = true } = options

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid authentication response from backend.')
  }

  const tokenCandidate =
    payload.token ||
    payload.accessToken ||
    payload.jwt ||
    payload?.data?.token ||
    payload?.data?.accessToken ||
    payload?.data?.jwt
  const token = typeof tokenCandidate === 'string' ? tokenCandidate : ''

  if (requireToken && token.length === 0) {
    throw new Error('Backend did not return a JWT token.')
  }

  return {
    token,
    user: payload.user ?? payload?.data?.user ?? null,
  }
}

export async function loginUser(credentials) {
  const payload = await requestJson('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })

  return parseAuthPayload(payload)
}

export async function registerUser(account) {
  const payload = await requestJson('/auth/register', {
    method: 'POST',
    body: JSON.stringify(account),
  })

  return parseAuthPayload(payload, { requireToken: false })
}

export function fetchTransactions() {
  return requestJson('/transactions')
}

export function fetchBudgets() {
  return requestJson('/budgets')
}

export function createTransaction(transaction) {
  return requestJson('/transactions', {
    method: 'POST',
    body: JSON.stringify(transaction),
  })
}

export function updateTransaction(transactionId, transaction) {
  return requestJson(`/transactions/${transactionId}`, {
    method: 'PUT',
    body: JSON.stringify(transaction),
  })
}

export function deleteTransaction(transactionId) {
  return requestJson(`/transactions/${transactionId}`, {
    method: 'DELETE',
  })
}

export function createBudget(budget) {
  return requestJson('/budgets', {
    method: 'POST',
    body: JSON.stringify(budget),
  })
}

export function updateBudget(budgetId, budget) {
  return requestJson(`/budgets/${budgetId}`, {
    method: 'PUT',
    body: JSON.stringify(budget),
  })
}