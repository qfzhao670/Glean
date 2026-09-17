import type { Job } from './api';

// The API is newest-first. Completed jobs and older failures are history;
// keep only the active queue, or the latest failed attempt for retry.
export function currentJobs(jobs: Job[], dismissed: ReadonlySet<string> = new Set()): Job[] {
  const active = jobs.filter(job => job.status === 'queued' || job.status === 'running');
  if (active.length) return active;
  const latest = jobs[0];
  return latest?.status === 'failed' && !dismissed.has(latest.id) ? [latest] : [];
}
