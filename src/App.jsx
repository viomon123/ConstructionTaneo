import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

function App() {
  const [inventory, setInventory] = useState([])
  const [expenses, setExpenses] = useState([])
  const [dailyChanges, setDailyChanges] = useState([])
  const [activeTab, setActiveTab] = useState('inventory')

  useEffect(() => {
    const fetchData = async () => {
      const { data: inv, error: invError } = await supabase.from('inventory').select('*')
      const { data: exp, error: expError } = await supabase.from('expenses').select('*')
      const { data: changes, error: changesError } = await supabase
        .from('daily_changes')
        .select('*')
        .gte('change_date', new Date().toISOString().split('T')[0])

      if (invError) console.error(invError)
      if (expError) console.error(expError)
      if (changesError) console.error(changesError)

      if (inv) setInventory(inv)
      if (exp) setExpenses(exp)
      if (changes) setDailyChanges(changes)
    }

    fetchData()
  }, [])

  const addItem = async (item) => {
    const { data, error } = await supabase
      .from('inventory')
      .insert([{ name: item.name, quantity_left: item.quantity, current_price: item.price, total_purchased_cost: item.quantity * item.price }])
      .select()
    if (error) { console.error('Insert inventory error:', error); return }
    const inserted = data[0]
    const { data: change } = await supabase.from('daily_changes').insert([
      { inventory_id: inserted.id, quantity_added: item.quantity, quantity_used: 0, price_paid: item.price, change_date: new Date().toISOString() }
    ]).select()
    setInventory(prev => [...prev, inserted])
    if (change) setDailyChanges(prev => [...prev, ...change])
  }

  const updateItem = async (id, updates) => {
    const item = inventory.find(i => i.id === id)
    const addedQty = updates.quantity - item.quantity_left
    const additionalCost = addedQty > 0 ? addedQty * updates.price : 0
    const newTotalCost = (item.total_purchased_cost || 0) + additionalCost
    const { error } = await supabase.from('inventory').update({ quantity_left: updates.quantity, current_price: updates.price, total_purchased_cost: newTotalCost, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { console.error('Update inventory error:', error); return }
    if (addedQty !== 0) {
      const { data: change } = await supabase.from('daily_changes').insert([
        { inventory_id: id, quantity_added: addedQty > 0 ? addedQty : 0, quantity_used: 0, price_paid: updates.price, change_date: new Date().toISOString() }
      ]).select()
      if (change) setDailyChanges(prev => [...prev, ...change])
    }
    setInventory(prev => prev.map(i => i.id === id ? { ...i, quantity_left: updates.quantity, current_price: updates.price, total_purchased_cost: newTotalCost } : i))
  }

  const consumeItem = async (id, quantityUsed) => {
    const item = inventory.find(i => i.id === id)
    const newQty = item.quantity_left - quantityUsed
    if (newQty < 0) { alert('Not enough stock!'); return }
    const { error } = await supabase.from('inventory').update({ quantity_left: newQty, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { console.error('Use item error:', error); return }
    const { data: change } = await supabase.from('daily_changes').insert([
      { inventory_id: id, quantity_added: 0, quantity_used: quantityUsed, price_paid: item.current_price, change_date: new Date().toISOString() }
    ]).select()
    setInventory(prev => prev.map(i => i.id === id ? { ...i, quantity_left: newQty } : i))
    if (change) setDailyChanges(prev => [...prev, ...change])
  }

  const deleteItem = async (id) => {
    const { error } = await supabase.from('inventory').delete().eq('id', id)
    if (error) { console.error('Delete inventory error:', error); return }
    setInventory(prev => prev.filter(i => i.id !== id))
  }

  const addExpense = async (expense) => {
    const { data, error } = await supabase.from('expenses').insert([{ category: expense.category, amount: expense.amount, expense_date: expense.date }]).select()
    if (error) { console.error('Insert expense error:', error); return }
    setExpenses(prev => [...prev, ...data])
  }

  const totalInventoryCost = inventory.reduce((sum, item) => sum + (item.total_purchased_cost || 0), 0)

  const expensesByMonth = expenses.reduce((acc, exp) => {
    const month = exp.expense_date.slice(0, 7)
    if (!acc[month]) acc[month] = {}
    if (!acc[month][exp.category]) acc[month][exp.category] = 0
    acc[month][exp.category] += exp.amount
    return acc
  }, {})

  const todaysSummary = dailyChanges.reduce((acc, change) => {
    const id = change.inventory_id
    if (!acc[id]) acc[id] = { added: 0, used: 0 }
    acc[id].added += change.quantity_added || 0
    acc[id].used += change.quantity_used || 0
    return acc
  }, {})

  return (
    <div className="app-wrapper">
      <div className="app-header">
        <h1>🏗️ Construction Inventory</h1>
      </div>

      <div className="tab-bar">
        <button className={activeTab === 'inventory' ? 'active' : ''} onClick={() => setActiveTab('inventory')}>📦 Inventory</button>
        <button className={activeTab === 'expenses' ? 'active' : ''} onClick={() => setActiveTab('expenses')}>💸 Expenses</button>
        <button className={activeTab === 'daily' ? 'active' : ''} onClick={() => setActiveTab('daily')}>📋 Today</button>
      </div>

      <div className="tab-content">
        {activeTab === 'inventory' && <InventoryTab inventory={inventory} addItem={addItem} updateItem={updateItem} deleteItem={deleteItem} consumeItem={consumeItem} totalCost={totalInventoryCost} todaysSummary={todaysSummary} />}
        {activeTab === 'expenses' && <ExpensesTab addExpense={addExpense} expensesByMonth={expensesByMonth} />}
        {activeTab === 'daily' && <DailyLogTab inventory={inventory} todaysSummary={todaysSummary} />}
      </div>
    </div>
  )
}

function InventoryTab({ inventory, addItem, updateItem, deleteItem, consumeItem, totalCost, todaysSummary }) {
  const [form, setForm] = useState({ name: '', quantity: '', price: '' })
  const [editing, setEditing] = useState(null)
  const [useQty, setUseQty] = useState({})
  const [showForm, setShowForm] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (editing) {
      updateItem(editing, { quantity: parseInt(form.quantity), price: parseFloat(form.price) })
      setEditing(null)
    } else {
      addItem({ name: form.name, quantity: parseInt(form.quantity), price: parseFloat(form.price) })
    }
    setForm({ name: '', quantity: '', price: '' })
    setShowForm(false)
  }

  const startEdit = (item) => {
    setEditing(item.id)
    setForm({ name: item.name, quantity: item.quantity_left, price: item.current_price })
    setShowForm(true)
  }

  const handleUse = (id) => {
    const qty = parseInt(useQty[id])
    if (!qty || qty <= 0) return alert('Enter a valid quantity')
    consumeItem(id, qty)
    setUseQty(prev => ({ ...prev, [id]: '' }))
  }

  return (
    <div>
      <div className="total-banner">
        <span className="total-banner-label">Total Purchased Cost</span>
        <span className="total-banner-value">${totalCost.toFixed(2)}</span>
      </div>

      {!showForm && (
        <button className="btn btn-success" style={{ marginBottom: '16px' }} onClick={() => setShowForm(true)}>+ Add Item</button>
      )}

      {showForm && (
        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <input type="text" placeholder="Item Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required disabled={!!editing} />
              <input type="number" placeholder="Quantity" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} required />
              <input type="number" step="0.01" placeholder="Price per unit" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} required />
              <button type="submit" className="btn btn-primary">{editing ? 'Update Item' : 'Add Item'}</button>
              <button type="button" className="btn btn-gray" onClick={() => { setShowForm(false); setEditing(null); setForm({ name: '', quantity: '', price: '' }) }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {inventory.map(item => (
        <div key={item.id} className="inventory-card">
          <div className="inventory-card-header">
            <span className="inventory-card-name">{item.name}</span>
            <span style={{ fontSize: '13px', color: 'var(--gray-500)' }}>${item.current_price.toFixed(2)}/unit</span>
          </div>

          <div className="inventory-card-stats">
            <div className="stat-box">
              <div className="stat-label">Qty Left</div>
              <div className="stat-value">{item.quantity_left}</div>
            </div>
            <div className="stat-box">
              <div className="stat-label">Total Purchased</div>
              <div className="stat-value">${(item.total_purchased_cost || 0).toFixed(2)}</div>
            </div>
            <div className="stat-box">
              <div className="stat-label">Added Today</div>
              <div className="stat-value added">+{todaysSummary[item.id]?.added || 0}</div>
            </div>
            <div className="stat-box">
              <div className="stat-label">Used Today</div>
              <div className="stat-value used">-{todaysSummary[item.id]?.used || 0}</div>
            </div>
          </div>

          <div className="use-row">
            <input
              type="number"
              min="1"
              placeholder="Qty to use"
              value={useQty[item.id] || ''}
              onChange={e => setUseQty(prev => ({ ...prev, [item.id]: e.target.value }))}
            />
            <button className="btn btn-warning btn-sm" onClick={() => handleUse(item.id)}>Use</button>
          </div>

          <div className="inventory-card-actions">
            <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => startEdit(item)}>Edit</button>
            <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={() => deleteItem(item.id)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function DailyLogTab({ inventory, todaysSummary }) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div>
      <div className="section-title">Today's Log</div>
      <div className="daily-date">{today}</div>

      {Object.keys(todaysSummary).length === 0 ? (
        <div className="empty-state">No activity recorded today.</div>
      ) : (
        Object.entries(todaysSummary).map(([id, summary]) => {
          const item = inventory.find(i => String(i.id) === String(id))
          return (
            <div key={id} className="log-card">
              <span className="log-card-name">{item ? item.name : 'Unknown'}</span>
              <div className="log-badges">
                <span className="badge badge-added">+{summary.added}</span>
                <span className="badge badge-used">-{summary.used}</span>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

function ExpensesTab({ addExpense, expensesByMonth }) {
  const [form, setForm] = useState({ category: '', amount: '', date: '' })
  const [showForm, setShowForm] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    addExpense({ category: form.category, amount: parseFloat(form.amount), date: form.date })
    setForm({ category: '', amount: '', date: '' })
    setShowForm(false)
  }

  return (
    <div>
      {!showForm && (
        <button className="btn btn-success" style={{ marginBottom: '16px' }} onClick={() => setShowForm(true)}>+ Add Expense</button>
      )}

      {showForm && (
        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <input type="text" placeholder="Category (e.g. Labor, Materials)" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} required />
              <input type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
              <button type="submit" className="btn btn-primary">Add Expense</button>
              <button type="button" className="btn btn-gray" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {Object.entries(expensesByMonth).map(([month, categories]) => (
        <div key={month} className="month-card">
          <div className="month-title">{month}</div>
          {Object.entries(categories).map(([cat, total]) => (
            <div key={cat} className="expense-row">
              <span>{cat}</span>
              <span>${total.toFixed(2)}</span>
            </div>
          ))}
          <div className="expense-total">
            <span>Total</span>
            <span>${Object.values(categories).reduce((s, a) => s + a, 0).toFixed(2)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export default App