import { useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  createBudget,
  createTransaction,
  deleteTransaction,
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
const budgetAlertThreshold = 0.8

const expenseCategories = [
  'Food',
  'Transportation',
  'Entertainment',
  'Bills',
  'Shopping',
  'Health',
  'Education',
  'Other',
]

const incomeCategories = ['Salary', 'Freelance', 'Gift', 'Investment', 'Other Income']

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

function App() {
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' })
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
  const [budgetForm, setBudgetForm] = useState({
    month: getCurrentMonthKey(),
    category: 'Food',
    limit: '',
  })
  const [filters, setFilters] = useState({ category: 'All', startDate: '', endDate: '' })
  const startupWarning = apiConfigurationWarning

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
    if (!isBackendConfigured) {
      return
    }

    if (!authToken) {
      return
    }

    let isActive = true

    async function syncFromBackend() {
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
        setConnectionState('online')
        setSyncMessage('Connected to backend.')
      } catch (error) {
        if (!isActive) {
          return
        }

        setConnectionState('local-fallback')
        setSyncMessage(
          error instanceof Error
            ? `Backend unavailable. Using local demo data. ${error.message}`
            : 'Backend unavailable. Using local demo data.',
        )
        setTransactions(createDemoTransactions())
        setBudgets(createSeedBudgets())
      }
    }

    syncFromBackend()

    return () => {
      isActive = false
    }
  }, [authToken])

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

  const chartRows = useMemo(() => {
    const entries = Object.entries(expenseByCategory).sort((left, right) => right[1] - left[1])
    const highest = entries[0]?.[1] || 1

    return entries.map(([category, amount]) => ({
      category,
      amount,
      width: (amount / highest) * 100,
    }))
  }, [expenseByCategory])

  const availableCategories = transactionForm.type === 'income' ? incomeCategories : expenseCategories
  const activeTransactionCategory = availableCategories.includes(transactionForm.category)
    ? transactionForm.category
    : availableCategories[0]

  const isAuthRoute = location.pathname === '/login' || location.pathname === '/register'
  const authMode = location.pathname === '/register' ? 'register' : 'login'

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

  const activeScreenInfo =
    screenTabs.find((screen) => screen.id === activeScreen) ?? screenTabs[0]

  function resetTransactionForm() {
    setTransactionForm({
      type: 'expense',
      category: 'Food',
      amount: '',
      date: new Date().toISOString().slice(0, 10),
      note: '',
    })
    setEditingTransactionId(null)
  }

  async function handleTransactionSubmit(event) {
    event.preventDefault()

    const amount = Number.parseFloat(transactionForm.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return
    }

    const nextTransaction = {
      id: editingTransactionId || crypto.randomUUID(),
      type: transactionForm.type,
      category: activeTransactionCategory,
      amount,
      date: transactionForm.date,
      note: transactionForm.note.trim(),
    }

    try {
      const savedTransaction = isBackendConfigured
        ? editingTransactionId
          ? await updateTransaction(editingTransactionId, nextTransaction)
          : await createTransaction(nextTransaction)
        : nextTransaction

      setTransactions((currentTransactions) => {
        if (editingTransactionId) {
          return currentTransactions.map((transaction) =>
            transaction.id === editingTransactionId ? savedTransaction : transaction,
          )
        }

        return [savedTransaction, ...currentTransactions]
      })

      setConnectionState(isBackendConfigured ? 'online' : 'local')
      setSyncMessage(isBackendConfigured ? 'Transaction saved to backend.' : 'Transaction saved locally.')
    } catch (error) {
      setTransactions((currentTransactions) => {
        if (editingTransactionId) {
          return currentTransactions.map((transaction) =>
            transaction.id === editingTransactionId ? nextTransaction : transaction,
          )
        }

        return [nextTransaction, ...currentTransactions]
      })
      setConnectionState('local-fallback')
      setSyncMessage(
        error instanceof Error
          ? `Saved locally because the backend request failed. ${error.message}`
          : 'Saved locally because the backend request failed.',
      )
    }

    resetTransactionForm()
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

  async function clearStoredData() {
    if (isBackendConfigured) {
      setSyncMessage('Reloading data from backend...')

      try {
        const [remoteTransactions, remoteBudgets] = await Promise.all([
          fetchTransactions(),
          fetchBudgets(),
        ])

        setTransactions(Array.isArray(remoteTransactions) ? remoteTransactions : [])
        setBudgets(Array.isArray(remoteBudgets) ? remoteBudgets : [])
        setConnectionState('online')
        setSyncMessage('Data reloaded from backend.')
      } catch (error) {
        setConnectionState('local-fallback')
        setSyncMessage(
          error instanceof Error
            ? `Could not reload backend data. ${error.message}`
            : 'Could not reload backend data.',
        )
      }

      return
    }

    setTransactions(createDemoTransactions())
    setBudgets(createSeedBudgets())
    resetTransactionForm()
    setFilters({ category: 'All', startDate: '', endDate: '' })
  }

  async function handleAuthSubmit(event) {
    event.preventDefault()

    if (!isBackendConfigured) {
      setAuthError('Backend URL is not configured. Set VITE_API_BASE_URL first.')
      return
    }

    const email = authForm.email.trim()
    const password = authForm.password
    const name = authForm.name.trim()

    if (!email || !password) {
      setAuthError('Email and password are required.')
      return
    }

    if (authMode === 'register' && !name) {
      setAuthError('Name is required for sign up.')
      return
    }

    setAuthError('')
    setAuthStatusMessage(authMode === 'login' ? 'Signing in...' : 'Creating your account...')

    try {
      let authPayload

      if (authMode === 'login') {
        authPayload = await loginUser({ email, password })
      } else {
        const registrationPayload = await registerUser({ name, email, password })

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
      }

      setAuthToken(authPayload.token)
      setAuthUser(authPayload.user)
      setAuthStatusMessage(authMode === 'login' ? 'Welcome back.' : 'Account created successfully.')
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
    setTransactions([])
    setBudgets([])
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
            <p className="eyebrow">Welcome to PersBudgApp</p>
            <h1>Plan your money with a secure personal account.</h1>
            <p className="hero-description">
              Sign up or log in to continue. Your dashboard data will sync through your backend using JWT authentication.
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
                }}
              >
                <span>Sign Up</span>
                <small>Create a new account</small>
              </button>
            </div>

            <form className="stacked-form" onSubmit={handleAuthSubmit}>
              {authMode === 'register' ? (
                <label>
                  Full name
                  <input
                    type="text"
                    value={authForm.name}
                    onChange={(event) =>
                      setAuthForm((currentForm) => ({ ...currentForm, name: event.target.value }))
                    }
                    placeholder="Jane Budget"
                  />
                </label>
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
                Password
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) =>
                    setAuthForm((currentForm) => ({ ...currentForm, password: event.target.value }))
                  }
                  placeholder="Enter a strong password"
                />
              </label>

              {authStatusMessage ? <p className="sync-status sync-status-loading">{authStatusMessage}</p> : null}
              {authError ? <p className="sync-status sync-status-local-fallback">{authError}</p> : null}

              <div className="form-actions">
                <button type="submit" className="primary-button">
                  {authMode === 'login' ? 'Log In' : 'Sign Up'}
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

      <header className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Personal Budget Dashboard</p>
          <h1>Track your income, expenses, and savings</h1>
          <p className="hero-description">
            Add transactions, monitor category budgets, spot overspending early, and keep your financial
            history available in the browser for future visits.
          </p>

          <p className={`sync-status sync-status-${connectionState}`}>
            {syncMessage}
          </p>

          <div className="hero-actions">
            <button type="button" className="secondary-button" onClick={clearStoredData}>
              {isBackendConfigured ? 'Reload backend data' : 'Reset demo data'}
            </button>
          </div>
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
          <article>
            <span>Active alerts</span>
            <strong>{alerts.length}</strong>
          </article>
        </div>
      </header>

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

      <main className="dashboard-grid">
        {activeScreen === 'dashboard' ? (
          <>
            <section className="card panel-wide screen-banner">
              <div>
                <p className="eyebrow">Current view</p>
                <h2>{activeScreenInfo.label}</h2>
                <p className="hero-description">{activeScreenInfo.description}</p>
              </div>
            </section>

            <section className="card panel-form">
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
                  {editingTransactionId ? (
                    <button type="button" className="ghost-button" onClick={resetTransactionForm}>
                      Cancel edit
                    </button>
                  ) : null}
                </div>
              </form>
            </section>

            <section className="card panel-form">
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

            <section className="card panel-wide">
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
            <section className="card panel-wide screen-banner">
              <div>
                <p className="eyebrow">Current view</p>
                <h2>{activeScreenInfo.label}</h2>
                <p className="hero-description">{activeScreenInfo.description}</p>
              </div>
            </section>

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
                  {editingTransactionId ? (
                    <button type="button" className="ghost-button" onClick={resetTransactionForm}>
                      Cancel edit
                    </button>
                  ) : null}
                </div>
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
            <section className="card panel-wide screen-banner">
              <div>
                <p className="eyebrow">Current view</p>
                <h2>{activeScreenInfo.label}</h2>
                <p className="hero-description">{activeScreenInfo.description}</p>
              </div>
            </section>

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
            <section className="card panel-wide screen-banner">
              <div>
                <p className="eyebrow">Current view</p>
                <h2>{activeScreenInfo.label}</h2>
                <p className="hero-description">{activeScreenInfo.description}</p>
              </div>
            </section>

            <section className="card panel-wide">
              <div className="section-heading">
                <p className="eyebrow">Insights</p>
                <h2>Spending by category</h2>
              </div>

              {chartRows.length > 0 ? (
                <div className="chart-list">
                  {chartRows.map((row) => (
                    <div className="chart-row" key={row.category}>
                      <div className="chart-meta">
                        <span>{row.category}</span>
                        <strong>{formatCurrency(row.amount)}</strong>
                      </div>
                      <div className="progress-track chart-track" aria-hidden="true">
                        <span className="progress-fill chart-fill" style={{ width: `${row.width}%` }} />
                      </div>
                    </div>
                  ))}
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
                <article>
                  <span>Active alerts</span>
                  <strong>{alerts.length}</strong>
                </article>
              </div>
            </section>
          </>
        ) : null}

        {activeScreen === 'settings' ? (
          <>
            <section className="card panel-wide screen-banner">
              <div>
                <p className="eyebrow">Current view</p>
                <h2>{activeScreenInfo.label}</h2>
                <p className="hero-description">{activeScreenInfo.description}</p>
              </div>
            </section>

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
                <h2>Friendly reset and refresh</h2>
              </div>
              <p className="empty-state">
                Use the button below to reload backend data or restore the local sample set.
              </p>
              <div className="form-actions">
                <button type="button" className="secondary-button" onClick={clearStoredData}>
                  {isBackendConfigured ? 'Reload backend data' : 'Reset demo data'}
                </button>
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
