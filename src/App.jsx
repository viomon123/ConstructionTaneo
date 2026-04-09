import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

const CONTRACTOR_PIN = '1275'

function App() {
  const [inventory, setInventory] = useState([])
  const [expenses, setExpenses] = useState([])
  const [dailyChanges, setDailyChanges] = useState([])
  const [activeTab, setActiveTab] = useState('inventory')
  const [isContractor, setIsContractor] = useState(false)
  const [showPinModal, setShowPinModal] = useState(false)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      const { data: inv } = await supabase.from('inventory').select('*')
      const { data: exp } = await supabase.from('expenses').select('*')

      if (inv) setInventory(inv)
      if (exp) setExpenses(exp)
    }

    fetchData()
  }, [])

  const handlePinSubmit = () => {
    if (pin === CONTRACTOR_PIN) {
      setIsContractor(true)
      setShowPinModal(false)
      setPin('')
      setPinError(false)
    } else {
      setPinError(true)
      setPin('')
    }
  }

  const handleLogout = () => setIsContractor(false)

  // =========================
  // 💰 ADD PAYMENT FUNCTION
  // =========================
  const addPayment = async (expenseId, paymentAmount) => {
    const expense = expenses.find(e => e.id === expenseId)

    const newPaid = (expense.amount_paid || 0) + paymentAmount

    if (newPaid > expense.amount) {
      alert('Payment exceeds total amount!')
      return
    }

    const { error } = await supabase
      .from('expenses')
      .update({ amount_paid: newPaid })
      .eq('id', expenseId)

    if (error) {
      console.error(error)
      return
    }

    setExpenses(prev =>
      prev.map(e =>
        e.id === expenseId ? { ...e, amount_paid: newPaid } : e
      )
    )
  }

  const addExpense = async (expense) => {
    const { data, error } = await supabase
      .from('expenses')
      .insert([{
        category: expense.category,
        amount: expense.amount,
        amount_paid: 0,
        expense_date: expense.date
      }])
      .select()

    if (error) return console.error(error)

    setExpenses(prev => [...prev, ...data])
  }

  return (
    <div className="app-wrapper">

      {/* PIN MODAL */}
      {showPinModal && (
        <div className="receipt-modal" onClick={() => setShowPinModal(false)}>
          <div className="receipt-modal-inner" onClick={e => e.stopPropagation()}>
            <input
              type="password"
              placeholder="Enter PIN"
              value={pin}
              onChange={e => setPin(e.target.value)}
            />
            <button onClick={handlePinSubmit}>Login</button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="app-header">
        <h1>🏗️ Construction Tracker</h1>

        {isContractor ? (
          <button onClick={handleLogout}>Logout</button>
        ) : (
          <button onClick={() => setShowPinModal(true)}>Contractor Login</button>
        )}
      </div>

      {/* TAB */}
      <div className="tab-bar">
        <button onClick={() => setActiveTab('expenses')}>Expenses</button>
      </div>

      <div className="tab-content">
        {activeTab === 'expenses' && (
          <ExpensesTab
            expenses={expenses}
            addExpense={addExpense}
            addPayment={addPayment}
            isContractor={isContractor}
          />
        )}
      </div>
    </div>
  )
}

// =========================
// 💸 EXPENSE TAB
// =========================
function ExpensesTab({ expenses, addExpense, addPayment, isContractor }) {
  const [form, setForm] = useState({ category: '', amount: '', date: '' })

  const handleSubmit = (e) => {
    e.preventDefault()
    addExpense({
      category: form.category,
      amount: parseFloat(form.amount),
      date: form.date
    })
    setForm({ category: '', amount: '', date: '' })
  }

  return (
    <div>

      {isContractor && (
        <form onSubmit={handleSubmit}>
          <input
            placeholder="Category"
            value={form.category}
            onChange={e => setForm({ ...form, category: e.target.value })}
          />
          <input
            type="number"
            placeholder="Amount"
            value={form.amount}
            onChange={e => setForm({ ...form, amount: e.target.value })}
          />
          <input
            type="date"
            value={form.date}
            onChange={e => setForm({ ...form, date: e.target.value })}
          />
          <button type="submit">Add Expense</button>
        </form>
      )}

      {expenses.map(exp => {
        const paid = exp.amount_paid || 0
        const remaining = exp.amount - paid
        const percent = (paid / exp.amount) * 100

        return (
          <div key={exp.id} className="expense-card">

            <div><strong>{exp.category}</strong></div>
            <div>Date: {exp.expense_date}</div>

            <div>Total: ₱{exp.amount.toFixed(2)}</div>

            <div style={{ color: 'green' }}>
              Paid: ₱{paid.toFixed(2)}
            </div>

            <div style={{ color: 'red' }}>
              Remaining: ₱{remaining.toFixed(2)}
            </div>

            {/* Progress Bar */}
            <div style={{
              background: '#eee',
              height: '8px',
              borderRadius: '5px',
              marginTop: '6px'
            }}>
              <div style={{
                width: `${percent}%`,
                height: '100%',
                background: 'green',
                borderRadius: '5px'
              }} />
            </div>

            {/* PAY BUTTON */}
            {isContractor && (
              <button
                onClick={() => {
                  const val = prompt('Enter payment amount:')
                  if (!val) return
                  addPayment(exp.id, parseFloat(val))
                }}
              >
                Pay
              </button>
            )}

          </div>
        )
      })}
    </div>
  )
}

export default App