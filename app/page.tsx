export default function Home() {
  return (
    <main style={{ fontFamily: "monospace", padding: "2rem" }}>
      <h1>Booking.com Automation</h1>
      <p>This is a backend service. There is no UI here.</p>
      <ul>
        <li>GET /api/cron/poll-booking-com - polled every 5 min by GitHub Actions; polls Gmail, then processes any pending record marked &quot;Ready to Create Trip&quot;</li>
      </ul>
    </main>
  );
}
