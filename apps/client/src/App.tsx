import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage.js'
import CreatePage from './pages/CreatePage.js'
import BatchPage from './pages/BatchPage.js'
import ClaimPage from './pages/ClaimPage.js'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/create" element={<CreatePage />} />
        <Route path="/batch/:batchId" element={<BatchPage />} />
        <Route path="/claim" element={<ClaimPage />} />
      </Routes>
    </BrowserRouter>
  )
}
