
export { }; // in order to declare global, this file must be a module (must export something)

declare global {
  interface String {
    capitalize(): string
  }
}

String.prototype.capitalize = function (this: string) {
  const firstChar = this[0];
  if (firstChar === undefined) return "";
  else return `${firstChar.toUpperCase()}${this.substring(1)}`;
}