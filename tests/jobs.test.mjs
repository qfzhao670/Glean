import assert from 'node:assert/strict';
import test from 'node:test';
import { currentJobs } from '../src/jobs.ts';

test('progress includes only active tasks, never completed or failed history', () => {
  const jobs = [{ id: 'a', status: 'queued' }, { id: 'b', status: 'running' },
    { id: 'c', status: 'completed' }, { id: 'd', status: 'failed' }];
  assert.deepEqual(currentJobs(jobs), jobs.slice(0, 2));
});

test('latest failed attempt can be retried or dismissed without showing older history', () => {
  const jobs = [{ id: 'new', status: 'failed' }, { id: 'old', status: 'failed' }];
  assert.deepEqual(currentJobs(jobs), [jobs[0]]);
  assert.deepEqual(currentJobs(jobs, new Set(['new'])), []);
});

test('completion empties progress even with old failed tasks', () => {
  assert.deepEqual(currentJobs([{ id: 'new', status: 'completed' }, { id: 'old', status: 'failed' }]), []);
  assert.deepEqual(currentJobs([]), []);
});

test('a retried task reappears while queued or running', () => {
  const retried = { id: 'retry', status: 'queued' };
  assert.deepEqual(currentJobs([{ id: 'new', status: 'completed' }, retried], new Set(['retry'])), [retried]);
});
