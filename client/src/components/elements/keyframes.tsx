import * as React from "react";

/**
 * `@keyframes`-injecting element for animation.
 * 
 * `props.name` specifies the `animation-name`.
 * Specify each keyframe as `_<percentage>:{{ <style> }}`.
 * 
 * Example:
 *
 * `<Keyframes name="oscillate" _0={{ opacity: 0.9 }} _100={{ opacity: 0.2 }} />`
 * 
 * The standard `from` and `to` substitutes may be used instead of `_0` and `_100`:
 * 
 * `<Keyframes name="oscillate" from={{ opacity: 0.9 }} to={{ opacity: 0.2 }} />`
 */
export default function Keyframes(props: {
  name: string,
  [key: string]: React.CSSProperties | string
}) {
  const toCss = (cssObject: React.CSSProperties | string) =>
    typeof cssObject === "string"
      ? cssObject
      : Object.keys(cssObject).reduce((accumulator, key) => {
        const cssKey = key.replace(/[A-Z]/g, v => `-${v.toLowerCase()}`);
        const cssValue = (cssObject as any)[key].toString().replace("'", "");
        return `${accumulator}${cssKey}:${cssValue};`;
      }, "");

  return (
    <style>
      {`@keyframes ${props.name} {
        ${Object.entries(props)
          .map(([key, value]) => {
            return ["from", "to"].includes(key)
              ? `${key} { ${toCss(value)} }`
              : /^_[0-9]+$/.test(key)
                ? `${key.replace("_", "")}% { ${toCss(value)} }`
                : "";
          })
          .join(" ")}
      }`}
    </style>
  );
};