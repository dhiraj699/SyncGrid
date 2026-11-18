import { ROLE_PRIORITY } from '../domain/access.js';
import { ClockRelation, compareClocks } from './vectorClock.js';

export const Resolution = Object.freeze({ APPLY: 'APPLY', SUPERSEDED: 'SUPERSEDED' });

const orderingKeyOf = ({ lamport, authorRole, authorId, opId }) => ({
  lamport: lamport ?? 0,
  priority: ROLE_PRIORITY[authorRole] ?? 0,
  authorId: authorId ?? '',
  opId: opId ?? '',
});

/**
 * Total order over mutations: logical timestamp, then role priority, then
 * author id, then op id. The op id makes the order strict, so every replica
 * and every arrival permutation converges on the same winner.
 */
export function compareOrdering(left, right) {
  const a = orderingKeyOf(left);
  const b = orderingKeyOf(right);
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.authorId !== b.authorId) return a.authorId < b.authorId ? -1 : 1;
  if (a.opId !== b.opId) return a.opId < b.opId ? -1 : 1;
  return 0;
}

/**
 * Decides whether an incoming mutation may overwrite the cell's current state.
 *  - causally after the last write (author had seen it): apply
 *  - causally before it (stale replay): superseded
 *  - concurrent: the higher ordering key wins
 */
export function resolveAgainstCell(cell, incoming) {
  const relation = compareClocks(incoming.vectorClock, cell.vectorClock);
  if (relation === ClockRelation.AFTER || relation === ClockRelation.EQUAL) return Resolution.APPLY;
  if (relation === ClockRelation.BEFORE) return Resolution.SUPERSEDED;
  return compareOrdering(incoming, cell) > 0 ? Resolution.APPLY : Resolution.SUPERSEDED;
}
