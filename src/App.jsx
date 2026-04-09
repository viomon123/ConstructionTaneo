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
      const { data: inv, error: invError } = await supabase.from('inventory').select('*')
      if (invError) console.error(invError)

      const { data: exp, error: expError } = await supabase.from('expenses').select('*')
      if (expError) console.error(expError)

      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      const { data: changes, error: changesError } = await supabase
        .from('daily_changes')
        .select('*')
        .gte('change_date', todayStart.toISOString())
        .order('change_date', { ascending: false })

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

  const handleLogout = () => setIsContractor(false)

  const addItem = async (item) => {
    const { data, error } = await supabase.from('inventory').insert([{
      name: item.name,
      quantity_left: item.quantity,
      current_price: item.price,
      total_purchased_cost: item.quantity * item.price
    }]).select()

    if (error) return console.error(error)

    const inserted = data[0]

    const { data: change } = await supabase.from('daily_changes').insert([{
      inventory_id: inserted.id,
      inventory_name: inserted.name,
      action: 'added',
      quantity_added: item.quantity,
      quantity_used: 0,
      price_paid: item.price,
      change_date: new Date().toISOString()
    }]).select()

    setInventory(prev => [...prev, inserted])
    if (change) setDailyChanges(prev => [change[0], ...prev])
  }

  const updateItem = async (id, updates) => {
    const item = inventory.find(i => i.id === id)
    const addedQty = updates.quantity - item.quantity_left
    const newTotalCost = (item.total_purchased_cost || 0) + (addedQty > 0 ? addedQty * updates.price : 0)

    const { error } = await supabase.from('inventory').update({
      quantity_left: updates.quantity,
      current_price: updates.price,
      total_purchased_cost: newTotalCost
    }).eq('id', id)

    if (error) return console.error(error)

    if (addedQty !== 0) {
      const { data: change } = await supabase.from('daily_changes').insert([{
        inventory_id: id,
        inventory_name: item.name,
        action: addedQty > 0 ? 'added' : 'reduced',
        quantity_added: addedQty > 0 ? addedQty : 0,
        quantity_used: addedQty < 0 ? Math.abs(addedQty) : 0,
        price_paid: updates.price,
        change_date: new Date().toISOString()
      }]).select()

      if (change) setDailyChanges(prev => [change[0], ...prev])
    }

    setInventory(prev => prev.map(i =>
      i.id === id ? { ...i, quantity_left: updates.quantity, current_price: updates.price, total_purchased_cost: newTotalCost } : i
    ))
  }

  const consumeItem = async (id, quantityUsed) => {
    const item = inventory.find(i => i.id === id)
    const newQty = item.quantity_left - quantityUsed
    if (newQty < 0) return alert('Not enough stock!')

    const { error } = await supabase.from('inventory')
      .update({ quantity_left: newQty })
      .eq('id', id)

    if (error) return console.error(error)

    const { data: change } = await supabase.from('daily_changes').insert([{
      inventory_id: id,
      inventory_name: item.name,
      action: 'used',
      quantity_added: 0,
      quantity_used: quantityUsed,
      price_paid: item.current_price,
      change_date: new Date().toISOString()
    }]).select()

    if (change) setDailyChanges(prev => [change[0], ...prev])

    setInventory(prev => prev.map(i => i.id === id ? { ...i, quantity_left: newQty } : i))
  }

  const deleteItem = async (id) => {
    const { error } = await supabase.from('inventory').delete().eq('id', id)
    if (error) return console.error(error)
    setInventory(prev => prev.filter(i => i.id !== id))
  }

  const addExpense = async (expense, receiptFile) => {
    let receipt_url = null

    if (receiptFile) {
      const fileName = `${Date.now()}-${receiptFile.name}`
      const { error } = await supabase.storage.from('receipts').upload(fileName, receiptFile)
      if (!error) {
        const { data } = supabase.storage.from('receipts').getPublicUrl(fileName)
        receipt_url = data.publicUrl
      }
    }

    const { data, error } = await supabase.from('expenses').insert([{
      category: expense.category,
      amount: expense.amount,
      expense_date: expense.date,
      receipt_url
    }]).select()

    if (error) return console.error(error)
    setExpenses(prev => [...prev, ...data])
  }

  const totalInventoryCost = inventory.reduce((s, i) => s + (i.total_purchased_cost || 0), 0)

  const expensesByMonth = expenses.reduce((acc, exp) => {
    const m = exp.expense_date.slice(0, 7)
    if (!acc[m]) acc[m] = []
    acc[m].push(exp)
    return acc
  }, {})

  const todaysSummary = dailyChanges.reduce((acc, c) => {
    if (!acc[c.inventory_id]) acc[c.inventory_id] = { added: 0, used: 0 }
    acc[c.inventory_id].added += c.quantity_added || 0
    acc[c.inventory_id].used += c.quantity_used || 0
    return acc
  }, {})

  return (
    <div className="app-wrapper">

      {showPinModal && (
        <div className="receipt-modal">
          <div className="receipt-modal-inner">
            <input value={pin} onChange={e => setPin(e.target.value)} />
            {pinError && <div>Wrong PIN</div>}
            <button onClick={handlePinSubmit}>Login</button>
          </div>
        </div>
      )}

      <div className="app-header">
        <h1>🏗️ Construction Inventory</h1>
        {isContractor
          ? <button onClick={handleLogout}>Logout</button>
          : <button onClick={() => setShowPinModal(true)}>Login</button>}
      </div>

      <div className="tab-bar">
        <button onClick={() => setActiveTab('inventory')}>Inventory</button>
        <button onClick={() => setActiveTab('expenses')}>Expenses</button>
        <button onClick={() => setActiveTab('daily')}>Today</button>
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
          />
        )}

        {activeTab === 'expenses' && (
          <ExpensesTab
            addExpense={addExpense}
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

export default App