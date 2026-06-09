const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''

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

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

function parseAuthPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid authentication response from backend.')
  }

  const token = payload.token || payload.accessToken || payload.jwt
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Backend did not return a JWT token.')
  }

  return {
    token,
    user: payload.user ?? null,
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

  return parseAuthPayload(payload)
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