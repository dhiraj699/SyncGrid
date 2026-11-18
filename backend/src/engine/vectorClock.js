export const ClockRelation = Object.freeze({
  BEFORE: 'BEFORE',
  AFTER: 'AFTER',
  EQUAL: 'EQUAL',
  CONCURRENT: 'CONCURRENT',
});

/** Compares two vector clocks. The result describes `left` relative to `right`. */
export function compareClocks(left, right) {
  let leftAhead = false;
  let rightAhead = false;

  for (const key of Object.keys(left)) {
    const delta = left[key] - (right[key] ?? 0);
    if (delta > 0) leftAhead = true;
    else if (delta < 0) rightAhead = true;
  }
  for (const key of Object.keys(right)) {
    if (!(key in left) && right[key] > 0) rightAhead = true;
  }

  if (leftAhead && rightAhead) return ClockRelation.CONCURRENT;
  if (leftAhead) return ClockRelation.AFTER;
  if (rightAhead) return ClockRelation.BEFORE;
  return ClockRelation.EQUAL;
}

export function mergeInto(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] > (target[key] ?? 0)) target[key] = source[key];
  }
  return target;
}
