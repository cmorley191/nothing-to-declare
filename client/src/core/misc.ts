
/**
 * Returns a copy of the given object with the specified keys removed (if they are present).
 * 
 * @param omit key names to omit in the copy of `obj`
 * @param obj object to copy
 * @returns copy of `obj`, without any of the keys that appear in `omit`
 */
export function omitAttrs(omit: string[], obj: any): { [otherOptions: string]: unknown } {
  const result: any = {};
  Object.keys(obj).forEach((key) => {
    if (omit.indexOf(key) < 0) {
      result[key] = obj[key];
    }
  });
  return result;
}

/**
 * Returns a random integer between 0 (inclusive) and the provided maximum (exclusive).
 * 
 * @param max integer upper bound of integers that could be returned; 
 *            this maximum value will not be returned (exclusive)
 * @returns random integer between [0, `max`)
 */
export function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}
