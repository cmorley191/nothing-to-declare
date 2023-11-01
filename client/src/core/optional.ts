
export type Optional<T> =
  | { hasValue: true, value: T }
  | { hasValue: false }
export type nullopt_t = { hasValue: false }
export const nullopt: nullopt_t = { hasValue: false };
export function opt<T>(value: T): { hasValue: true, value: T } { return { hasValue: true, value } }

export function optMap<T, U>(o: Optional<T>, mapper: (value: T) => U): Optional<U> {
  if (o.hasValue === false) return nullopt;
  else return opt(mapper(o.value));
}
export function optBind<T, U>(o: Optional<T>, binding: (value: T) => Optional<U>): Optional<U> {
  if (o.hasValue === false) return nullopt;
  else return binding(o.value);
}
export function optValueOr<T>(o: Optional<T>, defaultValue: T): T {
  if (o.hasValue === true) return o.value;
  else return defaultValue;
}
export function optAnd<T, U>(o1: Optional<T>, o2: Optional<U>): Optional<[T, U]> {
  if (o1.hasValue === true && o2.hasValue === true) return opt([o1.value, o2.value]);
  else return nullopt;
}
export function optFromNullable<T>(v: T | null): Optional<T> {
  if (v === null) return nullopt;
  else return opt(v);
}
export function optFromUndefable<T>(v: T | undefined): Optional<T> {
  if (v === undefined) return nullopt;
  else return opt(v);
}
export function optFromNullableUndefable<T>(v: T | null | undefined): Optional<T> {
  if (v === null || v === undefined) return nullopt;
  else return opt(v);
}