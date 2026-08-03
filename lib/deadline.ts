// A soft internal time budget, checked between items in a batch, so a run with more
// work than usual (e.g. draining a large backlog) always returns a clean summary well
// before Vercel's hard function-timeout kill - instead of losing the whole run's log.
// Whatever didn't fit just runs on the next poll 5 minutes later.
export class Deadline {
  private readonly endAt: number;

  constructor(budgetMs: number) {
    this.endAt = Date.now() + budgetMs;
  }

  exceeded(): boolean {
    return Date.now() >= this.endAt;
  }
}
