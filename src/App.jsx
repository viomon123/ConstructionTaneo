import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

const CONTRACTOR_PIN = '1234'

function App() {
  const [inventory, setInventory] = useState([])
  const [expenses, setExpenses] = useState([])
  const [dailyChanges, setDailyChanges] = useState([])
  const [payments, setPayments] = useState([])
  const [activeTab, setActiveTab] = useState('inventory')
  const [isContractor, setIsContractor] = useState(false)
  const [showPinModal, setShowPinModal] = useState(false)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      const { data: inv } = await supabase.from('inventory').select('*')
      const { data: exp } = await supabase.from('expenses').select('*')
      const { data: changes } = await supabase
        .from('daily_changes')
        .select('*')
        .order('change_date', { ascending: false })
      const { data: pays } = await supabase
        .from('payments')
        .select('*')
        .order('payment_date', { ascending: false })

      if (inv) setInventory(inv)
      if (exp) setExpenses(exp)
      if (changes) setDailyChanges(changes)
      if (pays) setPayments(pays)
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

  // ── INVENTORY ──────────────────────────────────────────
  const addItem = async (item) => {
    const { data, error } = await supabase
      .from('inventory')
      .insert([{
        name: item.name,
        quantity_left: item.quantity,
        current_price: item.price,
        total_purchased_cost: item.quantity * item.price,
        total_price: item.totalPrice || 0,
        paid_so_far: 0,
        is_paid: false
      }])
      .select()

    if (error) { console.error('Insert inventory error:', error); return }

    const inserted = data[0]
    const changeDate = item.customDate ? new Date(item.customDate).toISOString() : new Date().toISOString()

    const { data: change, error: changeError } = await supabase
      .from('daily_changes')
      .insert([{
        inventory_id: Number(inserted.id),
        inventory_name: String(inserted.name),
        action: 'added',
        quantity_added: Number(item.quantity),
        quantity_used: 0,
        price_paid: Number(item.price),
        change_date: changeDate
      }])
      .select()

    if (changeError) { console.error('daily_change error:', JSON.stringify(changeError, null, 2)); return }

    setInventory(prev => [...prev, inserted])
    if (change) setDailyChanges(prev => [change[0], ...prev].sort((a, b) => new Date(b.change_date) - new Date(a.change_date)))
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
      const changeDate = updates.customDate ? new Date(updates.customDate).toISOString() : new Date().toISOString()
      const { data: change, error: changeError } = await supabase
        .from('daily_changes')
        .insert([{
          inventory_id: Number(id),
          inventory_name: String(item.name),
          action: addedQty > 0 ? 'added' : 'reduced',
          quantity_added: addedQty > 0 ? Number(addedQty) : 0,
          quantity_used: addedQty < 0 ? Number(Math.abs(addedQty)) : 0,
          price_paid: Number(updates.price),
          change_date: changeDate
        }])
        .select()

      if (changeError) console.error('daily_change error:', changeError)
      else if (change) setDailyChanges(prev => [change[0], ...prev].sort((a, b) => new Date(b.change_date) - new Date(a.change_date)))
    }

    setInventory(prev => prev.map(i =>
      i.id === id ? { ...i, quantity_left: updates.quantity, current_price: updates.price, total_purchased_cost: newTotalCost } : i
    ))
  }

  const consumeItem = async (id, quantityUsed, customDate) => {
    const item = inventory.find(i => i.id === id)
    const newQty = item.quantity_left - quantityUsed
    if (newQty < 0) { alert('Not enough stock!'); return }

    const { error } = await supabase
      .from('inventory')
      .update({ quantity_left: newQty, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) { console.error('Use item error:', error); return }

    const changeDate = customDate ? new Date(customDate).toISOString() : new Date().toISOString()
    const { data: change, error: changeError } = await supabase
      .from('daily_changes')
      .insert([{
        inventory_id: Number(id),
        inventory_name: String(item.name),
        action: 'used',
        quantity_added: 0,
        quantity_used: Number(quantityUsed),
        price_paid: Number(item.current_price),
        change_date: changeDate
      }])
      .select()

    if (changeError) console.error('daily_change error:', changeError)
    else if (change) setDailyChanges(prev => [change[0], ...prev].sort((a, b) => new Date(b.change_date) - new Date(a.change_date)))

    setInventory(prev => prev.map(i => i.id === id ? { ...i, quantity_left: newQty } : i))
  }

  const deleteItem = async (id) => {
    const { error } = await supabase.from('inventory').delete().eq('id', id)
    if (error) { console.error('Delete inventory error:', error); return }
    setInventory(prev => prev.filter(i => i.id !== id))
  }

  // ── PAYMENTS ───────────────────────────────────────────
  const addPayment = async (referenceId, referenceType, amount, note, totalPrice) => {
    const { data, error } = await supabase
      .from('payments')
      .insert([{
        reference_id: Number(referenceId),
        reference_type: referenceType,
        amount: Number(amount),
        note: note || '',
        payment_date: new Date().toISOString()
      }])
      .select()

    if (error) { console.error('Payment error:', error); return }

    // update paid_so_far on the parent record
    const table = referenceType === 'expense' ? 'expenses' : 'inventory'
    const records = referenceType === 'expense' ? expenses : inventory
    const record = records.find(r => r.id === referenceId)
    const newPaidSoFar = (record?.paid_so_far || 0) + Number(amount)
    const isPaid = newPaidSoFar >= (record?.total_price || totalPrice || 0)

    await supabase
      .from(table)
      .update({ paid_so_far: newPaidSoFar, is_paid: isPaid })
      .eq('id', referenceId)

    if (referenceType === 'expense') {
      setExpenses(prev => prev.map(e =>
        e.id === referenceId ? { ...e, paid_so_far: newPaidSoFar, is_paid: isPaid } : e
      ))
    } else {
      setInventory(prev => prev.map(i =>
        i.id === referenceId ? { ...i, paid_so_far: newPaidSoFar, is_paid: isPaid } : i
      ))
    }

    if (data) setPayments(prev => [data[0], ...prev])
  }

  // ── EXPENSES ───────────────────────────────────────────
// ── EXPENSES ───────────────────────────────────────────

// ✏️ EDIT EXPENSE
const updateExpense = async (id, updates) => {
  const { error } = await supabase
    .from('expenses')
    .update({
      category: updates.category,
      amount: updates.amount,
      expense_date: updates.date,
      total_price: updates.totalPrice,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)

  if (error) {
    console.error('Update expense error:', error)
    return
  }

  setExpenses(prev =>
    prev.map(e =>
      e.id === id
        ? {
            ...e,
            category: updates.category,
            amount: updates.amount,
            expense_date: updates.date,
            total_price: updates.totalPrice
          }
        : e
    )
  )
}

// 🗑️ DELETE EXPENSE
const deleteExpense = async (id) => {
  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Delete expense error:', error)
    return
  }

  setExpenses(prev => prev.filter(e => e.id !== id))
}

// ➕ ADD EXPENSE
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
      const { data: urlData } = supabase.storage
        .from('receipts')
        .getPublicUrl(fileName)

      receipt_url = urlData.publicUrl
    }
  }

  const { data, error } = await supabase
    .from('expenses')
    .insert([{
      category: expense.category,
      amount: expense.amount,
      expense_date: expense.date,
      receipt_url,
      total_price: expense.totalPrice || expense.amount,
      paid_so_far: expense.initialPayment || 0,
      is_paid:
        (expense.initialPayment || 0) >=
        (expense.totalPrice || expense.amount)
    }])
    .select()

  if (error) {
    console.error('Insert expense error:', error)
    return
  }

  if (expense.initialPayment > 0) {
    await supabase.from('payments').insert([{
      reference_id: data[0].id,
      reference_type: 'expense',
      amount: expense.initialPayment,
      note: 'Initial payment',
      payment_date: new Date().toISOString()
    }])
  }

  setExpenses(prev => [...prev, ...data])
}
  
  // ── DERIVED DATA ───────────────────────────────────────
  const totalInventoryCost = inventory.reduce((sum, item) => sum + (item.total_purchased_cost || 0), 0)

  const expensesByMonth = expenses.reduce((acc, exp) => {
    const month = exp.expense_date.slice(0, 7)
    if (!acc[month]) acc[month] = []
    acc[month].push(exp)
    return acc
  }, {})

  const todaysSummary = dailyChanges
    .filter(c => c.change_date?.slice(0, 10) === new Date().toISOString().slice(0, 10))
    .reduce((acc, change) => {
      const id = change.inventory_id
      if (!acc[id]) acc[id] = { added: 0, used: 0 }
      acc[id].added += change.quantity_added || 0
      acc[id].used += change.quantity_used || 0
      return acc
    }, {})

  return (
    <div className="app-wrapper">
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

      <div className="tab-bar">
        <button className={activeTab === 'inventory' ? 'active' : ''} onClick={() => setActiveTab('inventory')}>📦 Inventory</button>
        <button className={activeTab === 'expenses' ? 'active' : ''} onClick={() => setActiveTab('expenses')}>💸 Expenses</button>
        <button className={activeTab === 'daily' ? 'active' : ''} onClick={() => setActiveTab('daily')}>📋 Log</button>
      </div>

      <div className="tab-content">
        {activeTab === 'inventory' && (
          <InventoryTab
            inventory={inventory}
            addItem={addItem}
            updateItem={updateItem}
            deleteItem={deleteItem}
            consumeItem={consumeItem}
            totalCost={totalInventoryCost}
            todaysSummary={todaysSummary}
            isContractor={isContractor}
            payments={payments}
            addPayment={addPayment}
          />
        )}
        {activeTab === 'expenses' && (
              <ExpensesTab
              addExpense={addExpense}
              expensesByMonth={expensesByMonth}
              isContractor={isContractor}
              payments={payments}
              addPayment={addPayment}
              updateExpense={updateExpense}
              deleteExpense={deleteExpense}
            />
        )}
        {activeTab === 'daily' && (
          <DailyLogTab dailyChanges={dailyChanges} />
        )}
      </div>
    </div>
  )
}

// ── INVENTORY TAB ──────────────────────────────────────────────────────────────
function InventoryTab({ inventory, addItem, updateItem, deleteItem, consumeItem, totalCost, todaysSummary, isContractor, payments, addPayment }) {
  const [form, setForm] = useState({ name: '', quantity: '', price: '', totalPrice: '', customDate: '' })
  const [editing, setEditing] = useState(null)
  const [useQty, setUseQty] = useState({})
  const [useDate, setUseDate] = useState({})
  const [showForm, setShowForm] = useState(false)
  const [payingItem, setPayingItem] = useState(null)
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (editing) {
      updateItem(editing, {
        quantity: parseInt(form.quantity),
        price: parseFloat(form.price),
        customDate: form.customDate
      })
      setEditing(null)
    } else {
      addItem({
        name: form.name,
        quantity: parseInt(form.quantity),
        price: parseFloat(form.price),
        totalPrice: parseFloat(form.totalPrice) || parseFloat(form.price) * parseInt(form.quantity),
        customDate: form.customDate
      })
    }
    setForm({ name: '', quantity: '', price: '', totalPrice: '', customDate: '' })
    setShowForm(false)
  }

  const startEdit = (item) => {
    setEditing(item.id)
    setForm({ name: item.name, quantity: item.quantity_left, price: item.current_price, totalPrice: item.total_price || '', customDate: '' })
    setShowForm(true)
  }

  const handleUse = (id) => {
    const qty = parseInt(useQty[id])
    if (!qty || qty <= 0) return alert('Enter a valid quantity')
    consumeItem(id, qty, useDate[id] || null)
    setUseQty(prev => ({ ...prev, [id]: '' }))
    setUseDate(prev => ({ ...prev, [id]: '' }))
  }

  const handlePayment = () => {
    if (!payAmount || parseFloat(payAmount) <= 0) return alert('Enter a valid amount')
    addPayment(payingItem.id, 'inventory', parseFloat(payAmount), payNote, payingItem.total_price)
    setPayingItem(null)
    setPayAmount('')
    setPayNote('')
  }

  return (
    <div>
      {payingItem && (
        <div className="receipt-modal" onClick={() => setPayingItem(null)}>
          <div className="receipt-modal-inner" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '17px', fontWeight: '700', marginBottom: '4px' }}>Add Payment</div>
            <div style={{ fontSize: '13px', color: 'var(--gray-500)', marginBottom: '12px' }}>{payingItem.name}</div>
            <div className="payment-progress-bar">
              <div className="payment-progress-fill" style={{ width: `${Math.min(100, ((payingItem.paid_so_far || 0) / (payingItem.total_price || 1)) * 100)}%` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--gray-500)', marginBottom: '12px' }}>
              <span>Paid: ${(payingItem.paid_so_far || 0).toFixed(2)}</span>
              <span>Total: ${(payingItem.total_price || 0).toFixed(2)}</span>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--gray-500)', marginBottom: '12px' }}>
              Remaining: ${Math.max(0, (payingItem.total_price || 0) - (payingItem.paid_so_far || 0)).toFixed(2)}
            </div>
            {payments.filter(p => p.reference_id === payingItem.id && p.reference_type === 'inventory').length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: 'var(--gray-700)' }}>Payment History</div>
                {payments.filter(p => p.reference_id === payingItem.id && p.reference_type === 'inventory').map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: '1px solid var(--gray-100)' }}>
                    <span>{p.note || '—'}</span>
                    <span style={{ color: 'var(--success)', fontWeight: '600' }}>${p.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
            {!payingItem.is_paid && (
              <div className="form-group">
                <input type="number" step="0.01" placeholder="Amount to pay" value={payAmount} onChange={e => setPayAmount(e.target.value)} />
                <input type="text" placeholder="Note (optional)" value={payNote} onChange={e => setPayNote(e.target.value)} />
                <button className="btn btn-primary" onClick={handlePayment}>Add Payment</button>
              </div>
            )}
            {payingItem.is_paid && (
              <div style={{ textAlign: 'center', color: 'var(--success)', fontWeight: '700', fontSize: '15px' }}>✅ Fully Paid</div>
            )}
            <button className="btn btn-gray" style={{ marginTop: '8px' }} onClick={() => setPayingItem(null)}>Close</button>
          </div>
        </div>
      )}

      <div className="total-banner">
        <span className="total-banner-label">Total Purchased Cost</span>
        <span className="total-banner-value">${totalCost.toFixed(2)}</span>
      </div>

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
              <input type="number" step="0.01" placeholder="Total price to pay (for installments)" value={form.totalPrice} onChange={e => setForm({ ...form, totalPrice: e.target.value })} />
              <label style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Date/Time of entry (leave blank for now)</label>
              <input type="datetime-local" value={form.customDate} onChange={e => setForm({ ...form, customDate: e.target.value })} />
              <button type="submit" className="btn btn-primary">{editing ? 'Update Item' : 'Add Item'}</button>
              <button type="button" className="btn btn-gray" onClick={() => { setShowForm(false); setEditing(null); setForm({ name: '', quantity: '', price: '', totalPrice: '', customDate: '' }) }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {inventory.map(item => {
        const itemPayments = payments.filter(p => p.reference_id === item.id && p.reference_type === 'inventory')
        const hasInstallments = (item.total_price || 0) > 0
        const payPercent = hasInstallments ? Math.min(100, ((item.paid_so_far || 0) / item.total_price) * 100) : 0

        return (
          <div key={item.id} className="inventory-card">
            <div className="inventory-card-header">
              <span className="inventory-card-name">{item.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {hasInstallments && (
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: item.is_paid ? '#dcfce7' : '#fef9c3', color: item.is_paid ? '#15803d' : '#92400e', fontWeight: '600' }}>
                    {item.is_paid ? '✅ Paid' : '⏳ Installment'}
                  </span>
                )}
                <span style={{ fontSize: '13px', color: 'var(--gray-500)' }}>${item.current_price.toFixed(2)}/unit</span>
              </div>
            </div>

            {hasInstallments && (
              <div style={{ marginBottom: '10px' }}>
                <div className="payment-progress-bar">
                  <div className="payment-progress-fill" style={{ width: `${payPercent}%` }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--gray-500)', marginTop: '3px' }}>
                  <span>Paid ${(item.paid_so_far || 0).toFixed(2)}</span>
                  <span>of ${item.total_price.toFixed(2)}</span>
                </div>
              </div>
            )}

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

            {isContractor && (
              <>
                <div className="use-row">
                  <input type="number" min="1" placeholder="Qty to use" value={useQty[item.id] || ''} onChange={e => setUseQty(prev => ({ ...prev, [item.id]: e.target.value }))} />
                  <button className="btn btn-warning btn-sm" onClick={() => handleUse(item.id)}>Use</button>
                </div>
                <input
                  type="datetime-local"
                  value={useDate[item.id] || ''}
                  onChange={e => setUseDate(prev => ({ ...prev, [item.id]: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', border: '1.5px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: '13px', marginTop: '6px', marginBottom: '6px' }}
                />
                <div className="inventory-card-actions">
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => startEdit(item)}>Edit</button>
                  {hasInstallments && !item.is_paid && (
                    <button className="btn btn-warning btn-sm" style={{ flex: 1 }} onClick={() => setPayingItem(item)}>💳 Pay</button>
                  )}
                  {hasInstallments && item.is_paid && (
                    <button className="btn btn-gray btn-sm" style={{ flex: 1 }} onClick={() => setPayingItem(item)}>🧾 History</button>
                  )}
                  <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={() => deleteItem(item.id)}>Delete</button>
                </div>
              </>
            )}

            {!isContractor && hasInstallments && (
              <button className="btn btn-gray btn-sm" style={{ width: '100%', marginTop: '8px' }} onClick={() => setPayingItem(item)}>🧾 View Payments</button>
            )}

            {!isContractor && !hasInstallments && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--gray-400)', textAlign: 'center' }}>🔒 View only</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── DAILY LOG TAB ──────────────────────────────────────────────────────────────
function DailyLogTab({ dailyChanges }) {
  const [filterDate, setFilterDate] = useState('')

  const filtered = filterDate
    ? dailyChanges.filter(c => c.change_date?.slice(0, 10) === filterDate)
    : dailyChanges

  const actionStyle = (action) => {
    if (action === 'added') return { bg: '#dcfce7', color: '#15803d', label: '+ Added' }
    if (action === 'used') return { bg: '#fee2e2', color: '#b91c1c', label: '- Used' }
    return { bg: '#fef9c3', color: '#92400e', label: '~ Reduced' }
  }

  const formatDateTime = (iso) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  }

  return (
    <div>
      <div className="section-title">Activity Log</div>

      <input
        type="date"
        value={filterDate}
        onChange={e => setFilterDate(e.target.value)}
        style={{ width: '100%', padding: '10px 14px', border: '1.5px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: '14px', marginBottom: '14px', outline: 'none' }}
      />
      {filterDate && (
        <button className="btn btn-gray btn-sm" style={{ marginBottom: '14px', width: '100%' }} onClick={() => setFilterDate('')}>Clear Filter — Show All</button>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state">No activity found.</div>
      ) : (
        filtered.map((change, i) => {
          const style = actionStyle(change.action)
          const qty = change.action === 'used' ? change.quantity_used : change.quantity_added
          return (
            <div key={change.id || i} className="log-card">
              <div>
                <div className="log-card-name">{change.inventory_name || 'Unknown'}</div>
                <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '2px' }}>
                  {formatDateTime(change.change_date)}
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

// ── EXPENSES TAB ───────────────────────────────────────────────────────────────
function ExpensesTab({ 
  addExpense, 
  expensesByMonth, 
  isContractor, 
  payments, 
  addPayment,
  updateExpense,
  deleteExpense
}) {
  const [form, setForm] = useState({ category: '', amount: '', date: '', totalPrice: '', initialPayment: '' })
  const [editingExpense, setEditingExpense] = useState(null)
  const [receiptFile, setReceiptFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [viewingReceipt, setViewingReceipt] = useState(null)
  const [payingExpense, setPayingExpense] = useState(null)
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setReceiptFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }
  const startEdit = (exp) => {
    setEditingExpense(exp)
    setForm({
      category: exp.category,
      amount: exp.amount,
      date: exp.expense_date,
      totalPrice: exp.total_price || '',
      initialPayment: ''
    })
    setShowForm(true)
  }
  const handleSubmit = (e) => {
    e.preventDefault()
  
    if (editingExpense) {
      updateExpense(editingExpense.id, {
        category: form.category,
        amount: parseFloat(form.amount),
        date: form.date,
        totalPrice: parseFloat(form.totalPrice) || parseFloat(form.amount)
      })
      setEditingExpense(null)
    } else {
      addExpense({
        category: form.category,
        amount: parseFloat(form.amount),
        date: form.date,
        totalPrice: parseFloat(form.totalPrice) || parseFloat(form.amount),
        initialPayment: parseFloat(form.initialPayment) || 0
      }, receiptFile)
    }
  
    setForm({ category: '', amount: '', date: '', totalPrice: '', initialPayment: '' })
    setReceiptFile(null)
    setPreviewUrl(null)
    setShowForm(false)
  }

  const handlePayment = () => {
    if (!payAmount || parseFloat(payAmount) <= 0) return alert('Enter a valid amount')
    addPayment(payingExpense.id, 'expense', parseFloat(payAmount), payNote, payingExpense.total_price)
    setPayingExpense(null)
    setPayAmount('')
    setPayNote('')
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

      {payingExpense && (
        <div className="receipt-modal" onClick={() => setPayingExpense(null)}>
          <div className="receipt-modal-inner" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '17px', fontWeight: '700', marginBottom: '4px' }}>Add Payment</div>
            <div style={{ fontSize: '13px', color: 'var(--gray-500)', marginBottom: '12px' }}>{payingExpense.category}</div>
            <div className="payment-progress-bar">
              <div className="payment-progress-fill" style={{ width: `${Math.min(100, ((payingExpense.paid_so_far || 0) / (payingExpense.total_price || 1)) * 100)}%` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--gray-500)', marginBottom: '12px' }}>
              <span>Paid: ${(payingExpense.paid_so_far || 0).toFixed(2)}</span>
              <span>Total: ${(payingExpense.total_price || 0).toFixed(2)}</span>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--gray-500)', marginBottom: '12px' }}>
              Remaining: ${Math.max(0, (payingExpense.total_price || 0) - (payingExpense.paid_so_far || 0)).toFixed(2)}
            </div>
            {payments.filter(p => p.reference_id === payingExpense.id && p.reference_type === 'expense').length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: 'var(--gray-700)' }}>Payment History</div>
                {payments.filter(p => p.reference_id === payingExpense.id && p.reference_type === 'expense').map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: '1px solid var(--gray-100)' }}>
                    <span>{p.note || '—'}</span>
                    <span style={{ color: 'var(--success)', fontWeight: '600' }}>${p.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
            {!payingExpense.is_paid && isContractor && (
              <div className="form-group">
                <input type="number" step="0.01" placeholder="Amount to pay" value={payAmount} onChange={e => setPayAmount(e.target.value)} />
                <input type="text" placeholder="Note (optional)" value={payNote} onChange={e => setPayNote(e.target.value)} />
                <button className="btn btn-primary" onClick={handlePayment}>Add Payment</button>
              </div>
            )}
            {payingExpense.is_paid && (
              <div style={{ textAlign: 'center', color: 'var(--success)', fontWeight: '700', fontSize: '15px' }}>✅ Fully Paid</div>
            )}
            <button className="btn btn-gray" style={{ marginTop: '8px' }} onClick={() => setPayingExpense(null)}>Close</button>
          </div>
        </div>
      )}

      {isContractor && !showForm && (
        <button className="btn btn-success" style={{ marginBottom: '16px' }} onClick={() => setShowForm(true)}>+ Add Expense</button>
      )}

      {isContractor && showForm && (
        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <input type="text" placeholder="Category (e.g. Labor, Materials)" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} required />
              <input type="number" step="0.01" placeholder="Total price of expense" value={form.totalPrice} onChange={e => setForm({ ...form, totalPrice: e.target.value })} />
              <input type="number" step="0.01" placeholder="Initial payment (0 if paying later)" value={form.initialPayment} onChange={e => setForm({ ...form, initialPayment: e.target.value })} />
              <input type="number" step="0.01" placeholder="Amount (for records)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
              <label className="receipt-upload-label">
                📎 {receiptFile ? receiptFile.name : 'Attach Receipt Photo'}
                <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} style={{ display: 'none' }} />
              </label>
              {previewUrl && (
                <img src={previewUrl} alt="Preview" style={{ width: '100%', borderRadius: '8px', marginTop: '4px' }} />
              )}
              <button type="submit" className="btn btn-primary">Add Expense</button>
              <button type="button" className="btn btn-gray" onClick={() => { setShowForm(false); setReceiptFile(null); setPreviewUrl(null) }}>Cancel</button>
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
          {exps.map((exp, i) => {
            const payPercent = exp.total_price > 0 ? Math.min(100, ((exp.paid_so_far || 0) / exp.total_price) * 100) : 100
            const hasInstallments = (exp.total_price || 0) > (exp.paid_so_far || 0) || exp.is_paid
            return (
              <div key={i} style={{ paddingBottom: '10px', marginBottom: '10px', borderBottom: '1px solid var(--gray-100)' }}>
                <div className="expense-row">
                  <div>
                    <div style={{ fontWeight: '500' }}>{exp.category}</div>
                    <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>{exp.expense_date}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>${exp.amount.toFixed(2)}</span>
                    {exp.receipt_url && (
                      <button className="receipt-thumb-btn" onClick={() => setViewingReceipt(exp.receipt_url)}>🧾</button>
                    )}
                    <button className="receipt-thumb-btn" onClick={() => setPayingExpense(exp)}>
                      {exp.is_paid ? '✅' : '💳'}
                    </button>
                    {isContractor && (
                          <>
                            <button 
                              className="receipt-thumb-btn"
                              onClick={() => startEdit(exp)}
                            >
                              ✏️
                            </button>

                            <button 
                              className="receipt-thumb-btn"
                              onClick={() => {
                                if (confirm('Delete this expense?')) {
                                  deleteExpense(exp.id)
                                }
                              }}
                            >
                              🗑️
                            </button>
                          </>
                        )}
                  </div>
                </div>
                {hasInstallments && (
                  <div style={{ marginTop: '6px' }}>
                    <div className="payment-progress-bar">
                      <div className="payment-progress-fill" style={{ width: `${payPercent}%` }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--gray-500)', marginTop: '2px' }}>
                      <span>Paid ${(exp.paid_so_far || 0).toFixed(2)}</span>
                      <span>of ${(exp.total_price || 0).toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          <div className="expense-total">
            <span>Total</span>
            <span>${exps.reduce((s, e) => s + e.amount, 0).toFixed(2)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export default App