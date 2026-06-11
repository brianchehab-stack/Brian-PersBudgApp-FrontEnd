import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  createBudget,
  createTransaction,
  deleteTransaction,
  fetchAuthenticatedUser,
  fetchBudgets,
  fetchTransactions,
  apiConfigurationWarning,
  isBackendConfigured,
  loginUser,
  registerUser,
  setApiAuthToken,
  updateBudget,
  updateTransaction,
} from './services/budgetApi'
import './App.css'

const authStorageKey = 'persbudgapp-jwt-token'
const entriesStorageKey = 'entries'
const entriesUsersBucketKey = 'users'
const budgetAlertThreshold = 0.8

const expenseCategories = [
  'Food',
  'Housing/Rent',
  'Transportation',
  'Entertainment',
  'Bills',
  'Shopping',
  'Health',
  'Education',
  'Other',
]

const incomeCategories = ['Salary', 'Freelance', 'Gift', 'Investment', 'Other Income']

const expenseCategoryColors = {
  Food: '#ef4444',
  'Housing/Rent': '#f97316',
  Transportation: '#f59e0b',
  Entertainment: '#eab308',
  Bills: '#22c55e',
  Shopping: '#14b8a6',
  Health: '#06b6d4',
  Education: '#3b82f6',
  Other: '#64748b',
}

function getCurrentMonthKey(date = new Date()) {
  return date.toISOString().slice(0, 7)
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(dateString) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(dateString))
}

function getDisplayFirstName(user) {
  if (!user || typeof user !== 'object') {
    return 'there'
  }

  const firstName = typeof user.firstName === 'string' ? user.firstName.trim() : ''
  if (firstName) {
    return firstName
  }

  const fullName = typeof user.name === 'string' ? user.name.trim() : ''
  if (fullName) {
    return fullName.split(/\s+/)[0] || fullName
  }

  const email = typeof user.email === 'string' ? user.email.trim() : ''
  if (email) {
    return email.split('@')[0] || email
  }

  return 'there'
}

function getSpeechRecognitionConstructor() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

function normalizeVoiceDate(candidate) {
  if (typeof candidate !== 'string') {
    return ''
  }

  const parsedDate = new Date(candidate.trim())
  if (Number.isNaN(parsedDate.getTime())) {
    return ''
  }

  return parsedDate.toISOString().slice(0, 10)
}

function resolveVoiceTransactionCategory(transcript) {
  const normalizedTranscript = transcript.toLowerCase()

  const categoryAliases = [
    { category: 'Other Income', aliases: ['other income', 'misc income'] },
    { category: 'Housing/Rent', aliases: ['housing/rent', 'housing rent', 'house rent', 'housing', 'rent'] },
    { category: 'Transportation', aliases: ['transportation', 'transport', 'commute'] },
    { category: 'Entertainment', aliases: ['entertainment', 'movie', 'movies', 'fun'] },
    { category: 'Bills', aliases: ['bills', 'utilities', 'utility', 'bill'] },
    { category: 'Shopping', aliases: ['shopping', 'purchase', 'shop'] },
    { category: 'Investment', aliases: ['investment', 'dividend'] },
    { category: 'Education', aliases: ['education', 'tuition', 'course', 'school'] },
    { category: 'Freelance', aliases: ['freelance', 'contract'] },
    { category: 'Health', aliases: ['health', 'medical', 'doctor', 'pharmacy'] },
    { category: 'Salary', aliases: ['salary', 'paycheck', 'wage'] },
    { category: 'Gift', aliases: ['gift'] },
    { category: 'Food', aliases: ['groceries', 'grocery', 'food'] },
    { category: 'Other', aliases: ['other'] },
  ]

  const sortedCategoryAliases = categoryAliases
    .map((entry) => ({
      ...entry,
      aliases: [...entry.aliases].sort((left, right) => right.length - left.length),
    }))
    .sort((left, right) => right.aliases[0].length - left.aliases[0].length)

  for (const { category, aliases } of sortedCategoryAliases) {
    if (aliases.some((alias) => normalizedTranscript.includes(alias))) {
      return category
    }
  }

  return ''
}

function resolveVoiceTransactionAmount(transcript) {
  const normalizedTranscript = transcript.toLowerCase().trim()

  const keywordMatch = normalizedTranscript.match(
    /\b(?:amount|value|total)\b(?:\s+(?:is|to|of))?\s+\$?(\d+(?:\.\d{1,2})?)/,
  )
  if (keywordMatch) {
    return keywordMatch[1]
  }

  const plainNumberMatches = [...normalizedTranscript.matchAll(/(?:^|\s)\$?(\d+(?:\.\d{1,2})?)(?:\s|$)/g)]
  if (plainNumberMatches.length > 0) {
    return plainNumberMatches[plainNumberMatches.length - 1][1]
  }

  return ''
}

function applyVoiceTransactionUpdate(transcript, currentForm) {
  const normalizedTranscript = transcript.toLowerCase().trim()
  const nextForm = { ...currentForm }

  if (/\bincome\b/.test(normalizedTranscript)) {
    nextForm.type = 'income'
  } else if (/\bexpense\b/.test(normalizedTranscript)) {
    nextForm.type = 'expense'
  }

  const category = resolveVoiceTransactionCategory(normalizedTranscript)
  if (category) {
    nextForm.category = category
  }

  const amount = resolveVoiceTransactionAmount(normalizedTranscript)
  if (amount) {
    nextForm.amount = amount
  }

  return nextForm
}

function normalizeTransactionTypeAndCategory(transactionForm) {
  const normalizedType = transactionForm.type === 'income' ? 'income' : 'expense'
  const allowedCategories = normalizedType === 'income' ? incomeCategories : expenseCategories
  const normalizedCategory = allowedCategories.includes(transactionForm.category)
    ? transactionForm.category
    : allowedCategories[0]

  return {
    ...transactionForm,
    type: normalizedType,
    category: normalizedCategory,
  }
}

function getTransactionSubmissionErrorMessage(error, fallbackMessage) {
  return error instanceof Error ? `${fallbackMessage} ${error.message}` : fallbackMessage
}

function createDemoTransactions() {
  const today = new Date().toISOString().slice(0, 10)

  return [
    {
      id: crypto.randomUUID(),
      type: 'income',
      category: 'Salary',
      amount: 3200,
      date: today,
      note: 'Monthly paycheck',
    },
    {
      id: crypto.randomUUID(),
      type: 'expense',
      category: 'Food',
      amount: 46.2,
      date: today,
      note: 'Groceries',
    },
    {
      id: crypto.randomUUID(),
      type: 'expense',
      category: 'Bills',
      amount: 120,
      date: today,
      note: 'Internet bill',
    },
  ]
}

function createSeedBudgets() {
  const month = getCurrentMonthKey()

  return [
    { id: crypto.randomUUID(), month, category: 'Food', limit: 550 },
    { id: crypto.randomUUID(), month, category: 'Transportation', limit: 300 },
    { id: crypto.randomUUID(), month, category: 'Entertainment', limit: 250 },
    { id: crypto.randomUUID(), month, category: 'Bills', limit: 900 },
  ]
}

function parseJwtPayload(token) {
  if (!token || typeof token !== 'string') {
    return null
  }

  const segments = token.split('.')
  if (segments.length < 2) {
    return null
  }

  try {
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const decoded = atob(padded)
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

function normalizeUserKey(candidate) {
  if (typeof candidate !== 'string' && typeof candidate !== 'number') {
    return ''
  }

  const normalized = String(candidate).trim().toLowerCase()
  if (!normalized) {
    return ''
  }

  // Guard against unresolved identity placeholders from async auth flows.
  if (normalized === 'null' || normalized === 'undefined' || normalized === '[object object]') {
    return ''
  }

  return normalized
}

function getUserKey(user, token) {
  if (user && typeof user === 'object') {
    const idCandidate = user.id || user._id || user.userId || user.username || user.email
    const normalizedUserCandidate = normalizeUserKey(idCandidate)
    if (normalizedUserCandidate) {
      return normalizedUserCandidate
    }
  }

  const tokenPayload = parseJwtPayload(token)
  const tokenCandidate = tokenPayload?.sub || tokenPayload?.userId || tokenPayload?.id || tokenPayload?.email
  const normalizedTokenCandidate = normalizeUserKey(tokenCandidate)
  if (normalizedTokenCandidate) {
    return normalizedTokenCandidate
  }

  return ''
}

function readEntriesStorage() {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(entriesStorageKey)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return { [entriesUsersBucketKey]: {} }
    }

    // Current schema: { users: { [userKey]: { transactions, budgets, updatedAt } } }
    if (
      entriesUsersBucketKey in parsed &&
      parsed[entriesUsersBucketKey] &&
      typeof parsed[entriesUsersBucketKey] === 'object'
    ) {
      return parsed
    }

    // Legacy schema (single account payload): { transactions, budgets, ... }
    if (Array.isArray(parsed.transactions) || Array.isArray(parsed.budgets)) {
      return {
        [entriesUsersBucketKey]: {
          guest: {
            transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
            budgets: Array.isArray(parsed.budgets) ? parsed.budgets : [],
            updatedAt: new Date().toISOString(),
          },
        },
      }
    }

    // Legacy schema (user keys at root): { [userKey]: { transactions, budgets, ... } }
    return {
      [entriesUsersBucketKey]: parsed,
    }
  } catch {
    return { [entriesUsersBucketKey]: {} }
  }
}

function writeEntriesStorage(payload) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(entriesStorageKey, JSON.stringify(payload))
}

function loadEntriesForUser(userKey) {
  const normalizedUserKey = normalizeUserKey(userKey)
  if (!normalizedUserKey) {
    return { transactions: [], budgets: [] }
  }

  const allEntries = readEntriesStorage()
  const userEntries = allEntries[entriesUsersBucketKey]?.[normalizedUserKey]

  return {
    transactions: Array.isArray(userEntries?.transactions) ? userEntries.transactions : [],
    budgets: Array.isArray(userEntries?.budgets) ? userEntries.budgets : [],
  }
}

function saveEntriesForUser(userKey, transactions, budgets) {
  const normalizedUserKey = normalizeUserKey(userKey)
  if (!normalizedUserKey) {
    return
  }

  const allEntries = readEntriesStorage()
  if (!allEntries[entriesUsersBucketKey] || typeof allEntries[entriesUsersBucketKey] !== 'object') {
    allEntries[entriesUsersBucketKey] = {}
  }

  allEntries[entriesUsersBucketKey][normalizedUserKey] = {
    transactions,
    budgets,
    updatedAt: new Date().toISOString(),
  }
  writeEntriesStorage(allEntries)
}

function App() {
  const [authForm, setAuthForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [authStatusMessage, setAuthStatusMessage] = useState('')
  const [authError, setAuthError] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const [authToken, setAuthToken] = useState(() => {
    if (!isBackendConfigured || typeof window === 'undefined') {
      return ''
    }

    return window.localStorage.getItem(authStorageKey) ?? ''
  })
  const [authUser, setAuthUser] = useState(null)
  const [entriesHydrated, setEntriesHydrated] = useState(false)

  const [transactions, setTransactions] = useState(() =>
    isBackendConfigured ? [] : createDemoTransactions(),
  )
  const [budgets, setBudgets] = useState(() => (isBackendConfigured ? [] : createSeedBudgets()))
  const [editingTransactionId, setEditingTransactionId] = useState(null)
  const [connectionState, setConnectionState] = useState(
    isBackendConfigured ? (authToken ? 'loading' : 'auth-required') : 'local',
  )
  const [syncMessage, setSyncMessage] = useState(
    isBackendConfigured
      ? authToken
        ? 'Connecting to backend...'
        : 'Authentication required. Please log in.'
      : 'Using local demo data.',
  )
  const [transactionForm, setTransactionForm] = useState({
    type: 'expense',
    category: 'Food',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    note: '',
  })
  const [transactionVoiceMessage, setTransactionVoiceMessage] = useState('')
  const [isTransactionVoiceListening, setIsTransactionVoiceListening] = useState(false)
  const [focusAlertsRequested, setFocusAlertsRequested] = useState(false)
  const [budgetForm, setBudgetForm] = useState({
    month: getCurrentMonthKey(),
    category: 'Food',
    limit: '',
  })
  const [filters, setFilters] = useState({ category: 'All', startDate: '', endDate: '' })
  const startupWarning = apiConfigurationWarning
  const resolvedUserKey = useMemo(() => {
    if (!isBackendConfigured) {
      return 'guest'
    }

    return getUserKey(authUser, authToken)
  }, [authToken, authUser])

  useEffect(() => {
    setApiAuthToken(authToken)

    if (!isBackendConfigured || typeof window === 'undefined') {
      return
    }

    if (authToken) {
      window.localStorage.setItem(authStorageKey, authToken)
    } else {
      window.localStorage.removeItem(authStorageKey)
    }
  }, [authToken])

  useEffect(() => {
    if (!isBackendConfigured || !authToken) {
      return
    }

    if (authUser && getUserKey(authUser, authToken)) {
      return
    }

    let isActive = true

    async function restoreAuthenticatedUser() {
      setConnectionState('loading')
      setSyncMessage('Restoring your session...')

      try {
        const me = await fetchAuthenticatedUser()
        if (!isActive) {
          return
        }

        setAuthUser(me)
      } catch (error) {
        if (!isActive) {
          return
        }

        // Keep expired/invalid tokens from trapping the app in an unauthenticated-but-signed-in state.
        setAuthToken('')
        setAuthUser(null)
        setAuthError(error instanceof Error ? error.message : 'Session expired. Please log in again.')
        setConnectionState('auth-required')
        setSyncMessage('Authentication required. Please log in.')
      }
    }

    restoreAuthenticatedUser()

    return () => {
      isActive = false
    }
  }, [authToken, authUser, isBackendConfigured])

  useEffect(() => {
    setEntriesHydrated(false)
  }, [resolvedUserKey])

  useEffect(() => {
    if (!resolvedUserKey) {
      if (isBackendConfigured && authToken) {
        setConnectionState('loading')
        setSyncMessage('Resolving authenticated user...')
      }
      return
    }

    if (!isBackendConfigured) {
      const localEntries = loadEntriesForUser(resolvedUserKey)
      if (localEntries.transactions.length > 0 || localEntries.budgets.length > 0) {
        setTransactions(localEntries.transactions)
        setBudgets(localEntries.budgets)
      } else {
        setTransactions(createDemoTransactions())
        setBudgets(createSeedBudgets())
      }

      setConnectionState('local')
      setSyncMessage('Using local data storage.')
      setEntriesHydrated(true)
      return
    }

    if (!authToken) {
      return
    }

    let isActive = true

    async function syncFromBackend() {
      setConnectionState('loading')
      setSyncMessage('Loading your data...')

      const cachedEntries = loadEntriesForUser(resolvedUserKey)
      if (cachedEntries.transactions.length > 0 || cachedEntries.budgets.length > 0) {
        setTransactions(cachedEntries.transactions)
        setBudgets(cachedEntries.budgets)
      }

      try {
        const [remoteTransactions, remoteBudgets] = await Promise.all([
          fetchTransactions(),
          fetchBudgets(),
        ])

        if (!isActive) {
          return
        }

        setTransactions(Array.isArray(remoteTransactions) ? remoteTransactions : [])
        setBudgets(Array.isArray(remoteBudgets) ? remoteBudgets : [])
        saveEntriesForUser(
          resolvedUserKey,
          Array.isArray(remoteTransactions) ? remoteTransactions : [],
          Array.isArray(remoteBudgets) ? remoteBudgets : [],
        )
        setConnectionState('online')
        setSyncMessage('Data loaded successfully.')
      } catch (error) {
        if (!isActive) {
          return
        }

        const fallbackEntries = loadEntriesForUser(resolvedUserKey)
        setConnectionState('local-fallback')
        setSyncMessage(
          error instanceof Error
            ? `Backend unavailable. Using local demo data. ${error.message}`
            : 'Backend unavailable. Using local demo data.',
        )
        setTransactions(
          fallbackEntries.transactions.length > 0
            ? fallbackEntries.transactions
            : createDemoTransactions(),
        )
        setBudgets(
          fallbackEntries.budgets.length > 0
            ? fallbackEntries.budgets
            : createSeedBudgets(),
        )
      }

      if (isActive) {
        setEntriesHydrated(true)
      }
    }

    syncFromBackend()

    return () => {
      isActive = false
    }
  }, [authToken, resolvedUserKey])

  useEffect(() => {
    if (!entriesHydrated || !resolvedUserKey) {
      return
    }

    saveEntriesForUser(resolvedUserKey, transactions, budgets)
  }, [entriesHydrated, resolvedUserKey, transactions, budgets])

  const orderedTransactions = useMemo(
    () => [...transactions].sort((left, right) => new Date(right.date) - new Date(left.date)),
    [transactions],
  )

  const currentMonth = getCurrentMonthKey()

  const currentMonthTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.date.startsWith(currentMonth)),
    [transactions, currentMonth],
  )

  const filteredTransactions = useMemo(() => {
    return orderedTransactions.filter((transaction) => {
      const categoryMatches = filters.category === 'All' || transaction.category === filters.category
      const startMatches = !filters.startDate || transaction.date >= filters.startDate
      const endMatches = !filters.endDate || transaction.date <= filters.endDate

      return categoryMatches && startMatches && endMatches
    })
  }, [orderedTransactions, filters])

  const summary = useMemo(() => {
    const income = currentMonthTransactions
      .filter((transaction) => transaction.type === 'income')
      .reduce((total, transaction) => total + transaction.amount, 0)

    const expense = currentMonthTransactions
      .filter((transaction) => transaction.type === 'expense')
      .reduce((total, transaction) => total + transaction.amount, 0)

    return { income, expense, savings: income - expense }
  }, [currentMonthTransactions])

  const expenseByCategory = useMemo(() => {
    return currentMonthTransactions
      .filter((transaction) => transaction.type === 'expense')
      .reduce((accumulator, transaction) => {
        accumulator[transaction.category] = (accumulator[transaction.category] || 0) + transaction.amount
        return accumulator
      }, {})
  }, [currentMonthTransactions])

  const budgetStatus = useMemo(() => {
    return budgets
      .filter((budget) => budget.month === currentMonth)
      .map((budget) => {
        const spent = expenseByCategory[budget.category] || 0
        const remaining = budget.limit - spent

        return {
          ...budget,
          spent,
          remaining,
          progress: budget.limit > 0 ? Math.min((spent / budget.limit) * 100, 100) : 0,
          isOver: spent > budget.limit,
          isAtRisk: spent >= budget.limit * budgetAlertThreshold,
        }
      })
  }, [budgets, currentMonth, expenseByCategory])

  const alerts = budgetStatus.filter((budget) => budget.isAtRisk)

  const pieChartSegments = useMemo(() => {
    const entries = Object.entries(expenseByCategory).sort((left, right) => right[1] - left[1])
    const total = entries.reduce((sum, [, amount]) => sum + amount, 0)
    const fallbackColors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#64748b']

    let offset = 0

    return entries.map(([category, amount], index) => {
      const percentage = total > 0 ? (amount / total) * 100 : 0
      const segment = {
        category,
        amount,
        percentage,
        color: expenseCategoryColors[category] || fallbackColors[index % fallbackColors.length],
        offset,
      }

      offset += percentage
      return segment
    })
  }, [expenseByCategory])

  const availableCategories = transactionForm.type === 'income' ? incomeCategories : expenseCategories
  const activeTransactionCategory = availableCategories.includes(transactionForm.category)
    ? transactionForm.category
    : availableCategories[0]

  const isResetRoute = location.pathname === '/reset-password'
  const isAuthRoute = location.pathname === '/login' || location.pathname === '/register' || isResetRoute
  const authMode = location.pathname === '/register' ? 'register' : isResetRoute ? 'reset' : 'login'

  const screenTabs = [
    { id: 'dashboard', label: 'Dashboard', description: 'Overview and alerts' },
    { id: 'transactions', label: 'Transactions', description: 'Add, edit, and history' },
    { id: 'budgets', label: 'Budgets', description: 'Monthly planning' },
    { id: 'insights', label: 'Insights', description: 'Charts and patterns' },
    { id: 'settings', label: 'Settings', description: 'Data and backend' },
  ]

  const routeScreenId = location.pathname.startsWith('/app/')
    ? location.pathname.split('/')[2] || ''
    : ''
  const activeScreen = screenTabs.some((screen) => screen.id === routeScreenId)
    ? routeScreenId
    : 'dashboard'
  const alertsSectionRef = useRef(null)

  const authenticatedDisplayFirstName = getDisplayFirstName(authUser)

  useEffect(() => {
    if (!focusAlertsRequested || activeScreen !== 'dashboard') {
      return
    }

    const rafId = requestAnimationFrame(() => {
      alertsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setFocusAlertsRequested(false)
    })

    return () => cancelAnimationFrame(rafId)
  }, [activeScreen, focusAlertsRequested])

  function handleOpenAlerts() {
    setFocusAlertsRequested(true)
    if (activeScreen !== 'dashboard') {
      navigate('/app/dashboard')
    }
  }

  function resetTransactionForm() {
    setTransactionForm({
      type: 'expense',
      category: 'Food',
      amount: '',
      date: new Date().toISOString().slice(0, 10),
      note: '',
    })
    setEditingTransactionId(null)
    setTransactionVoiceMessage('')
    setIsTransactionVoiceListening(false)
  }

  async function persistTransaction(transactionData, transactionId = editingTransactionId) {
    const normalizedAmount = Number.parseFloat(transactionData.amount)
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      return false
    }

    const nextTransaction = {
      id: transactionId || crypto.randomUUID(),
      type: transactionData.type,
      category: transactionData.category,
      amount: normalizedAmount,
      date: transactionData.date,
      note: typeof transactionData.note === 'string' ? transactionData.note.trim() : '',
    }

    try {
      const savedTransaction = isBackendConfigured
        ? transactionId
          ? await updateTransaction(transactionId, nextTransaction)
          : await createTransaction(nextTransaction)
        : nextTransaction

      setTransactions((currentTransactions) => {
        if (transactionId) {
          return currentTransactions.map((transaction) =>
            transaction.id === transactionId ? savedTransaction : transaction,
          )
        }

        return [savedTransaction, ...currentTransactions]
      })

      setConnectionState(isBackendConfigured ? 'online' : 'local')
      setSyncMessage(
        isBackendConfigured ? 'Transaction saved to backend.' : 'Transaction saved locally.',
      )
      resetTransactionForm()
      return true
    } catch (error) {
      setTransactions((currentTransactions) => {
        if (transactionId) {
          return currentTransactions.map((transaction) =>
            transaction.id === transactionId ? nextTransaction : transaction,
          )
        }

        return [nextTransaction, ...currentTransactions]
      })
      setConnectionState('local-fallback')
      setSyncMessage(getTransactionSubmissionErrorMessage(error, 'Saved locally because the backend request failed.'))
      return false
    }
  }

  async function handleTransactionSubmit(event) {
    event.preventDefault()

    if (isBackendConfigured && !resolvedUserKey) {
      setSyncMessage('Cannot save yet. Waiting for user identity to resolve.')
      return
    }

    await persistTransaction(
      {
        ...transactionForm,
        category: activeTransactionCategory,
      },
      editingTransactionId,
    )
  }

  function handleEditTransaction(transaction) {
    setEditingTransactionId(transaction.id)
    setTransactionForm({
      type: transaction.type,
      category: transaction.category,
      amount: String(transaction.amount),
      date: transaction.date,
      note: transaction.note,
    })
    setTransactionVoiceMessage('')
  }

  async function handleVoiceSaveTransaction() {
    const SpeechRecognition = getSpeechRecognitionConstructor()
    if (!SpeechRecognition) {
      setTransactionVoiceMessage('Web Speech API is not supported in this browser.')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    setTransactionVoiceMessage('Say income or expense, a category, and an amount, like: expense food 25.')
    setIsTransactionVoiceListening(true)

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() || ''
      if (!transcript) {
        setTransactionVoiceMessage('No speech was captured. Try again.')
        return
      }

      const spokenForm = applyVoiceTransactionUpdate(transcript, transactionForm)
      const nextForm = normalizeTransactionTypeAndCategory(spokenForm)
      const parsedAmount = Number.parseFloat(nextForm.amount)
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        setTransactionVoiceMessage('Speech must include a valid amount before saving. Try again.')
        return
      }

      setTransactionForm(nextForm)
      setTransactionVoiceMessage(`Saving spoken transaction: ${transcript}`)
      void persistTransaction(nextForm, editingTransactionId).then((saved) => {
        if (saved) {
          setTransactionVoiceMessage('Transaction saved from speech input.')
        }
      })
    }

    recognition.onerror = (event) => {
      setTransactionVoiceMessage(
        event.error ? `Voice input failed: ${event.error}.` : 'Voice input failed. Please try again.',
      )
    }

    recognition.onend = () => {
      setIsTransactionVoiceListening(false)
    }

    try {
      recognition.start()
    } catch {
      setIsTransactionVoiceListening(false)
      setTransactionVoiceMessage('Voice recognition could not start. Please try again.')
    }
  }

  async function handleDeleteTransaction(transactionId) {
    try {
      if (isBackendConfigured) {
        await deleteTransaction(transactionId)
      }

      setTransactions((currentTransactions) =>
        currentTransactions.filter((transaction) => transaction.id !== transactionId),
      )
      setConnectionState(isBackendConfigured ? 'online' : 'local')
      setSyncMessage(isBackendConfigured ? 'Transaction removed from backend.' : 'Transaction removed locally.')
    } catch (error) {
      setTransactions((currentTransactions) =>
        currentTransactions.filter((transaction) => transaction.id !== transactionId),
      )
      setConnectionState('local-fallback')
      setSyncMessage(
        error instanceof Error
          ? `Removed locally because the backend request failed. ${error.message}`
          : 'Removed locally because the backend request failed.',
      )
    }

    if (editingTransactionId === transactionId) {
      resetTransactionForm()
    }
  }

  async function handleBudgetSubmit(event) {
    event.preventDefault()

    if (isBackendConfigured && !resolvedUserKey) {
      setSyncMessage('Cannot save yet. Waiting for user identity to resolve.')
      return
    }

    const limit = Number.parseFloat(budgetForm.limit)
    if (!Number.isFinite(limit) || limit <= 0) {
      return
    }

    const existingBudget = budgets.find(
      (budget) => budget.month === budgetForm.month && budget.category === budgetForm.category,
    )

    const nextBudget = existingBudget
      ? { ...existingBudget, limit }
      : {
          id: crypto.randomUUID(),
          month: budgetForm.month,
          category: budgetForm.category,
          limit,
        }

    try {
      const savedBudget = isBackendConfigured
        ? existingBudget
          ? await updateBudget(existingBudget.id, nextBudget)
          : await createBudget(nextBudget)
        : nextBudget

      setBudgets((currentBudgets) => {
        if (existingBudget) {
          return currentBudgets.map((budget) =>
            budget.id === existingBudget.id ? savedBudget : budget,
          )
        }

        return [...currentBudgets, savedBudget]
      })

      setConnectionState(isBackendConfigured ? 'online' : 'local')
      setSyncMessage(isBackendConfigured ? 'Budget saved to backend.' : 'Budget saved locally.')
    } catch (error) {
      setBudgets((currentBudgets) => {
        if (existingBudget) {
          return currentBudgets.map((budget) =>
            budget.id === existingBudget.id ? nextBudget : budget,
          )
        }

        return [...currentBudgets, nextBudget]
      })
      setConnectionState('local-fallback')
      setSyncMessage(
        error instanceof Error
          ? `Saved locally because the backend request failed. ${error.message}`
          : 'Saved locally because the backend request failed.',
      )
    }

    setBudgetForm({ month: currentMonth, category: 'Food', limit: '' })
  }

  async function handleAuthSubmit(event) {
    event.preventDefault()

    if (!isBackendConfigured) {
      setAuthError('Backend URL is not configured. Set VITE_API_BASE_URL first.')
      return
    }

    const email = authForm.email.trim()
    const password = authForm.password
    const confirmPassword = authForm.confirmPassword
    const firstName = authForm.firstName.trim()
    const lastName = authForm.lastName.trim()
    const fullName = [firstName, lastName].filter(Boolean).join(' ')

    if (!email || !password) {
      setAuthError('Email and password are required.')
      return
    }

    if (authMode === 'register' && (!firstName || !lastName)) {
      setAuthError('First name and last name are required for sign up.')
      return
    }

    if (authMode !== 'login' && (!password || !confirmPassword)) {
      setAuthError(authMode === 'reset' ? 'New password and confirmation are required.' : 'Password and confirmation are required.')
      return
    }

    if (authMode !== 'login' && password !== confirmPassword) {
      setAuthError('Passwords do not match.')
      return
    }

    setAuthError('')
    setAuthStatusMessage(
      authMode === 'login'
        ? 'Signing in...'
        : authMode === 'register'
          ? 'Creating your account...'
          : 'Preparing password reset...',
    )

    try {
      let authPayload

      if (authMode === 'login') {
        authPayload = await loginUser({ email, password })
      } else if (authMode === 'register') {
        const registrationPayload = await registerUser({ name: fullName, email, password })

        if (registrationPayload.token) {
          authPayload = registrationPayload
        } else {
          setAuthStatusMessage('Account created. Signing you in...')
          const loginPayload = await loginUser({ email, password })
          authPayload = {
            token: loginPayload.token,
            user: registrationPayload.user ?? loginPayload.user,
          }
        }
      } else {
        setAuthStatusMessage('Password reset form is ready. Connect it to your backend reset endpoint to complete the flow.')
        setAuthForm((currentForm) => ({
          ...currentForm,
          password: '',
          confirmPassword: '',
        }))
        return
      }

      setAuthToken(authPayload.token)
      setAuthUser(authPayload.user)
      setAuthStatusMessage(
        authMode === 'login'
          ? `Welcome, ${getDisplayFirstName(authPayload.user)}.`
          : `Account created successfully. Welcome, ${getDisplayFirstName(authPayload.user)}.`,
      )
      setAuthForm((currentForm) => ({ ...currentForm, password: '' }))
      navigate('/app/dashboard', { replace: true })
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : 'Authentication failed. Please try again.',
      )
      setAuthStatusMessage('')
    }
  }

  function handleLogout() {
    setAuthToken('')
    setAuthUser(null)
    setAuthStatusMessage('')
    setAuthError('')
    setConnectionState('auth-required')
    setSyncMessage('Authentication required. Please log in.')
    navigate('/login', { replace: true })
  }

  if (isBackendConfigured && !authToken && !isAuthRoute) {
    return <Navigate to="/login" replace />
  }

  if (isBackendConfigured && authToken && isAuthRoute) {
    return <Navigate to="/app/dashboard" replace />
  }

  if (!isBackendConfigured && !location.pathname.startsWith('/app/')) {
    return <Navigate to="/app/dashboard" replace />
  }

  if (location.pathname.startsWith('/app/') && !screenTabs.some((screen) => screen.id === routeScreenId)) {
    return <Navigate to="/app/dashboard" replace />
  }

  if (isAuthRoute) {
    return (
      <div className="app-shell auth-shell">
        {startupWarning ? (
          <p className="startup-banner" role="status">
            {startupWarning}
          </p>
        ) : null}

        <section className="auth-panel">
          <div className="auth-hero">
            <p className="eyebrow">Welcome to our Personal Budget App</p>
            <h1>Plan your money with a secure personal account.</h1>
            <p className="hero-description">
              Log-in or sign-up to continue. 
            </p>
          </div>

          <div className="auth-card">
            <div className="auth-mode-switch" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                className={`screen-tab ${authMode === 'login' ? 'is-active' : ''}`}
                onClick={() => {
                  navigate('/login')
                  setAuthError('')
                  setAuthStatusMessage('')
                }}
              >
                <span>Log In</span>
                <small>Access your account</small>
              </button>
              <button
                type="button"
                className={`screen-tab ${authMode === 'register' ? 'is-active' : ''}`}
                onClick={() => {
                  navigate('/register')
                  setAuthError('')
                  setAuthStatusMessage('')
                }}
              >
                <span>Sign Up</span>
                <small>Create a new account</small>
              </button>
            </div>

            <form className="stacked-form" onSubmit={handleAuthSubmit}>
              {authMode === 'register' ? (
                <>
                  <label>
                    First name
                    <input
                      type="text"
                      value={authForm.firstName}
                      onChange={(event) =>
                        setAuthForm((currentForm) => ({
                          ...currentForm,
                          firstName: event.target.value,
                        }))
                      }
                      placeholder="Jane"
                    />
                  </label>

                  <label>
                    Last name
                    <input
                      type="text"
                      value={authForm.lastName}
                      onChange={(event) =>
                        setAuthForm((currentForm) => ({
                          ...currentForm,
                          lastName: event.target.value,
                        }))
                      }
                      placeholder="Budget"
                    />
                  </label>
                </>
              ) : null}

              {authMode === 'reset' ? (
                <p className="empty-state">
                  Enter your email and choose a new password. The new password and confirmation must match.
                </p>
              ) : null}

              <label>
                Email
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) =>
                    setAuthForm((currentForm) => ({ ...currentForm, email: event.target.value }))
                  }
                  placeholder="you@example.com"
                />
              </label>

              <label>
                {authMode === 'reset' ? 'New password' : 'Password'}
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) =>
                    setAuthForm((currentForm) => ({ ...currentForm, password: event.target.value }))
                  }
                  placeholder={authMode === 'reset' ? 'Enter a new password' : 'Enter your password'}
                />
              </label>

              {authMode !== 'login' ? (
                <label>
                  {authMode === 'reset' ? 'Confirm new password' : 'Confirm password'}
                  <input
                    type="password"
                    value={authForm.confirmPassword}
                    onChange={(event) =>
                      setAuthForm((currentForm) => ({
                        ...currentForm,
                        confirmPassword: event.target.value,
                      }))
                    }
                    placeholder={authMode === 'reset' ? 'Repeat the new password' : 'Repeat the password'}
                  />
                </label>
              ) : null}

              {authStatusMessage ? <p className="sync-status sync-status-loading">{authStatusMessage}</p> : null}
              {authError ? <p className="sync-status sync-status-local-fallback">{authError}</p> : null}

              <div className="form-actions">
                {authMode === 'login' ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      navigate('/reset-password')
                      setAuthError('')
                      setAuthStatusMessage('')
                    }}
                  >
                    Reset your password?
                  </button>
                ) : null}
                <button type="submit" className="primary-button">
                  {authMode === 'login' ? 'Log In' : authMode === 'register' ? 'Sign Up' : 'Reset Password'}
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {startupWarning ? (
        <p className="startup-banner" role="status">
          {startupWarning}
        </p>
      ) : null}

      <nav className="screen-nav" aria-label="Budget screens">
        {screenTabs.map((screen) => (
          <button
            type="button"
            key={screen.id}
            className={`screen-tab ${activeScreen === screen.id ? 'is-active' : ''}`}
            onClick={() => navigate(`/app/${screen.id}`)}
          >
            <span>{screen.label}</span>
            <small>{screen.description}</small>
          </button>
        ))}
      </nav>

      <header className="hero-panel">
        <div className="hero-copy">
          <div className="hero-greeting-row">
            <p className="eyebrow hero-greeting">Welcome, {authenticatedDisplayFirstName}</p>
            {isBackendConfigured && authToken ? (
              <button type="button" className="ghost-button hero-logout-button" onClick={handleLogout}>
                Log out
              </button>
            ) : null}
          </div>
          <h1>Track your income, expenses, and savings</h1>
          <p className="hero-description">
            Add transactions, monitor category budgets, spot overspending early, and keep your financial
            history available in the browser for future visits.
          </p>

          <p className={`sync-status sync-status-${connectionState}`}>
            {syncMessage}
          </p>

        </div>

        <div className="hero-metrics">
          <article>
            <span>Income</span>
            <strong>{formatCurrency(summary.income)}</strong>
          </article>
          <article>
            <span>Expenses</span>
            <strong>{formatCurrency(summary.expense)}</strong>
          </article>
          <article>
            <span>Savings</span>
            <strong>{formatCurrency(summary.savings)}</strong>
          </article>
          <button type="button" className="metric-alert-button" onClick={handleOpenAlerts}>
            <span>Active alerts</span>
            <strong>{alerts.length}</strong>
          </button>
        </div>
      </header>

      <main className="dashboard-grid">
        {activeScreen === 'dashboard' ? (
          <>
            <section className="card panel-form quick-add-panel">
              <div className="section-heading">
                <p className="eyebrow">Quick add</p>
                <h2>Record a transaction</h2>
              </div>
              <form className="stacked-form" onSubmit={handleTransactionSubmit}>
                <div className="field-group segmented-control">
                  <label>
                    <input
                      type="radio"
                      name="transactionType"
                      checked={transactionForm.type === 'income'}
                      onChange={() =>
                        setTransactionForm((currentForm) => ({
                          ...currentForm,
                          type: 'income',
                          category: incomeCategories.includes(currentForm.category)
                            ? currentForm.category
                            : incomeCategories[0],
                        }))
                      }
                    />
                    Income
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="transactionType"
                      checked={transactionForm.type === 'expense'}
                      onChange={() =>
                        setTransactionForm((currentForm) => ({
                          ...currentForm,
                          type: 'expense',
                          category: expenseCategories.includes(currentForm.category)
                            ? currentForm.category
                            : expenseCategories[0],
                        }))
                      }
                    />
                    Expense
                  </label>
                </div>

                <div className="field-grid">
                  <label>
                    Category
                    <select
                      value={activeTransactionCategory}
                      onChange={(event) =>
                        setTransactionForm((currentForm) => ({
                          ...currentForm,
                          category: event.target.value,
                        }))
                      }
                    >
                      {availableCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Amount
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={transactionForm.amount}
                      onChange={(event) =>
                        setTransactionForm((currentForm) => ({
                          ...currentForm,
                          amount: event.target.value,
                        }))
                      }
                      placeholder="0.00"
                    />
                  </label>

                  <label>
                    Date
                    <input
                      type="date"
                      value={transactionForm.date}
                      onChange={(event) =>
                        setTransactionForm((currentForm) => ({
                          ...currentForm,
                          date: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="wide-field">
                    Note
                    <input
                      type="text"
                      value={transactionForm.note}
                      onChange={(event) =>
                        setTransactionForm((currentForm) => ({
                          ...currentForm,
                          note: event.target.value,
                        }))
                      }
                      placeholder="Optional detail"
                    />
                  </label>
                </div>

                <div className="form-actions">
                  <button type="submit" className="primary-button">
                    {editingTransactionId ? 'Update transaction' : 'Save transaction'}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleVoiceSaveTransaction}
                    disabled={isTransactionVoiceListening}
                  >
                    {isTransactionVoiceListening
                      ? 'Listening...'
                      : editingTransactionId
                        ? 'Update by voice'
                        : 'Save by voice'}
                  </button>
                  {editingTransactionId ? (
                    <button type="button" className="ghost-button" onClick={resetTransactionForm}>
                      Cancel edit
                    </button>
                  ) : null}
                </div>
                {transactionVoiceMessage ? (
                  <p className="sync-status sync-status-loading">{transactionVoiceMessage}</p>
                ) : null}
              </form>
            </section>

            <section className="card panel-form budget-snapshot-panel">
              <div className="section-heading">
                <p className="eyebrow">Budget snapshot</p>
                <h2>{currentMonth} plan</h2>
              </div>
              <div className="budget-list budget-list-compact">
                {budgetStatus.length > 0 ? (
                  budgetStatus.slice(0, 2).map((budget) => (
                    <article className={`budget-card ${budget.isOver ? 'is-over' : ''}`} key={budget.id}>
                      <div className="budget-card-header">
                        <div>
                          <h3>{budget.category}</h3>
                          <p>{budget.month}</p>
                        </div>
                        <strong>{formatCurrency(budget.remaining)} left</strong>
                      </div>

                      <div className="progress-track" aria-hidden="true">
                        <span className="progress-fill" style={{ width: `${budget.progress}%` }} />
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="empty-state">No budgets have been created for this month yet.</p>
                )}
              </div>
            </section>

            <section className="card panel-wide" id="alerts-panel" ref={alertsSectionRef}>
              <div className="section-heading">
                <p className="eyebrow">Alerts</p>
                <h2>Approaching or exceeding budgets</h2>
              </div>

              {alerts.length > 0 ? (
                <div className="alert-list">
                  {alerts.map((budget) => (
                    <article className={`alert ${budget.isOver ? 'alert-danger' : 'alert-warning'}`} key={budget.id}>
                      <strong>{budget.category}</strong>
                      <p>
                        {budget.isOver
                          ? `${formatCurrency(Math.abs(budget.remaining))} over the limit.`
                          : `${formatCurrency(budget.remaining)} remaining before the alert threshold.`}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-state">No categories are near their limits right now.</p>
              )}
            </section>
          </>
        ) : null}

        {activeScreen === 'transactions' ? (
          <>
            <section className="card panel-form">
              <div className="section-heading">
                <p className="eyebrow">Transactions</p>
                <h2>{editingTransactionId ? 'Edit transaction' : 'Add transaction'}</h2>
              </div>

              <form className="stacked-form" onSubmit={handleTransactionSubmit}>
                <div className="field-group segmented-control">
                  <label>
                    <input
                      type="radio"
                      name="transactionType"
                      checked={transactionForm.type === 'income'}
                      onChange={() =>
                        setTransactionForm((currentForm) => ({
                          ...currentForm,
                          type: 'income',
                          category: incomeCategories.includes(currentForm.category)
                            ? currentForm.category
                            : incomeCategories[0],
                        }))
                      }
                    />
                    Income
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="transactionType"
                      checked={transactionForm.type === 'expense'}
                      onChange={() =>
                        setTransactionForm((currentForm) => ({
                          ...currentForm,
                          type: 'expense',
                          category: expenseCategories.includes(currentForm.category)
                            ? currentForm.category
                            : expenseCategories[0],
                        }))
                      }
                    />
                    Expense
                  </label>
                </div>

                <div className="field-grid">
                  <label>
                    Category
                    <select
                      value={activeTransactionCategory}
                      onChange={(event) =>
                        setTransactionForm((currentForm) => ({
                          ...currentForm,
                          category: event.target.value,
                        }))
                      }
                    >
                      {availableCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Amount
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={transactionForm.amount}
                      onChange={(event) =>
                        setTransactionForm((currentForm) => ({
                          ...currentForm,
                          amount: event.target.value,
                        }))
                      }
                      placeholder="0.00"
                    />
                  </label>

                  <label>
                    Date
                    <input
                      type="date"
                      value={transactionForm.date}
                      onChange={(event) =>
                        setTransactionForm((currentForm) => ({
                          ...currentForm,
                          date: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="wide-field">
                    Note
                    <input
                      type="text"
                      value={transactionForm.note}
                      onChange={(event) =>
                        setTransactionForm((currentForm) => ({
                          ...currentForm,
                          note: event.target.value,
                        }))
                      }
                      placeholder="Optional detail"
                    />
                  </label>
                </div>

                <div className="form-actions">
                  <button type="submit" className="primary-button">
                    {editingTransactionId ? 'Update transaction' : 'Save transaction'}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleVoiceSaveTransaction}
                    disabled={isTransactionVoiceListening}
                  >
                    {isTransactionVoiceListening
                      ? 'Listening...'
                      : editingTransactionId
                        ? 'Update by voice'
                        : 'Save by voice'}
                  </button>
                  {editingTransactionId ? (
                    <button type="button" className="ghost-button" onClick={resetTransactionForm}>
                      Cancel edit
                    </button>
                  ) : null}
                </div>
                {transactionVoiceMessage ? (
                  <p className="sync-status sync-status-loading">{transactionVoiceMessage}</p>
                ) : null}
              </form>
            </section>

            <section className="card panel-wide">
              <div className="section-heading">
                <p className="eyebrow">History</p>
                <h2>Transaction history and filters</h2>
              </div>

              <div className="filter-bar">
                <label>
                  Category
                  <select
                    value={filters.category}
                    onChange={(event) =>
                      setFilters((currentFilters) => ({
                        ...currentFilters,
                        category: event.target.value,
                      }))
                    }
                  >
                    <option value="All">All categories</option>
                    {Array.from(new Set(transactions.map((transaction) => transaction.category))).map(
                      (category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ),
                    )}
                  </select>
                </label>

                <label>
                  Start date
                  <input
                    type="date"
                    value={filters.startDate}
                    onChange={(event) =>
                      setFilters((currentFilters) => ({
                        ...currentFilters,
                        startDate: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  End date
                  <input
                    type="date"
                    value={filters.endDate}
                    onChange={(event) =>
                      setFilters((currentFilters) => ({
                        ...currentFilters,
                        endDate: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <div className="transaction-list">
                {filteredTransactions.length > 0 ? (
                  filteredTransactions.map((transaction) => (
                    <article className="transaction-row" key={transaction.id}>
                      <div>
                        <div className="transaction-title">
                          <strong>{transaction.category}</strong>
                          <span className={`pill ${transaction.type === 'income' ? 'pill-income' : 'pill-expense'}`}>
                            {transaction.type}
                          </span>
                        </div>
                        <p>{transaction.note || 'No note provided'}</p>
                        <small>{formatDate(transaction.date)}</small>
                      </div>

                      <div className="transaction-actions">
                        <strong className={transaction.type === 'income' ? 'income-value' : 'expense-value'}>
                          {transaction.type === 'income' ? '+' : '-'}{formatCurrency(transaction.amount)}
                        </strong>
                        <div className="inline-actions">
                          <button type="button" className="text-button" onClick={() => handleEditTransaction(transaction)}>
                            Edit
                          </button>
                          <button type="button" className="text-button danger" onClick={() => handleDeleteTransaction(transaction.id)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="empty-state">No transactions match the current filters.</p>
                )}
              </div>
            </section>
          </>
        ) : null}

        {activeScreen === 'budgets' ? (
          <>
            <section className="card panel-form">
              <div className="section-heading">
                <p className="eyebrow">Budgets</p>
                <h2>Create monthly spending limits</h2>
              </div>

              <form className="stacked-form" onSubmit={handleBudgetSubmit}>
                <div className="field-grid">
                  <label>
                    Month
                    <input
                      type="month"
                      value={budgetForm.month}
                      onChange={(event) =>
                        setBudgetForm((currentForm) => ({
                          ...currentForm,
                          month: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label>
                    Category
                    <select
                      value={budgetForm.category}
                      onChange={(event) =>
                        setBudgetForm((currentForm) => ({
                          ...currentForm,
                          category: event.target.value,
                        }))
                      }
                    >
                      {expenseCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Limit
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={budgetForm.limit}
                      onChange={(event) =>
                        setBudgetForm((currentForm) => ({
                          ...currentForm,
                          limit: event.target.value,
                        }))
                      }
                      placeholder="500.00"
                    />
                  </label>
                </div>

                <div className="form-actions">
                  <button type="submit" className="primary-button">
                    Save budget
                  </button>
                </div>
              </form>
            </section>

            <section className="card panel-wide">
              <div className="section-heading">
                <p className="eyebrow">Budget progress</p>
                <h2>{currentMonth} plan</h2>
              </div>

              <div className="budget-list">
                {budgetStatus.length > 0 ? (
                  budgetStatus.map((budget) => (
                    <article className={`budget-card ${budget.isOver ? 'is-over' : ''}`} key={budget.id}>
                      <div className="budget-card-header">
                        <div>
                          <h3>{budget.category}</h3>
                          <p>{budget.month}</p>
                        </div>
                        <strong>{formatCurrency(budget.remaining)} left</strong>
                      </div>

                      <div className="progress-track" aria-hidden="true">
                        <span className="progress-fill" style={{ width: `${budget.progress}%` }} />
                      </div>

                      <div className="budget-values">
                        <span>Spent {formatCurrency(budget.spent)}</span>
                        <span>Limit {formatCurrency(budget.limit)}</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="empty-state">No budgets have been created for this month yet.</p>
                )}
              </div>
            </section>
          </>
        ) : null}

        {activeScreen === 'insights' ? (
          <>
            <section className="card panel-wide">
              <div className="section-heading">
                <p className="eyebrow">Insights</p>
                <h2>Spending by category</h2>
              </div>

              {pieChartSegments.length > 0 ? (
                <div className="pie-chart-layout">
                  <svg
                    className="pie-chart"
                    viewBox="0 0 42 42"
                    role="img"
                    aria-label="Expense distribution by category"
                  >
                    <circle className="pie-chart-track" cx="21" cy="21" r="15.9155" />
                    {pieChartSegments.map((segment) => (
                      <circle
                        key={segment.category}
                        className="pie-chart-segment"
                        cx="21"
                        cy="21"
                        r="15.9155"
                        fill="transparent"
                        stroke={segment.color}
                        strokeDasharray={`${segment.percentage} ${100 - segment.percentage}`}
                        strokeDashoffset={25 - segment.offset}
                      />
                    ))}
                  </svg>

                  <div className="pie-legend" aria-label="Pie chart legend">
                    {pieChartSegments.map((segment) => (
                      <article className="pie-legend-row" key={segment.category}>
                        <div className="pie-legend-meta">
                          <span
                            className="pie-legend-swatch"
                            style={{ backgroundColor: segment.color }}
                            aria-hidden="true"
                          />
                          <span>{segment.category}</span>
                        </div>
                        <strong>
                          {formatCurrency(segment.amount)} ({segment.percentage.toFixed(1)}%)
                        </strong>
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="empty-state">Add an expense to see category charts.</p>
              )}
            </section>

            <section className="card panel-wide">
              <div className="section-heading">
                <p className="eyebrow">Snapshot</p>
                <h2>Totals and alerts</h2>
              </div>
              <div className="hero-metrics hero-metrics-compact">
                <article>
                  <span>Income</span>
                  <strong>{formatCurrency(summary.income)}</strong>
                </article>
                <article>
                  <span>Expenses</span>
                  <strong>{formatCurrency(summary.expense)}</strong>
                </article>
                <article>
                  <span>Savings</span>
                  <strong>{formatCurrency(summary.savings)}</strong>
                </article>
                <button type="button" className="metric-alert-button" onClick={handleOpenAlerts}>
                  <span>Active alerts</span>
                  <strong>{alerts.length}</strong>
                </button>
              </div>
            </section>
          </>
        ) : null}

        {activeScreen === 'settings' ? (
          <>
            <section className="card panel-form">
              <div className="section-heading">
                <p className="eyebrow">Connection</p>
                <h2>Backend status</h2>
              </div>
              <p className={`sync-status sync-status-${connectionState}`}>{syncMessage}</p>
              <p className="empty-state">
                {isBackendConfigured
                  ? 'The app uses your configured API URL and will fall back to demo data if the server is unavailable.'
                  : 'No backend URL is configured, so the app is using local demo data.'}
              </p>
              {isBackendConfigured && authUser ? (
                <p className="empty-state">Logged in as {authUser.name || authUser.email || 'authenticated user'}.</p>
              ) : null}
            </section>

            <section className="card panel-form">
              <div className="section-heading">
                <p className="eyebrow">Actions</p>
                <h2>Account actions</h2>
              </div>
              <div className="form-actions">
                {isBackendConfigured ? (
                  <button type="button" className="ghost-button" onClick={handleLogout}>
                    Log out
                  </button>
                ) : null}
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  )
}

export default App
