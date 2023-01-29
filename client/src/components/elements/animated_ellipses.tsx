import * as React from 'react';

type AnimatedEllipsesProps = {

};

const firstStep = 1;
const maxStep = 3;
const interval = 500;

export default function AnimatedEllipses({ }: AnimatedEllipsesProps) {
  const [step, setStep] = React.useState(firstStep);

  React.useEffect(
    () => {
      let step = firstStep;
      const setStepLoop = setInterval(() => {
        step += 1;
        if (step > maxStep) step = firstStep;
        setStep(step);
      }, interval);

      return () => {
        clearInterval(setStepLoop);
      };
    },
    [] // only run effect on mount, cleanup on unmount
  );

  return (
    <span>
      <span>{".".repeat(step)}</span>
      <span style={{ opacity: 0 }}>{".".repeat(maxStep - step)}</span>
    </span>
  );
}