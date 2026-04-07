import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

function App() {
  const [inventory, setInventory] = useState([])
  const [expenses, setExpenses] = useState([])
  const [activeTab, setActiveTab] = useState('inventory')

  useEffect(() => {
    const fetchData = async () => {
      const { data: inv, error: invError } = await supabase.from('inventory').select('*')
      const { data: exp, error: expError } = await supabase.from('expenses').select('*')
      if (invError) console.error('Fetch inventory error:', invError)
      if (expError) console.error('Fetch expenses error:', expError)
      if (inv) setInventory(inv)
      if (exp) setExpenses(exp)
    }
    fetchData()
  }, [])

  const addItem = async (item) => {
    const newItem = {
      ...item,
      id: Date.now(),
      history: [{ date: new Date().toISOString().split('T')[0], quantity: item.quantity, price: item.price }]
    }
    const { error } = await supabase.from('inventory').insert([newItem])
    if (error) console.error('Insert inventory error:', error)
    else setInventory(prev => [...prev, newItem])
  }

  const updateItem = async (id, updates) => {
    const item = inventory.find(i => i.id === id)
    const newHistory = [...item.history, { date: new Date().toISOString().split('T')[0], quantity: updates.quantity || item.quantity, price: updates.price || item.price }]
    const updated = { ...item, ...updates, history: newHistory }
    const { error } = await supabase.from('inventory').update(updated).eq('id', id)
    if (error) console.error('Update inventory error:', error)
    else setInventory(prev => prev.map(i => i.id === id ? updated : i))
  }

  const deleteItem = async (id) => {
    const { error } = await supabase.from('inventory').delete().eq('id', id)
    if (error) console.error('Delete inventory error:', error)
    else setInventory(prev => prev.filter(i => i.id !== id))
  }

  const addExpense = async (expense) => {
    const newExpense = { ...expense, id: Date.now() }
    const { error } = await supabase.from('expenses').insert([newExpense])
    if (error) console.error('Insert expense error:', error)
    else setExpenses(prev => [...prev, newExpense])
  }

  const totalInventoryCost = inventory.reduce((sum, item) => sum + (item.quantity * item.price), 0)

  const expensesByMonth = expenses.reduce((acc, exp) => {
    const month = exp.date.slice(0, 7)
    if (!acc[month]) acc[month] = {}
    if (!acc[month][exp.category]) acc[month][exp.category] = 0
    acc[month][exp.category] += exp.amount
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <h1 className="text-3xl font-bold text-center mb-8">Construction Inventory System</h1>
      <div className="flex justify-center mb-4">
        <button className={`px-4 py-2 ${activeTab === 'inventory' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`} onClick={() => setActiveTab('inventory')}>Inventory</button>
        <button className={`px-4 py-2 ml-2 ${activeTab === 'expenses' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`} onClick={() => setActiveTab('expenses')}>Expenses</button>
      </div>
      {activeTab === 'inventory' && <InventoryTab inventory={inventory} addItem={addItem} updateItem={updateItem} deleteItem={deleteItem} totalCost={totalInventoryCost} />}
      {activeTab === 'expenses' && <ExpensesTab addExpense={addExpense} expensesByMonth={expensesByMonth} />}
    </div>
  )
}

function InventoryTab({ inventory, addItem, updateItem, deleteItem, totalCost }) {
  const [form, setForm] = useState({ name: '', quantity: '', price: '' })
  const [editing, setEditing] = useState(null)

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
    setForm({ name: item.name, quantity: item.quantity, price: item.price })
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Inventory</h2>
      <form onSubmit={handleSubmit} className="mb-4">
        <input type="text" placeholder="Item Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="border p-2 mr-2" required />
        <input type="number" placeholder="Quantity" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} className="border p-2 mr-2" required />
        <input type="number" step="0.01" placeholder="Price" value={form.price} onChange={e => setForm({...form, price: e.target.value})} className="border p-2 mr-2" required />
        <button type="submit" className="bg-green-500 text-white px-4 py-2">{editing ? 'Update' : 'Add'} Item</button>
        {editing && <button type="button" onClick={() => {setEditing(null); setForm({name:'',quantity:'',price:''})}} className="ml-2 bg-gray-500 text-white px-4 py-2">Cancel</button>}
      </form>
      <table className="w-full bg-white shadow-md rounded">
        <thead>
          <tr className="bg-gray-200">
            <th className="p-2">Name</th>
            <th className="p-2">Quantity</th>
            <th className="p-2">Price</th>
            <th className="p-2">Total Cost</th>
            <th className="p-2">Last Updated</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {inventory.map(item => (
            <tr key={item.id} className="border-t">
              <td className="p-2">{item.name}</td>
              <td className="p-2">{item.quantity}</td>
              <td className="p-2">${item.price.toFixed(2)}</td>
              <td className="p-2">${(item.quantity * item.price).toFixed(2)}</td>
              <td className="p-2">{item.history[item.history.length - 1].date}</td>
              <td className="p-2">
                <button onClick={() => startEdit(item)} className="bg-blue-500 text-white px-2 py-1 mr-2">Edit</button>
                <button onClick={() => deleteItem(item.id)} className="bg-red-500 text-white px-2 py-1">Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 text-xl font-bold">Total Inventory Cost: ${totalCost.toFixed(2)}</div>
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
        <input type="text" placeholder="Category" value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="border p-2 mr-2" required />
        <input type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="border p-2 mr-2" required />
        <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="border p-2 mr-2" required />
        <button type="submit" className="bg-green-500 text-white px-4 py-2">Add Expense</button>
      </form>
      <div>
        {Object.entries(expensesByMonth).map(([month, categories]) => (
          <div key={month} className="mb-4">
            <h3 className="text-xl font-bold">{month}</h3>
            <ul>
              {Object.entries(categories).map(([cat, total]) => (
                <li key={cat} className="ml-4">{cat}: ${total.toFixed(2)}</li>
              ))}
            </ul>
            <div className="font-bold">Total: ${Object.values(categories).reduce((sum, amt) => sum + amt, 0).toFixed(2)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App