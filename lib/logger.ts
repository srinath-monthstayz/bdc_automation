type Outcome = "processed" | "skipped" | "errored";

interface RunEntry {
  outcome: Outcome;
  subject: string;
  reason: string;
  detail?: unknown;
}

// Collects everything that happens during one cron/webhook invocation into a single
// structured summary, so failures are visible in the endpoint's JSON response and in
// GitHub Actions run logs without anyone having to open the Vercel dashboard.
export class RunLogger {
  private entries: RunEntry[] = [];

  processed(subject: string, reason: string, detail?: unknown) {
    this.entries.push({ outcome: "processed", subject, reason, detail });
    console.log(JSON.stringify({ level: "info", outcome: "processed", subject, reason, detail }));
  }

  skipped(subject: string, reason: string, detail?: unknown) {
    this.entries.push({ outcome: "skipped", subject, reason, detail });
    console.warn(JSON.stringify({ level: "warn", outcome: "skipped", subject, reason, detail }));
  }

  errored(subject: string, reason: string, detail?: unknown) {
    this.entries.push({ outcome: "errored", subject, reason, detail });
    console.error(JSON.stringify({ level: "error", outcome: "errored", subject, reason, detail }));
  }

  summary() {
    const counts = { processed: 0, skipped: 0, errored: 0 };
    for (const e of this.entries) counts[e.outcome]++;
    return { counts, entries: this.entries };
  }
}
