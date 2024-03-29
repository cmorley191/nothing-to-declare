import { Optional, nullopt, opt } from "./optional"

export type ArrayEveryTransformResult<U> =
  | { testResult: true, transformed: U }
  | { testResult: false }
declare global {
  interface Array<T> {

    /**
     * Similar to `every()`, but the predicate returns an optional transformed version of each element. 
     * If every element returns a populated optional, the array of transformed
     * elements is returned. Otherwise `nullopt` is returned.
     */
    everyTransform<U>(predicate: (element: T, index: number) => Optional<U>): Optional<U[]>

    filterTransform<U>(predicate: (element: T, index: number) => Optional<U>): U[]

    groupBy<TKey>(keySelector: (element: T, index: number) => TKey): { key: TKey, group: T[] }[]

    /**
     * Splits the array into arrays of the specified size, grouping adjacent elements.
     * The last subarray may be smaller than the specified size if the array 
     * could not be evenly divided.
     * 
     * e.g. `[1, 2, 3, 4, 5, 6, 7].groupwise(3)` returns `[[1, 2, 3], [4, 5, 6], [7]]`
     */
    groupwise(groupSize: number): T[][]

    indexed(): [T, number][]

    padLeft(args: { toLength: number, getPadElement: (i: number) => T }): T[]
    padRight(args: { toLength: number, getPadElement: (i: number, arrayIndex: number) => T }): T[]

    /**
     * Splits the array into two arrays `[trues, falses]` using the predicate.
     * The first array contains elements that predicate returned `true` for,
     * and the second array has the `false` elements.
     * 
     * Stable: order of elements is maintained.
     */
    split(predicate: (element: T, index: number) => boolean): [T[], T[]]
    splitMap<U>(predicate: (element: T, index: number) => [boolean, U]): [U[], U[]]

    shallowCopy(): T[]

    skip(count: number): T[]
    take(count: number): T[]

    /**
     * Like zip, but extra elements are dropped if one of the arrays is bigger than the other.
     */
    takeZip<U>(other: U[]): [T, U][]
    zip<U>(other: U[]): [T, U][] | undefined
  }
}

Array.prototype.everyTransform = function <T, U>(this: T[], predicate: (element: T, index: number) => Optional<U>) {
  const transformeds = this.filterTransform((x, i) => predicate(x, i));
  if (transformeds.length == this.length) {
    return opt(transformeds);
  } else {
    return nullopt;
  }
}

Array.prototype.filterTransform = function <T, U>(this: T[], predicate: (element: T, index: number) => Optional<U>) {
  const transformeds: U[] = [];
  this.forEach((x, i) => {
    const predicateResult = predicate(x, i);
    if (predicateResult.hasValue == true) {
      transformeds.push(predicateResult.value);
    }
  });
  return transformeds;
}

Array.prototype.groupBy = function <T, TKey>(this: T[], keySelector: (element: T, index: number) => TKey) {
  const groups: { key: TKey, group: T[] }[] = [];
  this.forEach((x, i) => {
    const key = keySelector(x, i);
    const matchingGroup = groups.filter(g => g.key == key)[0];
    if (matchingGroup === undefined) {
      groups.push({ key, group: [x] });
    } else {
      matchingGroup.group.push(x);
    }
  });
  return groups;
}

Array.prototype.groupwise = function <T>(this: T[], groupSize: number) {
  const groups: T[][] = [];
  this.forEach((x, i) => {
    const lastGroup = groups.at(-1);
    if (i % groupSize == 0) {
      groups.push([x]);
    } else if (lastGroup === undefined) {
      console.log(`groupwise forEach did not start at i=0: ${i}`);
      console.trace();
    } else {
      lastGroup.push(x);
    }
  });
  return groups;
}

Array.prototype.indexed = function <T>(this: T[]) {
  return this.map((x, i) => [x, i]);
}

Array.prototype.padLeft = function <T>(this: T[], args: { toLength: number, getPadElement: (i: number) => T }) {
  if (this.length >= args.toLength) return this;
  else return (
    Array(args.toLength - this.length).fill(0)
      .map(i => args.getPadElement(i))
      .concat(this)
  );
}
Array.prototype.padRight = function <T>(this: T[], args: { toLength: number, getPadElement: (i: number, arrayIndex: number) => T }) {
  if (this.length >= args.toLength) return this;
  else return (
    this.concat(
      Array(args.toLength - this.length).fill(0)
        .map(i => args.getPadElement(i, this.length + i))
    )
  );
}


Array.prototype.shallowCopy = function <T>(this: T[]) {
  return [...this];
}

Array.prototype.splitMap = function <T, U>(this: T[], predicate: (element: T, index: number) => [boolean, U]) {
  const trues: U[] = [];
  const falses: U[] = [];
  this.forEach((x, i) => {
    const [trueFalse, obj] = predicate(x, i);
    if (trueFalse) {
      trues.push(obj)
    } else {
      falses.push(obj)
    }
  });
  return [trues, falses];
}
Array.prototype.split = function <T>(this: T[], predicate: (element: T, index: number) => boolean) {
  return this.splitMap((x, i) => [predicate(x, i), x]);
}

Array.prototype.skip = function <T>(this: T[], count: number) {
  return this.slice(count);
}
Array.prototype.take = function <T>(this: T[], count: number) {
  return this.slice(0, count);
}

Array.prototype.takeZip = function <T, U>(this: T[], other: U[]) {
  return this.filterTransform((x, i) => {
    const y = other[i];
    if (y === undefined) return nullopt;
    return opt([x, y]);
  });
}
Array.prototype.zip = function <T, U>(this: T[], other: U[]) {
  if (this.length !== other.length) {
    return undefined;
  }
  return this.takeZip(other);
}