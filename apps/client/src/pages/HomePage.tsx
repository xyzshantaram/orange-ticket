import { Link } from 'react-router-dom'

export default function HomePage() {
  return (
    <div className="page centered">
      <h1>Orange Ticket</h1>
      <p>Physical Bitcoin vouchers. No custodian. No account.</p>
      <div className="home-actions">
        <Link to="/create" className="btn-primary">
          Create Vouchers
        </Link>
        <Link to="/claim" className="btn-secondary">
          Claim a Voucher
        </Link>
      </div>
    </div>
  )
}
