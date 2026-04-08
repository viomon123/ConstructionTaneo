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

  // ✅ ADD ITEM — logs positive quantity to daily_changes
  const addItem = async (item) => {
    const { data, error } = await supabase
      .from('inventory')
      .insert([
        {
          name: item.name,
          quantity_left: item.quantity,
          current_price: item.price,
          total_purchased_cost: item.quantity * item.price
        }
      ])
      .select()

    if (error) {
      console.error('Insert inventory error:', error)
      return
    }

    const inserted = data[0]

    const { data: change } = await supabase.from('daily_changes').insert([
      {
        inventory_id: inserted.id,
        quantity_added: item.quantity,
        quantity_used: 0,
        price_paid: item.price,
        change_date: new Date().toISOString()
      }
    ]).select()

    setInventory(prev => [...prev, inserted])
    if (change) setDailyChanges(prev => [...prev, ...change])
  }

  // ✅ UPDATE ITEM — adding more stock, increases total_purchased_cost
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

    if (error) {
      console.error('Update inventory error:', error)
      return
    }

    if (addedQty !== 0) {
      const { data: change } = await supabase.from('daily_changes').insert([
        {
          inventory_id: id,
          quantity_added: addedQty > 0 ? addedQty : 0,
          quantity_used: 0,
          price_paid: updates.price,
          change_date: new Date().toISOString()
        }
      ]).select()

      if (change) setDailyChanges(prev => [...prev, ...change])
    }

    setInventory(prev =>
      prev.map(i =>
        i.id === id
          ? { ...i, quantity_left: updates.quantity, current_price: updates.price, total_purchased_cost: newTotalCost }
          : i
      )
    )
  }

  // ✅ CONSUME ITEM — deducts quantity, logs to daily_changes, does NOT change total_purchased_cost
  const consumeItem = async (id, quantityUsed) => {
    const item = inventory.find(i => i.id === id)
    const newQty = item.quantity_left - quantityUsed

    if (newQty < 0) {
      alert('Not enough stock!')
      return
    }

    const { error } = await supabase
      .from('inventory')
      .update({ quantity_left: newQty, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      console.error('Use item error:', error)
      return
    }

    const { data: change } = await supabase.from('daily_changes').insert([
      {
        inventory_id: id,
        quantity_added: 0,
        quantity_used: quantityUsed,
        price_paid: item.current_price,
        change_date: new Date().toISOString()
      }
    ]).select()

    setInventory(prev =>
      prev.map(i => i.id === id ? { ...i, quantity_left: newQty } : i)
    )
    if (change) setDailyChanges(prev => [...prev, ...change])
  }

  // ✅ DELETE ITEM
  const deleteItem = async (id) => {
    const { error } = await supabase.from('inventory').delete().eq('id', id)

    if (error) {
      console.error('Delete inventory error:', error)
      return
    }

    setInventory(prev => prev.filter(i => i.id !== id))
  }

  // ✅ ADD EXPENSE
  const addExpense = async (expense) => {
    const { data, error } = await supabase
      .from('expenses')
      .insert([
        {
          category: expense.category,
          amount: expense.amount,
          expense_date: expense.date
        }
      ])
      .select()

    if (error) {
      console.error('Insert expense error:', error)
      return
    }

    setExpenses(prev => [...prev, ...data])
  }

  // Total cost = sum of all cumulative purchase costs
  const totalInventoryCost = inventory.reduce(
    (sum, item) => sum + (item.total_purchased_cost || 0),
    0
  )

  const expensesByMonth = expenses.reduce((acc, exp) => {
    const month = exp.expense_date.slice(0, 7)
    if (!acc[month]) acc[month] = {}
    if (!acc[month][exp.category]) acc[month][exp.category] = 0
    acc[month][exp.category] += exp.amount
    return acc
  }, {})

  // Today's summary grouped by inventory item
  const todaysSummary = dailyChanges.reduce((acc, change) => {
    const id = change.inventory_id
    if (!acc[id]) acc[id] = { added: 0, used: 0 }
    acc[id].added += change.quantity_added || 0
    acc[id].used += change.quantity_used || 0
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <h1 className="text-3xl font-bold text-center mb-8">Construction Inventory System</h1>

      <div className="flex justify-center mb-4">
        <button className={`px-4 py-2 ${activeTab === 'inventory' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`} onClick={() => setActiveTab('inventory')}>Inventory</button>
        <button className={`px-4 py-2 ml-2 ${activeTab === 'expenses' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`} onClick={() => setActiveTab('expenses')}>Expenses</button>
        <button className={`px-4 py-2 ml-2 ${activeTab === 'daily' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`} onClick={() => setActiveTab('daily')}>Today's Log</button>
      </div>

      {activeTab === 'inventory' && (
        <InventoryTab
          inventory={inventory}
          addItem={addItem}
          updateItem={updateItem}
          deleteItem={deleteItem}
          consumeItem={consumeItem}
          totalCost={totalInventoryCost}
          todaysSummary={todaysSummary}
        />
      )}
      {activeTab === 'expenses' && (
        <ExpensesTab addExpense={addExpense} expensesByMonth={expensesByMonth} />
      )}
      {activeTab === 'daily' && (
        <DailyLogTab inventory={inventory} todaysSummary={todaysSummary} />
      )}
    </div>
  )
}

function InventoryTab({ inventory, addItem, updateItem, deleteItem, consumeItem, totalCost, todaysSummary }) {
  const [form, setForm] = useState({ name: '', quantity: '', price: '' })
  const [editing, setEditing] = useState(null)
  const [useQty, setUseQty] = useState({})

  const handleSubmit = (e) => {
    e.preventDefault()
    if (editing) {
      updateItem(editing, { quantity: parseInt(form.quantity), price: parseFloat(form.price) })
      setEditing(null)
    } else {
      addItem({ name: form.name, quantity: parseInt(form.quantity), price: parseFloat(form.price) })
    }
    setForm({ name: '', quantity: '', price: '' })
  }

  const startEdit = (item) => {
    setEditing(item.id)
    setForm({ name: item.name, quantity: item.quantity_left, price: item.current_price })
  }

  const handleUse = (id) => {
    const qty = parseInt(useQty[id])
    if (!qty || qty <= 0) return alert('Enter a valid quantity to consume')
    consumeItem(id, qty)
    setUseQty(prev => ({ ...prev, [id]: '' }))
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Inventory</h2>

      <form onSubmit={handleSubmit} className="mb-4">
        <input type="text" placeholder="Item Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border p-2 mr-2" required />
        <input type="number" placeholder="Quantity" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="border p-2 mr-2" required />
        <input type="number" step="0.01" placeholder="Price" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="border p-2 mr-2" required />
        <button className="bg-green-500 text-white px-4 py-2">{editing ? 'Update' : 'Add'} Item</button>
        {editing && (
          <button type="button" onClick={() => { setEditing(null); setForm({ name: '', quantity: '', price: '' }) }} className="ml-2 bg-gray-500 text-white px-4 py-2">Cancel</button>
        )}
      </form>

      <table className="w-full bg-white shadow-md rounded">
        <thead>
          <tr className="bg-gray-200">
            <th className="p-2">Name</th>
            <th className="p-2">Qty Left</th>
            <th className="p-2">Price</th>
            <th className="p-2">Total Purchased</th>
            <th className="p-2">Today Added</th>
            <th className="p-2">Today Used</th>
            <th className="p-2">Use</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {inventory.map(item => (
            <tr key={item.id} className="border-t">
              <td className="p-2">{item.name}</td>
              <td className="p-2">{item.quantity_left}</td>
              <td className="p-2">${item.current_price.toFixed(2)}</td>
              <td className="p-2">${(item.total_purchased_cost || 0).toFixed(2)}</td>
              <td className="p-2 text-green-600">+{todaysSummary[item.id]?.added || 0}</td>
              <td className="p-2 text-red-600">-{todaysSummary[item.id]?.used || 0}</td>
              <td className="p-2">
                <input
                  type="number"
                  min="1"
                  placeholder="Qty"
                  value={useQty[item.id] || ''}
                  onChange={e => setUseQty(prev => ({ ...prev, [item.id]: e.target.value }))}
                  className="border p-1 w-16 mr-1"
                />
                <button onClick={() => handleUse(item.id)} className="bg-yellow-500 text-white px-2 py-1">Use</button>
              </td>
              <td className="p-2">
                <button onClick={() => startEdit(item)} className="bg-blue-500 text-white px-2 py-1 mr-2">Edit</button>
                <button onClick={() => deleteItem(item.id)} className="bg-red-500 text-white px-2 py-1">Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 font-bold text-xl">Total Purchased Cost: ${totalCost.toFixed(2)}</div>
    </div>
  )
}

function DailyLogTab({ inventory, todaysSummary }) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">Today's Log</h2>
      <p className="text-gray-500 mb-4">{today}</p>

      {Object.keys(todaysSummary).length === 0 ? (
        <p className="text-gray-400">No activity recorded today.</p>
      ) : (
        <table className="w-full bg-white shadow-md rounded">
          <thead>
            <tr className="bg-gray-200">
              <th className="p-2">Item</th>
              <th className="p-2 text-green-600">Added Today</th>
              <th className="p-2 text-red-600">Used Today</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(todaysSummary).map(([id, summary]) => {
              const item = inventory.find(i => String(i.id) === String(id))
              return (
                <tr key={id} className="border-t">
                  <td className="p-2">{item ? item.name : 'Unknown'}</td>
                  <td className="p-2 text-green-600">+{summary.added}</td>
                  <td className="p-2 text-red-600">-{summary.used}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ExpensesTab({ addExpense, expensesByMonth }) {
  const [form, setForm] = useState({ category: '', amount: '', date: '' })

  const handleSubmit = (e) => {
    e.preventDefault()
    addExpense({ category: form.category, amount: parseFloat(form.amount), date: form.date })
    setForm({ category: '', amount: '', date: '' })
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Expenses</h2>

      <form onSubmit={handleSubmit} className="mb-4">
        <input type="text" placeholder="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="border p-2 mr-2" required />
        <input type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="border p-2 mr-2" required />
        <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="border p-2 mr-2" required />
        <button className="bg-green-500 text-white px-4 py-2">Add Expense</button>
      </form>

      {Object.entries(expensesByMonth).map(([month, categories]) => (
        <div key={month} className="mb-4">
          <h3 className="font-bold text-lg">{month}</h3>
          {Object.entries(categories).map(([cat, total]) => (
            <p key={cat} className="ml-4">{cat}: ${total.toFixed(2)}</p>
          ))}
          <p className="font-bold ml-4">Total: ${Object.values(categories).reduce((s, a) => s + a, 0).toFixed(2)}</p>
        </div>
      ))}
    </div>
  )
}

export default App