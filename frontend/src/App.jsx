import { BrowserRouter, Routes, Route } from 'react-router-dom'
import MainLayout  from './layouts/MainLayout'
import Dashboard   from './pages/Dashboard'
import Orders      from './pages/Orders'
import OrderDetail from './pages/OrderDetail'
import NewOrder    from './pages/NewOrder'
import Invoices    from './pages/Invoices'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/"              element={<Dashboard />}   />
          <Route path="/orders"        element={<Orders />}      />
          <Route path="/orders/new"    element={<NewOrder />}    />
          <Route path="/orders/:id"    element={<OrderDetail />} />
          <Route path="/invoices"      element={<Invoices />}    />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
