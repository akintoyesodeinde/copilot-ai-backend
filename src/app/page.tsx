export default function ApiIndexPage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '48rem' }}>
      <h1>CodePilot AI — Headless REST API</h1>
      <p>
        This standalone Next.js backend serves versioned REST APIs under <code>/api/v1/*</code>.
      </p>
      <ul>
        <li>
          Liveness probe: <code>/api/v1/health/live</code>
        </li>
        <li>
          Readiness probe: <code>/api/v1/health/ready</code>
        </li>
        <li>
          OpenAPI 3.1 contract: <code>/api/v1/openapi.json</code>
        </li>
      </ul>
    </main>
  );
}
