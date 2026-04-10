import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

const CONTRACTOR_PIN = '1275' // change this to your desired PIN

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
      const { data: inv, error: invError } = await supabase.from('inventory').select('*')
      const { data: exp, error: expError } = await supabase.from('expenses').select('*')

      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      const { data: changes, error: changesError } = await supabase
        .from('daily_changes')
        .select('*')
        .gte('change_date', todayStart.toISOString())
        .order('change_date', { ascending: false })

      if (invError) console.error(invError)
      if (expError) console.error(expError)
      if (changesError) console.error(changesError)

      if (inv) setInventory(inv)
      if (exp) setExpenses(exp)
      if (changes) setDailyChanges(changes)
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

  const handleLogout = () => {
    setIsContractor(false)
  }

  const addItem = async (item) => {
    const { data, error } = await supabase
      .from('inventory')
      .insert([{
        name: item.name,
        quantity_left: item.quantity,
        current_price: item.price,
        total_purchased_cost: item.quantity * item.price,
        amount_paid: item.amountPaid || 0
      }])
      .select()

    if (error) { console.error('Insert inventory error:', error); return }

    const inserted = data[0]

    const { data: change, error: changeError } = await supabase
      .from('daily_changes')
      .insert([{
        inventory_id: Number(inserted.id),
        inventory_name: String(inserted.name),
        action: 'added',
        quantity_added: Number(item.quantity),
        quantity_used: 0,
        price_paid: Number(item.price),
        change_date: new Date().toISOString()
      }])
      .select()

    if (changeError) { console.error('daily_change error:', JSON.stringify(changeError, null, 2)); return }

    setInventory(prev => [...prev, inserted])
    if (change) setDailyChanges(prev => [change[0], ...prev])
  }

  const updateItem = async (id, updates) => {
    const item = inventory.find(i => i.id === id)
    const addedQty = updates.quantity - item.quantity_left
    const additionalCost = addedQty > 0 ? addedQty * updates.price : 0
    const newTotalCost = (item.total_purchased_cost || 0) + additionalCost

    const { error } = await supabase
      .from('inventory')
      .update({
        quantity_left: updates.quantity,
        current_price: updates.price,
        total_purchased_cost: newTotalCost,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    if (error) { console.error('Update inventory error:', error); return }

    if (addedQty !== 0) {
      const { data: change, error: changeError } = await supabase
        .from('daily_changes')
        .insert([{
          inventory_id: Number(id),
          inventory_name: String(item.name),
          action: addedQty > 0 ? 'added' : 'reduced',
          quantity_added: addedQty > 0 ? Number(addedQty) : 0,
          quantity_used: addedQty < 0 ? Number(Math.abs(addedQty)) : 0,
          price_paid: Number(updates.price),
          change_date: new Date().toISOString()
        }])
        .select()

      if (changeError) console.error('daily_change error:', changeError)
      else if (change) setDailyChanges(prev => [change[0], ...prev])
    }

    setInventory(prev => prev.map(i =>
      i.id === id ? { ...i, quantity_left: updates.quantity, current_price: updates.price, total_purchased_cost: newTotalCost } : i
    ))
  }

  const updatePayment = async (id, amountPaid) => {
    const item = inventory.find(i => i.id === id)
    if (!item) return

    const newAmountPaid = Math.min(amountPaid, item.total_purchased_cost)

    const { error } = await supabase
      .from('inventory')
      .update({ amount_paid: newAmountPaid })
      .eq('id', id)

    if (error) { console.error('Update payment error:', error); return }

    setInventory(prev => prev.map(i =>
      i.id === id ? { ...i, amount_paid: newAmountPaid } : i
    ))
  }

  const consumeItem = async (id, quantityUsed) => {
    const item = inventory.find(i => i.id === id)
    const newQty = item.quantity_left - quantityUsed

    if (newQty < 0) { alert('Not enough stock!'); return }

    const { error } = await supabase
      .from('inventory')
      .update({ quantity_left: newQty, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) { console.error('Use item error:', error); return }

    const { data: change, error: changeError } = await supabase
      .from('daily_changes')
      .insert([{
        inventory_id: Number(id),
        inventory_name: String(item.name),
        action: 'used',
        quantity_added: 0,
        quantity_used: Number(quantityUsed),
        price_paid: Number(item.current_price),
        change_date: new Date().toISOString()
      }])
      .select()

    if (changeError) console.error('daily_change error:', changeError)
    else if (change) setDailyChanges(prev => [change[0], ...prev])

    setInventory(prev => prev.map(i => i.id === id ? { ...i, quantity_left: newQty } : i))
  }

  const deleteItem = async (id) => {
    const { error } = await supabase.from('inventory').delete().eq('id', id)
    if (error) { console.error('Delete inventory error:', error); return }
    setInventory(prev => prev.filter(i => i.id !== id))
  }

  const addExpense = async (expense, receiptFile) => {
    let receipt_url = null

    if (receiptFile) {
      const fileName = `${Date.now()}-${receiptFile.name}`
      const { error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(fileName, receiptFile)

      if (uploadError) {
        console.error('Upload error:', uploadError)
      } else {
        const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(fileName)
        receipt_url = urlData.publicUrl
      }
    }

    const { data, error } = await supabase
      .from('expenses')
      .insert([{
        category: expense.category,
        amount: expense.amount,
        expense_date: expense.date,
        receipt_url
      }])
      .select()

    if (error) { console.error('Insert expense error:', error); return }
    setExpenses(prev => [...prev, ...data])
  }

  const removeReceiptFromStorage = async (receiptUrl) => {
    if (!receiptUrl) return
    const segment = receiptUrl.split('/receipts/')[1]
    if (!segment) return
    const { error } = await supabase.storage.from('receipts').remove([decodeURIComponent(segment)])
    if (error) console.error('Storage remove receipt:', error)
  }

  const updateExpense = async (id, expense, receiptFile) => {
    const existing = expenses.find(e => e.id === id)
    let receipt_url

    if (receiptFile) {
      if (existing?.receipt_url) await removeReceiptFromStorage(existing.receipt_url)
      const fileName = `${Date.now()}-${receiptFile.name}`
      const { error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(fileName, receiptFile)

      if (uploadError) {
        console.error('Upload error:', uploadError)
      } else {
        const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(fileName)
        receipt_url = urlData.publicUrl
      }
    }

    const payload = {
      category: expense.category,
      amount: expense.amount,
      expense_date: expense.date
    }
    if (receipt_url !== undefined) payload.receipt_url = receipt_url

    const { data, error } = await supabase
      .from('expenses')
      .update(payload)
      .eq('id', id)
      .select()

    if (error) { console.error('Update expense error:', error); return }
    const updated = data?.[0]
    if (updated) setExpenses(prev => prev.map(e => (e.id === id ? updated : e)))
  }

  const deleteExpense = async (id) => {
    const exp = expenses.find(e => e.id === id)
    if (exp?.receipt_url) await removeReceiptFromStorage(exp.receipt_url)
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) { console.error('Delete expense error:', error); return }
    setExpenses(prev => prev.filter(e => e.id !== id))
  }

  const totalInventoryCost = inventory.reduce((sum, item) => sum + (item.total_purchased_cost || 0), 0)
  const totalAmountPaid = inventory.reduce((sum, item) => sum + (item.amount_paid || 0), 0)
  const totalRemainingBalance = totalInventoryCost - totalAmountPaid

  const expensesByMonth = expenses.reduce((acc, exp) => {
    const month = exp.expense_date.slice(0, 7)
    if (!acc[month]) acc[month] = []
    acc[month].push(exp)
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
      {/* PIN MODAL */}
      {showPinModal && (
        <div className="receipt-modal" onClick={() => { setShowPinModal(false); setPin(''); setPinError(false) }}>
          <div className="receipt-modal-inner" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '18px', fontWeight: '700', marginBottom: '12px' }}>Contractor Login</div>
            <div className="form-group">
              <input
                type="password"
                placeholder="Enter PIN"
                value={pin}
                onChange={e => { setPin(e.target.value); setPinError(false) }}
                onKeyDown={e => e.key === 'Enter' && handlePinSubmit()}
                style={{ border: pinError ? '1.5px solid var(--danger)' : undefined }}
                autoFocus
              />
              {pinError && <div style={{ color: 'var(--danger)', fontSize: '13px' }}>Incorrect PIN. Try again.</div>}
              <button className="btn btn-primary" onClick={handlePinSubmit}>Login</button>
              <button className="btn btn-gray" onClick={() => { setShowPinModal(false); setPin(''); setPinError(false) }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="app-header">
        <h1>🏗️ Construction Inventory</h1>
        <div style={{ marginTop: '6px' }}>
          {isContractor ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              <span style={{ fontSize: '12px', background: 'rgba(255,255,255,0.2)', padding: '3px 10px', borderRadius: '20px' }}>🔧 Contractor Mode</span>
              <button onClick={handleLogout} style={{ fontSize: '12px', background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', padding: '3px 10px', borderRadius: '20px', cursor: 'pointer' }}>Logout</button>
            </div>
          ) : (
            <button onClick={() => setShowPinModal(true)} style={{ fontSize: '12px', background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', padding: '3px 10px', borderRadius: '20px', cursor: 'pointer' }}>🔑 Contractor Login</button>
          )}
        </div>
      </div>

      {/* TAB BAR */}
      <div className="tab-bar">
        <button className={activeTab === 'inventory' ? 'active' : ''} onClick={() => setActiveTab('inventory')}>📦 Inventory</button>
        <button className={activeTab === 'expenses' ? 'active' : ''} onClick={() => setActiveTab('expenses')}>💸 Expenses</button>
        <button className={activeTab === 'daily' ? 'active' : ''} onClick={() => setActiveTab('daily')}>📋 Today</button>
      </div>

      {/* CONTENT */}
      <div className="tab-content">
        {activeTab === 'inventory' && (
          <InventoryTab
            inventory={inventory}
            addItem={addItem}
            updateItem={updateItem}
            updatePayment={updatePayment}
            deleteItem={deleteItem}
            consumeItem={consumeItem}
            totalCost={totalInventoryCost}
            totalAmountPaid={totalAmountPaid}
            totalRemainingBalance={totalRemainingBalance}
            todaysSummary={todaysSummary}
            isContractor={isContractor}
          />
        )}
        {activeTab === 'expenses' && (
          <ExpensesTab
            addExpense={addExpense}
            updateExpense={updateExpense}
            deleteExpense={deleteExpense}
            expensesByMonth={expensesByMonth}
            isContractor={isContractor}
          />
        )}
        {activeTab === 'daily' && (
          <DailyLogTab dailyChanges={dailyChanges} />
        )}
      </div>
    </div>
  )
}

function InventoryTab({ inventory, addItem, updateItem, updatePayment, deleteItem, consumeItem, totalCost, totalAmountPaid, totalRemainingBalance, todaysSummary, isContractor }) {
  const [form, setForm] = useState({ name: '', quantity: '', price: '', amountPaid: '' })
  const [editing, setEditing] = useState(null)
  const [useQty, setUseQty] = useState({})
  const [paymentInput, setPaymentInput] = useState({})
  const [showForm, setShowForm] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (editing) {
      updateItem(editing, { quantity: parseInt(form.quantity), price: parseFloat(form.price) })
      setEditing(null)
    } else {
      addItem({ name: form.name, quantity: parseInt(form.quantity), price: parseFloat(form.price), amountPaid: parseFloat(form.amountPaid) || 0 })
    }
    setForm({ name: '', quantity: '', price: '', amountPaid: '' })
    setShowForm(false)
  }

  const startEdit = (item) => {
    setEditing(item.id)
    setForm({ name: item.name, quantity: item.quantity_left, price: item.current_price, amountPaid: item.amount_paid || 0 })
    setShowForm(true)
  }

  const handleUse = (id) => {
    const qty = parseInt(useQty[id])
    if (!qty || qty <= 0) return alert('Enter a valid quantity')
    consumeItem(id, qty)
    setUseQty(prev => ({ ...prev, [id]: '' }))
  }

  const handlePaymentUpdate = (id) => {
    const amount = parseFloat(paymentInput[id])
    if (isNaN(amount) || amount < 0) return alert('Enter a valid amount')
    updatePayment(id, amount)
    setPaymentInput(prev => ({ ...prev, [id]: '' }))
  }

  return (
    <div>
      <div className="payment-summary">
        <div className="payment-box">
          <span className="payment-label">Total Cost</span>
          <span className="payment-value">₱{totalCost.toFixed(2)}</span>
        </div>
        <div className="payment-box">
          <span className="payment-label">Amount Paid</span>
          <span className="payment-value paid">₱{totalAmountPaid.toFixed(2)}</span>
        </div>
        <div className="payment-box">
          <span className="payment-label">Remaining Balance</span>
          <span className="payment-value balance">₱{totalRemainingBalance.toFixed(2)}</span>
        </div>
      </div>

      {/* Only contractors can add items */}
      {isContractor && !showForm && (
        <button className="btn btn-success" style={{ marginBottom: '16px' }} onClick={() => setShowForm(true)}>+ Add Item</button>
      )}

      {isContractor && showForm && (
        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <input type="text" placeholder="Item Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required disabled={!!editing} />
              <input type="number" placeholder="Quantity" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} required />
              <input type="number" step="0.01" placeholder="Price per unit" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} required />
              {!editing && <input type="number" step="0.01" placeholder="Amount paid (optional)" value={form.amountPaid} onChange={e => setForm({ ...form, amountPaid: e.target.value })} />}
              <button type="submit" className="btn btn-primary">{editing ? 'Update Item' : 'Add Item'}</button>
              <button type="button" className="btn btn-gray" onClick={() => { setShowForm(false); setEditing(null); setForm({ name: '', quantity: '', price: '', amountPaid: '' }) }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {inventory.map(item => {
        const remainingBalance = (item.total_purchased_cost || 0) - (item.amount_paid || 0)
        const paymentPercentage = item.total_purchased_cost > 0 ? ((item.amount_paid || 0) / item.total_purchased_cost) * 100 : 0
        return (
          <div key={item.id} className="inventory-card">
            <div className="inventory-card-header">
              <span className="inventory-card-name">{item.name}</span>
              <span style={{ fontSize: '13px', color: 'var(--gray-500)' }}>₱{item.current_price.toFixed(2)}/unit</span>
            </div>

            <div className="inventory-card-stats">
              <div className="stat-box">
                <div className="stat-label">Qty Left</div>
                <div className="stat-value">{item.quantity_left}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Total Cost</div>
                <div className="stat-value">₱{(item.total_purchased_cost || 0).toFixed(2)}</div>
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

            {/* Payment Status Section */}
            <div className="payment-status-card">
              <div className="payment-status-header">Payment Status</div>
              <div className="payment-progress-bar">
                <div className="progress-fill" style={{ width: `${paymentPercentage}%` }}></div>
              </div>
              <div className="payment-details">
                <div className="payment-detail-row">
                  <span className="payment-detail-label">Paid:</span>
                  <span className="payment-detail-value paid">₱{(item.amount_paid || 0).toFixed(2)}</span>
                </div>
                <div className="payment-detail-row">
                  <span className="payment-detail-label">Remaining:</span>
                  <span className="payment-detail-value balance">₱{remainingBalance.toFixed(2)}</span>
                </div>
                <div className="payment-detail-row">
                  <span className="payment-detail-label">Progress:</span>
                  <span className="payment-detail-value">{paymentPercentage.toFixed(0)}%</span>
                </div>
              </div>

              {/* Only contractors can update payment */}
              {isContractor && (
                <div className="payment-update-row">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Add payment"
                    value={paymentInput[item.id] || ''}
                    onChange={e => setPaymentInput(prev => ({ ...prev, [item.id]: e.target.value }))}
                  />
                  <button className="btn btn-info btn-sm" onClick={() => handlePaymentUpdate(item.id)}>Record Payment</button>
                </div>
              )}
            </div>

            {/* Only contractors can use/edit/delete */}
            {isContractor && (
              <>
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
              </>
            )}

            {/* Client sees a read-only notice */}
            {!isContractor && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--gray-400)', textAlign: 'center' }}>
                🔒 View only
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function DailyLogTab({ dailyChanges }) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  const actionStyle = (action) => {
    if (action === 'added') return { bg: '#dcfce7', color: '#15803d', label: '+ Added' }
    if (action === 'used') return { bg: '#fee2e2', color: '#b91c1c', label: '- Used' }
    return { bg: '#fef9c3', color: '#92400e', label: '~ Reduced' }
  }

  const formatTime = (iso) => {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true
    })
  }

  return (
    <div>
      <div className="section-title">Today's Log</div>
      <div className="daily-date">{today}</div>

      {dailyChanges.length === 0 ? (
        <div className="empty-state">No activity recorded today.</div>
      ) : (
        dailyChanges.map((change, i) => {
          const style = actionStyle(change.action)
          const qty = change.action === 'used' ? change.quantity_used : change.quantity_added
          return (
            <div key={change.id || i} className="log-card">
              <div>
                <div className="log-card-name">{change.inventory_name || 'Unknown'}</div>
                <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '2px' }}>
                  {formatTime(change.change_date)}
                </div>
              </div>
              <span className="badge" style={{ background: style.bg, color: style.color }}>
                {style.label} {qty}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}

function ExpensesTab({ addExpense, updateExpense, deleteExpense, expensesByMonth, isContractor }) {
  const [form, setForm] = useState({ category: '', amount: '', date: '' })
  const [receiptFile, setReceiptFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [existingReceiptUrl, setExistingReceiptUrl] = useState(null)
  const [viewingReceipt, setViewingReceipt] = useState(null)

  const resetForm = () => {
    setForm({ category: '', amount: '', date: '' })
    setReceiptFile(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setEditingId(null)
    setExistingReceiptUrl(null)
    setShowForm(false)
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setReceiptFile(file)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(file))
  }

  const startEdit = (exp) => {
    setEditingId(exp.id)
    setForm({
      category: exp.category,
      amount: String(exp.amount),
      date: exp.expense_date.slice(0, 10)
    })
    setReceiptFile(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setExistingReceiptUrl(exp.receipt_url || null)
    setShowForm(true)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const payload = { category: form.category, amount: parseFloat(form.amount), date: form.date }
    if (editingId) {
      updateExpense(editingId, payload, receiptFile)
    } else {
      addExpense(payload, receiptFile)
    }
    resetForm()
  }

  return (
    <div>
      {viewingReceipt && (
        <div className="receipt-modal" onClick={() => setViewingReceipt(null)}>
          <div className="receipt-modal-inner" onClick={e => e.stopPropagation()}>
            <button className="receipt-modal-close" onClick={() => setViewingReceipt(null)}>✕</button>
            <img src={viewingReceipt} alt="Receipt" style={{ width: '100%', borderRadius: '8px' }} />
          </div>
        </div>
      )}

      {/* Only contractors can add expenses */}
      {isContractor && !showForm && (
        <button className="btn btn-success" style={{ marginBottom: '16px' }} onClick={() => { setEditingId(null); setExistingReceiptUrl(null); setShowForm(true) }}>+ Add Expense</button>
      )}

      {isContractor && showForm && (
        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <input type="text" placeholder="Category (e.g. Labor, Materials)" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} required />
              <input type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
              <label className="receipt-upload-label">
                📎 {receiptFile ? receiptFile.name : editingId ? 'Replace receipt (optional)' : 'Attach Receipt Photo'}
                <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} style={{ display: 'none' }} />
              </label>
              {previewUrl && (
                <img src={previewUrl} alt="Preview" style={{ width: '100%', borderRadius: '8px', marginTop: '4px' }} />
              )}
              {editingId && existingReceiptUrl && !previewUrl && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginBottom: '6px' }}>Current receipt</div>
                  <button type="button" className="receipt-thumb-btn" onClick={() => setViewingReceipt(existingReceiptUrl)} style={{ marginRight: '8px' }}>🧾 View</button>
                </div>
              )}
              <button type="submit" className="btn btn-primary">{editingId ? 'Update Expense' : 'Add Expense'}</button>
              <button type="button" className="btn btn-gray" onClick={resetForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {Object.keys(expensesByMonth).length === 0 && (
        <div className="empty-state">No expenses recorded yet.</div>
      )}

      {Object.entries(expensesByMonth).map(([month, exps]) => (
        <div key={month} className="month-card">
          <div className="month-title">{month}</div>
          {exps.map((exp) => (
            <div key={exp.id} className="expense-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{exp.category}</div>
                <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>{exp.expense_date}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span>₱{exp.amount.toFixed(2)}</span>
                  {exp.receipt_url && (
                    <button type="button" className="receipt-thumb-btn" onClick={() => setViewingReceipt(exp.receipt_url)}>🧾</button>
                  )}
                </div>
                {isContractor && (
                  <div className="inventory-card-actions" style={{ width: '100%', maxWidth: '220px' }}>
                    <button type="button" className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => startEdit(exp)}>Edit</button>
                    <button type="button" className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={() => deleteExpense(exp.id)}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div className="expense-total">
            <span>Total</span>
            <span>₱{exps.reduce((s, e) => s + e.amount, 0).toFixed(2)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export default App