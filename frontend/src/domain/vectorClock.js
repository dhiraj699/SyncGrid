export function mergeClock(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] > (target[key] ?? 0)) target[key] = source[key];
  }
  return target;
}
