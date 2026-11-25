"use client";

/** Last resort: the root layout itself failed. Must render its own <html>/<body> and avoid app styles. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f8fafc", margin: 0 }}>
        <div style={{ maxWidth: 440, margin: "20vh auto", padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, color: "#0f172a" }}>Saikil Shakti can&apos;t load right now</h1>
          <p style={{ color: "#475569", fontSize: 14 }}>Something went wrong on our side. Please try again in a moment.</p>
          {error.digest && <p style={{ color: "#64748b", fontSize: 12, fontFamily: "monospace" }}>Reference: {error.digest}</p>}
          <button
            onClick={reset}
            style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, border: 0, background: "#E2231A", color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
