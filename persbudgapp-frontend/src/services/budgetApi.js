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

const transactionCategoryToApiCategory = {
  'Housing/Rent': 'Housing',
  'Other Income': 'Other',
}

const transactionApiCategoryToUiCategory = {
  Housing: 'Housing/Rent',
}

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

function parseUserPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid authenticated user response from backend.')
  }

  const user = payload.user ?? payload?.data?.user ?? payload
  if (!user || typeof user !== 'object') {
    throw new Error('Authenticated user details were not returned by backend.')
  }

  return user
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

export async function fetchAuthenticatedUser() {
  const payload = await requestJson('/auth/me')
  return parseUserPayload(payload)
}

function normalizeTransactionShape(transaction) {
  if (!transaction || typeof transaction !== 'object') {
    return transaction
  }

  const rawCategory = typeof transaction.category === 'string' ? transaction.category.trim() : ''
  const normalizedCategory = transactionApiCategoryToUiCategory[rawCategory] || rawCategory

  return {
    ...transaction,
    id: transaction.id ?? transaction._id,
    category: normalizedCategory,
    amount: Number.isFinite(Number(transaction.amount)) ? Number(transaction.amount) : 0,
    note:
      typeof transaction.note === 'string'
        ? transaction.note
        : typeof transaction.description === 'string'
          ? transaction.description
          : '',
    date: typeof transaction.date === 'string' ? transaction.date.slice(0, 10) : transaction.date,
  }
}

function toApiTransactionCategory(category) {
  if (typeof category !== 'string') {
    return category
  }

  const normalizedCategory = category.trim()
  if (!normalizedCategory) {
    return normalizedCategory
  }

  return transactionCategoryToApiCategory[normalizedCategory] || normalizedCategory
}

function toTransactionRequestPayload(transaction) {
  return {
    type: transaction?.type,
    category: toApiTransactionCategory(transaction?.category),
    amount: transaction?.amount,
    date: transaction?.date,
    note: transaction?.note,
  }
}

export async function fetchTransactions() {
  const payload = await requestJson('/transactions')
  const transactionItems = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : []

  if (!Array.isArray(transactionItems)) {
    return []
  }

  return transactionItems.map(normalizeTransactionShape)
}

function extractMonthKey(dateValue) {
  if (typeof dateValue !== 'string' || dateValue.trim().length === 0) {
    return ''
  }

  const normalizedDate = new Date(dateValue)
  if (Number.isNaN(normalizedDate.getTime())) {
    return ''
  }

  return normalizedDate.toISOString().slice(0, 7)
}

function normalizeBudgetShape(budget) {
  if (!budget || typeof budget !== 'object') {
    return budget
  }

  const normalizedName =
    typeof budget.name === 'string' && budget.name.trim().length > 0
      ? budget.name
      : typeof budget.category === 'string'
        ? budget.category
        : ''

  const month =
    typeof budget.month === 'string' && budget.month.trim().length > 0
      ? budget.month
      : extractMonthKey(budget.startDate) || new Date().toISOString().slice(0, 7)
  const amount = Number.isFinite(Number(budget.amount))
    ? Number(budget.amount)
    : Number.isFinite(Number(budget.limit))
      ? Number(budget.limit)
      : 0

  return {
    ...budget,
    id: budget.id ?? budget._id,
    name: normalizedName,
    category: normalizedName,
    month,
    amount,
    limit: amount,
  }
}

function toBudgetRequestPayload(budget) {
  const budgetName =
    typeof budget?.name === 'string' && budget.name.trim().length > 0
      ? budget.name
      : budget?.category

  const amount = Number.isFinite(Number(budget?.amount))
    ? Number(budget.amount)
    : Number.isFinite(Number(budget?.limit))
      ? Number(budget.limit)
      : 0
  const month =
    typeof budget?.month === 'string' && budget.month.trim().length > 0
      ? budget.month
      : ''

  return {
    name: budgetName,
    category: budget?.category,
    amount,
    period: budget?.period,
    startDate: month ? `${month}-01` : budget?.startDate,
    endDate: budget?.endDate,
    notes: budget?.notes,
  }
}

export async function fetchBudgets() {
  const payload = await requestJson('/budgets')
  const budgetItems = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : []

  if (!Array.isArray(budgetItems)) {
    return []
  }

  return budgetItems.map(normalizeBudgetShape)
}

export function createTransaction(transaction) {
  return requestJson('/transactions', {
    method: 'POST',
    body: JSON.stringify(toTransactionRequestPayload(transaction)),
  }).then(normalizeTransactionShape)
}

export function updateTransaction(transactionId, transaction) {
  return requestJson(`/transactions/${transactionId}`, {
    method: 'PUT',
    body: JSON.stringify(toTransactionRequestPayload(transaction)),
  }).then(normalizeTransactionShape)
}

export function deleteTransaction(transactionId) {
  return requestJson(`/transactions/${transactionId}`, {
    method: 'DELETE',
  })
}

export function createBudget(budget) {
  return requestJson('/budgets', {
    method: 'POST',
    body: JSON.stringify(toBudgetRequestPayload(budget)),
  }).then(normalizeBudgetShape)
}

export function updateBudget(budgetId, budget) {
  return requestJson(`/budgets/${budgetId}`, {
    method: 'PUT',
    body: JSON.stringify(toBudgetRequestPayload(budget)),
  }).then(normalizeBudgetShape)
}