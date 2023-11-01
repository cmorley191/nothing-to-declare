
export type Result<TValue, TError> =
  | { ok: true, value: TValue }
  | { ok: false, error: TError };
