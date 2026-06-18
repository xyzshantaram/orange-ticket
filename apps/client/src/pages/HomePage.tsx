import { Link } from 'react-router-dom'
import { Ticket, ScanQrCode } from 'lucide-react'

export default function HomePage() {
  return (
    <div className="page centered">
      <h1>Orange Ticket</h1>
      <p className="home-tagline">Physical Bitcoin vouchers. No custodian. No account.</p>
      <div className="home-actions">
        <Link to="/create" className="btn-primary home-btn">
          <Ticket size={20} strokeWidth={1.75} /> Create Vouchers
        </Link>
        <Link to="/claim" className="btn-secondary home-btn">
          <ScanQrCode size={20} strokeWidth={1.75} /> Claim a Voucher
        </Link>
      </div>
    </div>
  )
}
