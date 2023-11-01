import * as React from "react";

import BufferedWebSocket, { WebSocketHandlers } from "../../core/buffered_websocket";
import * as NetworkTypes from "../../game/network_types";
import { CartState, ClientGameState, CommunityContractPools as CommunityContractPools, ClaimedCart, IgnoreDeal, PersistentGameState, ProductType, ServerGameState, TraderSupplies, getProductInfo, readyPoolSize, illegalProductIcon, legalProductIcon, moneyIcon, fineIcon, productInfos, unknownProductIcon, recycleIcon, trophyIcon, pointIcon, firstPlaceIcon, secondPlaceIcon, awardTypes, winnerIcon, PlayerArray, ProductArray, ValidatedPlayerIndex, ValidPlayerIndex, SerializableServerGameState, iPlayerToNum, GameSettings, officerIcon, contractIcon, crossOutIcon, Payment, paymentEmpty, SerializableIgnoreDeal } from "../../game/game_types";
import { getRandomInt, omitAttrs } from "../../core/misc";
import { Optional, nullopt, opt, optAnd, optBind, optMap, optValueOr } from "../../core/optional";

import AnimatedEllipses from "../elements/animated_ellipses";
import Keyframes from "../elements/keyframes";

import parchmentLegalImgSrc from '../../../images/parchment.png';
import parchmentLegalHighlightedImgSrc from '../../../images/parchment_highlighted.png';
import parchmentIllegalImgSrc from '../../../images/parchment_red.png';
import parchmentIllegalHighlightedImgSrc from '../../../images/parchment_red_highlighted.png';
import visaScrollImgSrc from '../../../images/parchment_clear_scroll.png';
import contractBoardImgSrc from '../../../images/supply_contract_board.png';
import cartEmptyImgSrc from '../../../images/cart_empty.png';
import cartClosedLabeledImgSrc from '../../../images/cart_closed_labeled.png';
import cartClosedUnlabeledImgSrc from '../../../images/cart_closed_unlabeled.png';
import cartOpenLabeledImgSrc from '../../../images/cart_open_labeled.png';
import cartOpenUnlabeledImgSrc from '../../../images/cart_open_unlabeled.png';
import cartLidImgSrc from '../../../images/cart_lid.png';
import crowbarImgSrc from '../../../images/crowbar.png';
import stampImgSrc from '../../../images/stamper.png';
import { OfficerToolStampState } from "../../game/network_types";

type LocalInfo = {
  localPlayerName: string,
  connectAddress: string,
  clientId: number
};

type MenuGameProps = {
  localInfo: LocalInfo,
  hostInfo: NetworkTypes.HostClientInfo,
  settings: GameSettings,
  clients: PlayerArray<NetworkTypes.ClientInfo & { icon: string }>,
  ws: BufferedWebSocket,

  onClose: (props: { warning: string }) => void
};

/**
 * Minimum time between network events sent related to the Customs state's officer crowbar / stamp.
 */
const officerToolUpdateMinIntervalMs = 150;

type WaitAnimationStep = {
  type: "wait",
  delayMs: number
}
type CartMotionGameAnimationStep = {
  type: "cart motion",
  iPlayerCart: ValidPlayerIndex,
  motion: "trader supplies to suspect area" | "suspect area to trader supplies"
}
type CrateGameAnimationStep = {
  type: "crate",
  iPlayerCrate: ValidPlayerIndex,
  animation: "open lid" | "close lid" | "blast lid"
}
type CrateProductDestination =
  | { destination: "garbage" }
  | { destination: "supplies", iPlayer: ValidPlayerIndex }
type CrateContentsGameAnimationStep = {
  type: "crate contents",
  iPlayerCrate: ValidPlayerIndex,
  animation: (
    | { animation: "display contents", contents: { product: ProductType }[], iProductCheekyDelay: Optional<number> }
    | { animation: "deposit contents", contents: { product: ProductType, destination: CrateProductDestination }[], illegalsHidden: boolean }
  )
}
type PaymentGameAnimationStep = {
  type: "payment",
  iPlayerGiver: ValidPlayerIndex,
  iPlayerReceiver: ValidPlayerIndex,
  action: "reveal if not yet revealed" | "give" | "receive",
  payment: Payment,
}
type ClaimMessageGameAnimationStep = {
  type: "claim message",
  message: string
}
type GameAnimationStep =
  | WaitAnimationStep
  | CartMotionGameAnimationStep
  | CrateGameAnimationStep
  | CrateContentsGameAnimationStep
  | PaymentGameAnimationStep
  | ClaimMessageGameAnimationStep
type GameAnimationSequence = {
  sequence: GameAnimationStep[],
  onCompleteRegistrations: (() => void)[][],
  previousGameStateSequence: Optional<GameAnimationStep[]>,
  persistToNextGameState: boolean,
}

/**
 * (React hook) Provides an interface with the current step in the GameAnimationSequence.
 * 
 * Produces a state update (rerender) whenever the sequence advances to a new step 
 * (i.e. whenever onCompleteRegistrations are called).
 */
function useGameAnimationStep(animation: Optional<GameAnimationSequence>) {
  const [iGameAnimationStep, setIGameAnimationStep] = React.useState(0);
  const gameAnimationStep = (() => {
    if (animation.hasValue === false) return nullopt;

    const step = animation.value.sequence[iGameAnimationStep];
    const onCompleteRegistrations = animation.value.onCompleteRegistrations[iGameAnimationStep];
    if (step === undefined || onCompleteRegistrations === undefined) return nullopt;

    return opt({ step, onCompleteRegistrations });
  })();

  React.useEffect(() => {
    if (animation.hasValue == true) {
      const unregisters: (() => void)[] = [];
      animation.value.onCompleteRegistrations.forEach((r, i) => {
        const registrationIndex = r.push(() => {
          setIGameAnimationStep(i + 1);
        }) - 1;
        unregisters.push(() => { r[registrationIndex] = (() => { }) });
      });

      return () => {
        unregisters.forEach(c => c());
      }
    }
    return;
  }, []);

  return { iGameAnimationStep, gameAnimationStep };
}

/**
 * (React hook) Provides a more detailed interface with the current step in the GameAnimationSequence.
 * 
 * In addition to the data provided by useGameAnimationStep, a set of provided "state" (arbitrary state type)
 * constructors are used to generate a list of the states before and after each animation step. The states
 * surrounding the current animation step are provided explicitly.
 *
 * @param propsState the state provided by the props. This is not necessary the state before the first animation
 *                   step -- if there was a persistent animation sequence from previous game state(s), the props
 *                   are expected to not have been updated (i.e. this would be the state before the previous sequence)
 */
function useGameAnimationStates<TState>(args: {
  animation: Optional<GameAnimationSequence>,
  propsState: TState,
  getPostStepState: (args: {
    step: GameAnimationStep,
    iStep: number,
    onCompleteRegistration: (() => void)[],
    callAllOnCompletes: () => void,
    previousState: TState,
    previousStates: TState[],
  }) => TState,
  getPostSequenceState: (args: {
    previousState: TState,
    previousStates: TState[],
  }) => TState,
}) {
  const { iGameAnimationStep, gameAnimationStep } = useGameAnimationStep(args.animation);

  const intermediateData = (() => {
    const preFullAnimationSequenceState = args.propsState;

    const postFullAnimationStepsStates: TState[] = [];

    if (args.animation.hasValue == true) {
      const previousGameStateSequence =
        (args.animation.value.previousGameStateSequence.hasValue === true)
          ? (
            args.animation.value.previousGameStateSequence.value
              .map((s): [GameAnimationStep, (() => void)[]] => [s, []])
          )
          : [];
      const currentSequence =
        args.animation.value.sequence
          .zip(args.animation.value.onCompleteRegistrations)
        ?? [];

      previousGameStateSequence.concat(currentSequence)
        .forEach(([step, onCompleteRegistration], iStepInFullSequence) => {
          postFullAnimationStepsStates.push(
            args.getPostStepState({
              step,
              iStep: iStepInFullSequence - previousGameStateSequence.length,
              onCompleteRegistration,
              callAllOnCompletes: (() => onCompleteRegistration.forEach(c => c())),
              previousState: postFullAnimationStepsStates.at(-1) ?? preFullAnimationSequenceState,
              previousStates: [preFullAnimationSequenceState].concat(postFullAnimationStepsStates),
            })
          );
        });
    }

    const postAnimationSequenceState = args.getPostSequenceState({
      previousState: postFullAnimationStepsStates.at(-1) ?? preFullAnimationSequenceState,
      previousStates: [preFullAnimationSequenceState].concat(postFullAnimationStepsStates),
    });

    return {
      preFullAnimationSequenceState,
      postFullAnimationStepsStates,
      ...(
        (args.animation.hasValue === false || args.animation.value.previousGameStateSequence.hasValue === false)
          ? {
            preAnimationSequenceState: preFullAnimationSequenceState,
            postAnimationStepsStates: postFullAnimationStepsStates,
          }
          : {
            preAnimationSequenceState: postFullAnimationStepsStates[args.animation.value.previousGameStateSequence.value.length - 1] ?? preFullAnimationSequenceState,
            postAnimationStepsStates: postFullAnimationStepsStates.slice(args.animation.value.previousGameStateSequence.value.length),
          }
      ),
      postAnimationSequenceState
    }
  })();

  return {
    iGameAnimationStep,
    gameAnimationStep,
    preAnimationStepState: intermediateData.postAnimationStepsStates[iGameAnimationStep - 1] ?? intermediateData.preAnimationSequenceState,
    postAnimationStepState: intermediateData.postAnimationStepsStates[iGameAnimationStep] ?? intermediateData.postAnimationSequenceState,
    ...intermediateData,
  }
}

const initialRecyclePoolContractCount = 15;

/**
 * Returns a number of randomly-chosen supply contracts (specifically, returns their ProductType) 
 * from the general pool, and updates the general pool in-place to reflect the removed contracts.
 * 
 * @param numContracts number of supply contracts to take
 * @param numPlayers number of players in the game
 */
function takeContractsFromGeneralPool(gameSettings: GameSettings, contractPools: CommunityContractPools, numContracts: number) {
  let generalPoolTotalContractCount = contractPools.generalPoolContractCounts.arr.reduce((a, b) => a + b);

  // refresh general pool if it's about to be empty
  if (generalPoolTotalContractCount + 1 < numContracts) {
    contractPools.generalPoolContractCounts = gameSettings.generalPoolContractCounts.shallowCopy();
    contractPools.recyclePoolsContracts = contractPools.recyclePoolsContracts.map(p => p.take(initialRecyclePoolContractCount));
    contractPools.recyclePoolsContracts.forEach(pool => {
      pool.forEach(product => contractPools.generalPoolContractCounts.set(product, contractPools.generalPoolContractCounts.get(product) - 1))
    });

    generalPoolTotalContractCount = contractPools.generalPoolContractCounts.arr.reduce((a, b) => a + b);
  }

  return (
    Array(numContracts).fill(false)
      .map(() => {
        let iContract = getRandomInt(generalPoolTotalContractCount);

        const productType: ProductType = (() => {
          for (const [productCount, iProduct] of contractPools.generalPoolContractCounts.arr.indexed()) {
            iContract -= productCount;
            if (iContract < 0) {
              contractPools.generalPoolContractCounts.arr[iProduct]--;
              generalPoolTotalContractCount--;
              return iProduct;
            }
          }
          console.log(
            `Error: takeContractsFromGeneralPool algorithm tried to take a supply contract out of range of the pool's contents.`
            + `\ngeneralPoolContractCounts: ${JSON.stringify(contractPools.generalPoolContractCounts)}, remaining iContract: ${iContract}`
          );
          console.trace();
          return -1;
        })();

        return productType;
      })
  );
}

/**
 * @param numPlayers number of players in the game
 */
function generateInitialPersistentGameState(gameSettings: GameSettings, players: PlayerArray<any>): PersistentGameState {
  const generalPoolContractCounts = gameSettings.generalPoolContractCounts.shallowCopy();
  const contractPools: CommunityContractPools = {
    generalPoolContractCounts: generalPoolContractCounts,
    recyclePoolsContracts:
      (gameSettings.swapMode === "strategic")
        ? Array(2).fill(false)
          .map(() => takeContractsFromGeneralPool(gameSettings, { generalPoolContractCounts, recyclePoolsContracts: [[], []] }, initialRecyclePoolContractCount))
        : [[], []] // recycle pools dont matter in simple mode
  };

  const traderSupplies =
    players.map(() => {
      return {
        readyPool: takeContractsFromGeneralPool(gameSettings, contractPools, readyPoolSize),
        money: 50,
        shopProductCounts: productInfos.map(() => 0)
      };
    });

  return {
    communityPools: contractPools,
    traderSupplies,
    counters: {
      entryVisa: getRandomInt(7000) + 1000,
      incidentReport: getRandomInt(7000) + 1000,
    }
  };
}


/**
 * (Element) Simple div with border and title span.
 */
function Section(props: {
  title?: string
  children?: React.ReactNode,
  [otherOptions: string]: unknown;
}) {
  const attrs = omitAttrs(['title', 'children'], props);

  return (
    <div
      {...attrs}
      style={{
        border: "1px solid black",
        ...((attrs['style'] !== undefined) ? attrs['style'] : {})
      }}
    >
      {
        (props.title === undefined)
          ? props.children
          : [
            (<span style={{ fontSize: "110%", fontWeight: "bold" }}>{props.title}</span>),
            (<div>{props.children}</div>)
          ]
      }
    </div>
  );
}


type FloatingDivPosition =
  | { relativeElementId: string }
  | "default position"
type FloatingDivAnimationStep =
  | { action: "notify", callback: () => void }
  | { action: "wait", delayMs: number }
  | { action: "teleport to", targetPosition: FloatingDivPosition }
  | { action: "float to", targetPosition: FloatingDivPosition, animationDuration: string, timingFunction?: ("linear" | "ease-in-out" | "ease-in" | "ease-out") }

/**
 * (Element) Absolute-positioned div that moves around the screen according to an animation schedule.
 */
function FloatingDiv(props: {
  usekey: string,
  animationSteps: FloatingDivAnimationStep[],
  children?: React.ReactNode,
  [otherOptions: string]: unknown;
}) {
  const attrs = omitAttrs(['usekey', 'animationSteps', 'children'], props);

  const [iCurrentAnimationStep, setICurrentAnimationStep] = React.useState(0);
  if (iCurrentAnimationStep < 0) {
    console.log(`FloatingDiv has negative iCurrentAnimationStep: ${iCurrentAnimationStep}`);
    console.trace();
    return (<div></div>);
  }
  const currentAnimationStep = props.animationSteps[iCurrentAnimationStep] ?? ({ action: "stop" } as { action: "stop" });

  const positionAtAnimationStep = (iAnimationStep: number): FloatingDivPosition => {
    for (const step of
      props.animationSteps
        .slice(0, iAnimationStep)
        .reverse()
    ) {
      if (step.action == "float to" || step.action == "teleport to") {
        return step.targetPosition;
      }
    }
    return "default position";
  };
  const currentPosition = positionAtAnimationStep(iCurrentAnimationStep);
  //console.log(`floating div ${props.usekey} current position: ${JSON.stringify(currentPosition)}`);

  React.useEffect(() => {
    if (currentAnimationStep.action == "notify") {
      currentAnimationStep.callback();
      setICurrentAnimationStep(iCurrentAnimationStep + 1);

    } else if (currentAnimationStep.action == "wait") {
      let timeout = setTimeout(() => {
        setICurrentAnimationStep(iCurrentAnimationStep + 1);
      }, currentAnimationStep.delayMs);
      return () => {
        clearTimeout(timeout);
      };

    } else if (currentAnimationStep.action == "teleport to") {
      setICurrentAnimationStep(iCurrentAnimationStep + 1);
    }
    return;
  }, [iCurrentAnimationStep]);

  const positionToStyle = (position: FloatingDivPosition): React.CSSProperties => {
    if (position == "default position") {
      return {
        position: "fixed",
        top: 0,
        left: 0,
        opacity: 0,
      };
    } else {
      const relativeElement = document.getElementById(position.relativeElementId)
      if (relativeElement === null) {
        console.log(`FloatingDiv positionToStyle lookup id ${position.relativeElementId} does not exist!`);
        console.trace();
        return {};
      }
      const relativeComponentEleBox = relativeElement.getBoundingClientRect();
      return {
        position: "fixed",
        top: `${Math.round(relativeComponentEleBox.top)}px`,
        left: `${Math.round(relativeComponentEleBox.left)}px`
      };
    }
  };

  const keyframesName = `${props.usekey}_floating_div_animation_step_${Math.min(iCurrentAnimationStep, props.animationSteps.length)}`;
  return (
    <div
      {...attrs}
      style={{
        ...positionToStyle(currentPosition),
        ...(
          (currentAnimationStep.action == "float to")
            ? {
              animationName: keyframesName,
              animationDuration: currentAnimationStep.animationDuration,
              animationIterationCount: 1,
              animationTimingFunction: currentAnimationStep.timingFunction !== undefined ? currentAnimationStep.timingFunction : "ease-in-out",
              animationFillMode: "both",
              animationDirection: "normal",
              animationDelay: "0s",
            } as React.CSSProperties
            : {}
        ),
        ...((attrs['style'] !== undefined) ? attrs['style'] : {}),
      }}
      onAnimationEnd={() => { setICurrentAnimationStep(iCurrentAnimationStep + 1) }}
    >
      {
        (currentAnimationStep.action == "float to")
          ? <Keyframes
            name={keyframesName}
            to={positionToStyle(currentAnimationStep.targetPosition)}
          />
          : undefined
      }
      <div key={`${props.usekey}_floating_div_animation_step_${Math.min(iCurrentAnimationStep, props.animationSteps.length)}_children`}>
        {props.children}
      </div>
    </div>
  );
}

function splitIntoLines(text: string, maxLineLength: number) {
  return (
    text
      .split("\n")
      .map(l =>
        l.split(" ")
          .reduce((a: string[], b: string): string[] => {
            const lastLine = a.at(-1);
            if (lastLine === undefined || lastLine.length + b.length > maxLineLength) return a.concat([b]);
            else return a.take(a.length - 1).concat([`${lastLine} ${b}`]);
          }, [])
      )
      .reduce((a, b) => a.concat(b))
  );
}

/**
 * (Element) Span that "types" its text one character at a time over an interval. 
 * Displays and animates according to ClaimMessageGameAnimationSteps in the game-wide GameAnimationSequence.
 */
function ClaimMessageAnimatedRevealingText(props: {
  usekey: string,
  initialMessage?: string,
  animation: Optional<GameAnimationSequence>,
  [otherOptions: string]: unknown;
}) {
  const attrs = omitAttrs(['initialMessage', 'animation'], props);

  const messageToMessageLines = (message: Optional<string>) => splitIntoLines(optValueOr(message, ""), 70);

  const { iGameAnimationStep, preAnimationStepState, postAnimationStepState } = (
    useGameAnimationStates<{
      message: Optional<string>,
      onStateReached: Optional<() => void>,
    }>({
      animation: props.animation,
      propsState: {
        message: props.initialMessage === undefined ? nullopt : opt(props.initialMessage),
        onStateReached: nullopt,
      },

      getPostStepState({
        step,
        callAllOnCompletes,
        previousState,
      }) {
        if (step.type === "claim message") {
          return {
            ...previousState,
            message: opt(step.message),
            onStateReached: opt(callAllOnCompletes),
          };
        } else {
          return {
            ...previousState,
            onStateReached: nullopt,
          };
        }
      },

      getPostSequenceState({
        previousState,
      }) {
        return {
          ...previousState,
          onStateReached: nullopt,
        };
      },
    })
  );

  const messageRevealingThisStep =
    (
      postAnimationStepState.message.hasValue === true
      && (
        preAnimationStepState.message.hasValue === false
        || preAnimationStepState.message.value !== postAnimationStepState.message.value
      )
    )
      ? opt(postAnimationStepState.message.value)
      : nullopt;

  const [messageLines, setMessageLines] = React.useState(() => messageToMessageLines(postAnimationStepState.message));
  const [revealProgress, setRevealProgress] = React.useState(messageRevealingThisStep.hasValue ? 0 : 10000000);

  React.useEffect(() => {
    if (messageRevealingThisStep.hasValue === true) {
      const stepMessageLines = messageToMessageLines(opt(messageRevealingThisStep.value));
      let revealProgress = 0;
      setMessageLines(stepMessageLines);
      setRevealProgress(revealProgress);

      const maxRevealProgress = stepMessageLines.map(l => l.length).reduce((a, b) => a + b);

      const interval = window.setInterval((() => {
        while (true) {
          if (revealProgress >= maxRevealProgress) {
            window.clearInterval(interval);
            if (postAnimationStepState.onStateReached.hasValue === true) postAnimationStepState.onStateReached.value();
            break;
          }
          revealProgress++;
          const charRevealed = (() => {
            let iChar = 0;
            for (const line of stepMessageLines) {
              const lineChar = line.at(revealProgress - iChar - 1);
              if (lineChar !== undefined) return lineChar;
              iChar += line.length;
            }
            return "";
          })();
          if (charRevealed !== " ") {
            break;
          }
        }
        setRevealProgress(revealProgress);
      }), 1000 / (10 + (messageRevealingThisStep.value.length / 10))); // 20 chars per second

      return () => {
        window.clearInterval(interval);
      }
    }
    return undefined;
  }, [iGameAnimationStep]);

  const [iRevealLine, iRevealChar] = (() => {
    let iLine = 0;
    let iChar = 0;
    for (const line of messageLines) {
      if (iChar + line.length >= revealProgress) return [iLine, revealProgress - iChar];
      iLine += 1;
      iChar += line.length;
    }
    return [iLine, 0];
  })();

  return (
    <span {...attrs}>
      {
        messageLines
          .map((l, i) => (
            <span key={`${props.usekey}_claim_message_line_${i}`}>
              {
                (iRevealLine !== i)
                  ? (
                    <span style={{ opacity: i < iRevealLine ? 1 : 0 }}>{l}</span>
                  )
                  : (
                    <span>
                      <span style={{ opacity: 1 }}>{l.substring(0, iRevealChar)}</span>
                      <span style={{ opacity: 0 }}>{l.substring(iRevealChar)}</span>
                    </span>
                  )
              }
              {
                (i < messageLines.length - 1)
                  ? (<br></br>)
                  : undefined
              }
            </span>
          ))
      }
    </span>

  )
}

/**
 * (Element) Table showing contents of a trader's TraderSupplies.
 * Animates supply icons into the payment area according to PaymentGameAnimationSteps in the GameAnimationSequence.
 * 
 * @param props.type whether the supplies belong to the local player or another player -- the resulting table is displayed differently
 */
function TraderSuppliesTable(props: {
  usekey: string,
  supplies: TraderSupplies,
  type: "other" | "local",
  iPlayerOwner: ValidPlayerIndex,
  animation: Optional<GameAnimationSequence>
  [otherOptions: string]: unknown
}) {
  const attrs = omitAttrs(['usekey', 'supplies', 'type', 'iPlayerOwner', 'animation'], props);

  const renderCount = React.useRef(0);
  React.useEffect(() => { renderCount.current++; })

  const { gameAnimationStep, preAnimationStepState, postAnimationStepState, } = (
    useGameAnimationStates<{
      supplies: TraderSupplies,
      iPlayerPaymentAreaOwner: Optional<ValidPlayerIndex>,
      onStateReached: Optional<() => void>,
    }>({
      animation: props.animation,
      propsState: {
        supplies: props.supplies,
        iPlayerPaymentAreaOwner: nullopt,
        onStateReached: nullopt,
      },

      getPostStepState({
        step,
        callAllOnCompletes,
        previousState,
      }) {
        if (step.type == "payment" && (
          (step.action == "give" && iPlayerToNum(step.iPlayerGiver) == iPlayerToNum(props.iPlayerOwner))
          || (step.action == "receive" && iPlayerToNum(step.iPlayerReceiver) == iPlayerToNum(props.iPlayerOwner))
        )) {
          return {
            ...previousState,
            supplies: {
              ...previousState.supplies,
              money: previousState.supplies.money + (step.action == "give" ? -step.payment.money : step.payment.money),
              shopProductCounts: previousState.supplies.shopProductCounts.map((previousAmount, p) => previousAmount + (step.action == "give" ? -step.payment.suppliesProducts.get(p) : step.payment.suppliesProducts.get(p))),
            },
            iPlayerPaymentAreaOwner: opt(step.iPlayerGiver),
            onStateReached: opt(callAllOnCompletes),
          };
        } else if (step.type == "crate contents") {
          const animation = step.animation;
          if (animation.animation == "deposit contents") {
            return {
              ...previousState,
              supplies: {
                ...previousState.supplies,
                shopProductCounts:
                  previousState.supplies.shopProductCounts
                    .map((c, p) => (
                      c + (
                        animation.contents
                          .filter((ap) => ap.product == p && ap.destination.destination == "supplies" && iPlayerToNum(ap.destination.iPlayer) == iPlayerToNum(props.iPlayerOwner))
                          .length
                      )
                    )),
              },
              iPlayerPaymentAreaOwner: nullopt,
              onStateReached: nullopt,
            };
          } else {
            return {
              ...previousState,
              iPlayerPaymentAreaOwner: nullopt,
              onStateReached: nullopt,
            };
          }
        } else {
          return {
            ...previousState,
            iPlayerPaymentAreaOwner: nullopt,
            onStateReached: nullopt,
          };
        }
      },

      getPostSequenceState({
        previousState,
      }) {
        return {
          ...previousState,
          iPlayerPaymentAreaOwner: nullopt,
          onStateReached: nullopt,
        };
      },
    })
  );

  const rows = (() => {
    const [legalProducts, illegalProducts] =
      productInfos
        .map((p, i) => {
          return {
            ...p,
            icon: p.icon as string,
            iconEleId: `${props.usekey}_item_icon_${p.type}`,
            suppliesCount: preAnimationStepState.supplies.shopProductCounts.get(i),
          };
        })
        .arr.split(p => p.legal);

    const moneyCount =
      (
        gameAnimationStep.hasValue == true
        && gameAnimationStep.value.step.type == "payment"
        && gameAnimationStep.value.step.action == "receive"
        && iPlayerToNum(gameAnimationStep.value.step.iPlayerReceiver) == iPlayerToNum(props.iPlayerOwner)
      )
        ? preAnimationStepState.supplies.money
        : postAnimationStepState.supplies.money;

    if (props.type == "other") {
      return legalProducts
        .map(p => {
          return {
            icon: p.icon,
            iconEleId: p.iconEleId,
            suppliesCount: p.suppliesCount
          }
        })
        .concat([
          {
            icon: illegalProductIcon,
            iconEleId: `${props.usekey}_item_icon_illegal`,
            suppliesCount: illegalProducts.reduce((sum, p) => sum + p.suppliesCount, 0)
          },
          {
            icon: moneyIcon,
            iconEleId: `${props.usekey}_item_icon_money`,
            suppliesCount: moneyCount,
          }
        ])
        .map((p) => (
          <span
            key={`${props.usekey}_other_trader_supplies_item_${p.icon}`}
            style={{ display: "inline-block" }}
          >
            <span id={p.iconEleId}>{p.icon}</span>
            {" "}{p.suppliesCount}
          </span>
        ))
        .groupwise(2)
        .map((g) => (<div>{...g}</div>));

    } else { // props.type == "local"
      return [(
        <div>
          <Section
            style={{ display: "inline-block", verticalAlign: "top" }}
          >
            <div>
              <span
                key={`${props.usekey}_other_trader_supplies_item_${moneyIcon}`}
              >
                <span id={`${props.usekey}_item_icon_money`}>{moneyIcon}</span>
                {" "}{moneyCount}
              </span>
            </div>
            <div>
              <span
                key={`${props.usekey}_other_trader_supplies_item_${pointIcon}`}
              >
                <span id={`${props.usekey}_item_icon_points`}>{pointIcon}</span>
                {" "}{moneyCount
                  + (legalProducts.concat(illegalProducts).map(p => p.suppliesCount * p.value as number).reduce((a, b) => a + b))}
              </span>
            </div>
          </Section>

          <Section
            style={{ display: "inline-block", verticalAlign: "top" }}
            title={`${legalProductIcon} Legal Products`}
          >
            {
              legalProducts
                .map(p => {
                  return {
                    icon: p.icon,
                    iconEleId: p.iconEleId,
                    suppliesCount: p.suppliesCount
                  }
                })
                .map((p) => (
                  <div>
                    <span
                      key={`${props.usekey}_other_trader_supplies_item_${p.icon}`}
                      style={{ display: "inline-block" }}
                    >
                      <span id={p.iconEleId}>{p.icon}</span>
                      {" "}{p.suppliesCount}
                    </span>
                  </div>
                ))
            }
          </Section>

          <Section
            style={{ display: "inline-block", verticalAlign: "top" }}
            title={`${illegalProductIcon} Illegal Products`}
          >
            {
              illegalProducts
                .groupBy(p => p.award.hasValue == true ? p.award.value.productType : 1000)
                .sort((a, b) => a.key - b.key)
                .map((g) => (
                  <div>
                    {
                      g.group
                        .sort((a, b) => a.type - b.type)
                        .map(p => (
                          <span
                            key={`${props.usekey}_other_trader_supplies_item_${p.icon}`}
                            style={{ display: "inline-block" }}
                          >
                            <span id={p.iconEleId}>{p.icon}</span>
                            {" "}{p.suppliesCount}
                          </span>
                        ))
                    }
                  </div>
                ))
            }
          </Section>

          <Section
            style={{ display: "inline-block", verticalAlign: "top" }}
            title={`${firstPlaceIcon}/${secondPlaceIcon} Award Count`}
          >
            {
              legalProducts.concat(illegalProducts)
                .filterTransform(p => p.award.hasValue == true ? opt({ productType: p.award.value.productType, points: p.award.value.points * p.suppliesCount }) : nullopt)
                .groupBy(a => a.productType)
                .sort((a, b) => a.key - b.key)
                .map((g) => (
                  <div>
                    <span
                      key={`${props.usekey}_other_trader_supplies_trophy_${g.key}`}
                      style={{ display: "inline-block" }}
                    >
                      {trophyIcon}{getProductInfo(g.key).icon}{" "}{g.group.map(a => a.points as number).reduce((a, b) => a + b)}
                    </span>
                  </div>
                ))
            }
          </Section>
        </div>
      )];
    }
  })();

  const stepIPlayerPaymentAreaOwner = postAnimationStepState.iPlayerPaymentAreaOwner;
  return (
    <div {...attrs}>
      {...rows}
      {
        stepIPlayerPaymentAreaOwner.hasValue == true
          ? (() => {
            const paymentSupplies = (
              [
                {
                  icon: moneyIcon,
                  amountExitingSuppliesArea: preAnimationStepState.supplies.money - postAnimationStepState.supplies.money,
                  id: -1,
                  suppliesAreaIconEleId: `${props.usekey}_item_icon_money`,
                }
              ]
                .concat(
                  preAnimationStepState.supplies.shopProductCounts
                    .zip(postAnimationStepState.supplies.shopProductCounts)
                    .map(([preAmount, postAmount], p) => ({
                      icon: productInfos.get(p).icon,
                      amountExitingSuppliesArea: preAmount - postAmount,
                      id: p,
                      suppliesAreaIconEleId: `${props.usekey}_item_icon_${p}`,
                    }))
                    .arr
                )
                .filter(s => s.amountExitingSuppliesArea != 0)
                .map(s => Array(Math.abs(s.amountExitingSuppliesArea)).fill(false).map(() => ({
                  icon: s.icon,
                  id: s.id,
                  suppliesAreaIconEleId: s.suppliesAreaIconEleId,
                  direction: s.amountExitingSuppliesArea > 0 ? "exiting supplies area" : "entering supplies area"
                })))
                .reduce((a, b) => a.concat(b), [])
            );
            return (
              paymentSupplies
                .map((s, i) => {
                  return (
                    <FloatingDiv
                      usekey={`${props.usekey}_floating_div_${s.id}_${i}_rerender_${renderCount.current}`}
                      animationSteps={
                        (
                          ((): FloatingDivAnimationStep[] => {
                            const paymentAreaIconEleId = `menu_game_payment_player_${iPlayerToNum(stepIPlayerPaymentAreaOwner.value)}_item_icon_${s.id}`;
                            const [sourceIconEleId, destinationIconEleId] =
                              (s.direction === "entering supplies area")
                                ? [paymentAreaIconEleId, s.suppliesAreaIconEleId]
                                : [s.suppliesAreaIconEleId, paymentAreaIconEleId];
                            return [
                              {
                                action: "teleport to",
                                targetPosition: {
                                  relativeElementId: sourceIconEleId
                                }
                              },
                              {
                                action: "wait",
                                delayMs: 300 * i
                              },
                              {
                                action: "float to",
                                targetPosition: {
                                  relativeElementId: destinationIconEleId
                                },
                                animationDuration: "700ms"
                              }
                            ];
                          })()
                        ).concat([
                          {
                            action: "notify",
                            callback: () => {
                              if (postAnimationStepState.onStateReached.hasValue == true && i == paymentSupplies.length - 1) {
                                postAnimationStepState.onStateReached.value();
                              }
                            }
                          }
                        ])
                      }
                    >
                      <span>{s.icon}</span>
                    </FloatingDiv>
                  );
                })
            );
          })()
          : undefined
      }
    </div>
  );
}

/**
 * (Element) A parchment listing a particular product type and its information.
 */
function SupplyContract(props: {
  productType: Optional<ProductType>,
  highlighted: boolean,
  crossedOut: boolean,
  [otherOptions: string]: unknown
}) {
  const attrs = omitAttrs(['productType'], props);

  const contractMarginPx = 10;

  return (
    <div
      {...attrs}
      style={{ // root div
        position: "relative",
        ...((attrs['style'] !== undefined ? attrs['style'] : {}))
      }}
    >
      <div style={{ // text content div
        whiteSpace: "nowrap",
        margin: `${contractMarginPx}px`,
        width: "88px", // TODO replace these hardcoded values with calculated ones? These are the biggest size I saw -- necessary so the Interactable...Stack jitter divs are all the same size
        height: "82px",
        position: "relative",
      }}>
        <div style={{ // product icon div
          display: "inline-block",
          fontSize: "200%",
          width: "100%",
          textAlign: "center",
          opacity: props.productType.hasValue === true ? 1 : 0
        }}>
          {props.productType.hasValue === true ? getProductInfo(props.productType.value).icon : unknownProductIcon}
        </div>
        <div hidden={props.productType.hasValue === true /* unknown product icon div */}
          style={{
            fontSize: "300%",
            width: "100%",
            textAlign: "center",
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translate(0, -50%)",
          }}>
          {unknownProductIcon}
        </div>

        <div style={{ // product info div
          width: "100%",
          textAlign: "center",
        }}>
          {
            (props.productType.hasValue === true)
              ? (
                <span>
                  {getProductInfo(props.productType.value).legal ? legalProductIcon : illegalProductIcon}
                  {" "}
                  {pointIcon}{getProductInfo(props.productType.value).value}
                  {" "}
                  {fineIcon}{getProductInfo(props.productType.value).fine}
                </span>
              )
              : (
                <span style={{ opacity: 0 }}>
                  {unknownProductIcon}{" "}{pointIcon}{0}{" "}{fineIcon}{0}
                </span>
              )
          }
        </div>
        <div style={{ // product awards div
          width: "100%",
          textAlign: "center",
        }}>
          {
            (() => {
              const award = (props.productType.hasValue == true ? getProductInfo(props.productType.value).award : nullopt);
              if (award.hasValue == false) {
                return (
                  <span style={{ opacity: 0, fontSize: "60%" }}>
                    {trophyIcon}{": "}{unknownProductIcon}
                  </span>
                )
              } else {
                return (
                  <span style={{ fontSize: "60%" }}>
                    {trophyIcon}{": "}{Array(award.value.points).fill(getProductInfo(award.value.productType).icon).join("")}
                  </span>
                )
              }
            })()
          }
        </div>
      </div>
      <div style={{ // cross out div
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        zIndex: 1,
        opacity: (props.crossedOut) ? 1 : 0,
      }}>
        {crossOutIcon}
      </div>
      <img
        src={ // background parchment img
          (props.productType.hasValue === false || getProductInfo(props.productType.value).category === "legal")
            ? ((props.highlighted) ? parchmentLegalHighlightedImgSrc : parchmentLegalImgSrc)
            : ((props.highlighted) ? parchmentIllegalHighlightedImgSrc : parchmentIllegalImgSrc)}
        style={{
          position: "absolute",
          left: 0,
          top: `-${contractMarginPx}px`,
          width: "100%",
          zIndex: -2,
        }}
      />
    </div>
  );
}

type InteractableSupplyContractData = {
  productType: Optional<ProductType>,
  opacity: ("visible" | "slightly faded" | "faded" | "hidden"),
  highlighted: boolean,
  crossedOut: boolean,
  clickable: boolean,
};

/**
 * (Element) One of the tables of supply contracts in the local ready pool display.
 */
function SupplyContractsInteractableGrid(props: {
  usekey: string,
  contracts: InteractableSupplyContractData[],
  onClick?: (event: { event: MouseEvent, iContract: number }) => void;
  onHover?: (event: { event: MouseEvent, iContract: Optional<number> }) => void;
  [otherOptions: string]: unknown
}) {
  const attrs = omitAttrs(['usekey', 'contracts', 'onClick', 'onHover'], props);

  const contractsPerRow = 3;

  return (
    <div {...attrs} key={props.usekey}>
      <table
        style={{ tableLayout: "fixed" }}
      >
        {
          props.contracts
            .map((c, i) => ({ ...c, iContract: i }))
            .groupwise(contractsPerRow)
            .map((g, iRow) => (
              <tr
                key={`${props.usekey}_supply_contract_group_${iRow}`}
              >
                {
                  g.map((c) => (
                    <td
                      key={`${props.usekey}_supply_contract_${c.iContract}`}
                      style={{
                        opacity: (c.opacity === "visible") ? 1 : (c.opacity == "faded") ? 0.3 : (c.opacity == "slightly faded") ? 0.6 : 0,
                        display: "inline-block",
                        width: `${Math.floor(100 / (iRow == 0 ? g.length : contractsPerRow)) - 1}%`,
                      }}
                      onClick={(event) => { if (c.clickable && props.onClick !== undefined) props.onClick({ event: event.nativeEvent, iContract: c.iContract }) }}
                      onMouseOver={(event) => { if (c.clickable && props.onHover !== undefined) props.onHover({ event: event.nativeEvent, iContract: opt(c.iContract) }) }}
                      onMouseOut={(event) => { if (c.clickable && props.onHover !== undefined) props.onHover({ event: event.nativeEvent, iContract: nullopt }) }}
                    >
                      <SupplyContract
                        productType={c.productType}
                        highlighted={c.highlighted}
                        crossedOut={c.crossedOut}
                      />
                    </td>
                  ))
                    .concat(Array((iRow == 0) ? 0 : contractsPerRow - g.length).fill(false).map((_blank, iBlank) => (
                      <td
                        key={`${props.usekey}_supply_contract_blank_${iRow}_${iBlank}`}
                        style={{
                          display: "inline-block",
                          width: `${Math.floor(100 / (iRow == 0 ? g.length : contractsPerRow)) - 1}%`,
                        }}
                      ></td>
                    )))
                }
              </tr>
            ))
        }
      </table>
    </div >
  );
}

/**
 * (Element) A stack of supply contracts, a substack of which can be interacted with, for the recycle community pool displays.
 */
function SupplyContractsInteractableStack(props: {
  usekey: string,
  contracts: (
    & InteractableSupplyContractData
    & {
      positionOffset: { leftPx: number, topPx: number, },
      positionJitter: { leftPx: number, topPx: number, },
      zIndex: number,
    }
  )[],
  onClick?: (event: { event: MouseEvent, iContract: number }) => void;
  onHover?: (event: { event: MouseEvent, iContract: Optional<number> }) => void;
  [otherOptions: string]: unknown
}) {
  const attrs = omitAttrs(['usekey', 'contracts', 'onClick'], props);

  const positionJitterStats = props.contracts.length === 0 ? { leftMin: 0, leftMax: 0, topMin: 0, topMax: 0 } : {
    leftMin: Math.min(...props.contracts.map(c => c.positionJitter.leftPx)),
    leftMax: Math.max(...props.contracts.map(c => c.positionJitter.leftPx)),
    topMin: Math.min(...props.contracts.map(c => c.positionJitter.topPx)),
    topMax: Math.max(...props.contracts.map(c => c.positionJitter.topPx)),
  }

  return (
    <div {...attrs} key={props.usekey}>
      {
        props.contracts
          .map((c, iContract) => (
            <div
              key={`${props.usekey}_supply_contract_${iContract}`}
              style={{
                opacity: (c.opacity === "visible") ? 1 : (c.opacity == "faded") ? 0.3 : (c.opacity == "slightly faded") ? 0.6 : 0,
                display: "inline-block",
                position: "absolute",
                left: `${c.positionOffset.leftPx + positionJitterStats.leftMin}px`,
                top: `${c.positionOffset.topPx + positionJitterStats.topMin}px`,
                zIndex: c.zIndex,
              }}
              onClick={(event) => { if (c.clickable && props.onClick !== undefined) props.onClick({ event: event.nativeEvent, iContract }) }}
              onMouseOver={(event) => { if (c.clickable && props.onHover !== undefined) props.onHover({ event: event.nativeEvent, iContract: opt(iContract) }) }}
              onMouseOut={(event) => { if (c.clickable && props.onHover !== undefined) props.onHover({ event: event.nativeEvent, iContract: nullopt }) }}
            >
              <div style={{
                marginLeft: c.positionJitter.leftPx - positionJitterStats.leftMin,
                marginTop: c.positionJitter.topPx - positionJitterStats.topMin,
                marginRight: positionJitterStats.leftMax - c.positionJitter.leftPx,
                marginBottom: positionJitterStats.topMax - c.positionJitter.topPx,
              }}>
                <SupplyContract
                  productType={c.productType}
                  highlighted={c.highlighted}
                  crossedOut={c.crossedOut}
                />
              </div>
            </div>
          ))
      }
    </div>
  );
}

type LocalReadyPoolStaticModeProps = {
  mode: "static"
}
type LocalReadyPoolSelectedForExitModeStrategicSelectedForEntryData = {
  recyclePoolSelectedCounts: number[],
  generalPoolSelectedCount: number,
};
type LocalReadyPoolSelectForExitModeStrategicEntryProps = {
  entryType: "strategic",
  enterableTitle: string,
  enteringTitle: string,
  communityPools: CommunityContractPools,
  initialSelectedForEntry?: LocalReadyPoolSelectedForExitModeStrategicSelectedForEntryData,
};
type LocalReadyPoolSelectedForExitModeSimpleEntryProps = {
  entryType: "simple",
  enteringTitle: string,
};
type LocalReadyPoolSelectForExitModeEntryProps =
  | LocalReadyPoolSelectForExitModeStrategicEntryProps
  | LocalReadyPoolSelectedForExitModeSimpleEntryProps;
type LocalReadyPoolSelectForExitModeProps = {
  mode: "select for exit",
  selectInstruction: string,
  readyTitle: string,
  exitTitle: string,
  submitText: string,
  entryProps: Optional<LocalReadyPoolSelectForExitModeEntryProps>,
  initialSelectedForExit?: boolean[],
  isSubmittable?: (state: { selectedForExit: boolean[], selectedForEntry: Optional<LocalReadyPoolSelectedForExitModeStrategicSelectedForEntryData> }) => boolean,
  onSubmit: (event: { selectedForExit: boolean[], selectedForEntry: Optional<LocalReadyPoolSelectedForExitModeStrategicSelectedForEntryData> }) => void,
  onChange?: (state: { selectedForExit: boolean[], selectedForEntry: Optional<LocalReadyPoolSelectedForExitModeStrategicSelectedForEntryData> }) => void,
}
type LocalReadyPoolModeProps =
  | LocalReadyPoolStaticModeProps
  | LocalReadyPoolSelectForExitModeProps
type LocalReadyPoolModeStateEntryState =
  | {
    entryType: "strategic",
    props: LocalReadyPoolSelectForExitModeStrategicEntryProps,
    selectedForEntry: LocalReadyPoolSelectedForExitModeStrategicSelectedForEntryData,
  }
  | {
    entryType: "simple",
    props: LocalReadyPoolSelectedForExitModeSimpleEntryProps,
  };
type LocalReadyPoolModeState =
  | LocalReadyPoolStaticModeProps
  | LocalReadyPoolSelectForExitModeProps & {
    selectedForExit: boolean[],
    entry: Optional<LocalReadyPoolModeStateEntryState>,
  }

/**
 * (Element) Display of the supply contracts in the local player's ready pool.
 * 
 * @param props.mode data regarding contract interaction if the ready pool is currently interactable
 */
function LocalReadyPool(props: {
  usekey: string,
  contracts: ProductType[]
  mode: LocalReadyPoolModeProps
  [otherOptions: string]: unknown
}) {
  const attrs = omitAttrs(['usekey', 'contracts', 'mode'], props);

  /*
   * Both props and state need type discrimination on the mode,
   * so they must be unified into a single object so we don't need to double check the mode.
   * We use the state as the unified object; props.mode should NOT be used in this function. 
   * If the mode prop changes, we need to synchronize it with the state object. 
   * To achieve this we synchronize on every render and call
   * setModeState to rerender (and use a ref flag to avoid an infinite loop of this).
   */
  /// initialization and synchronization function:
  const modePropsAsModeState = (modeStateToSynchronize?: LocalReadyPoolModeState): LocalReadyPoolModeState => {
    if (props.mode.mode == "static") {
      return props.mode;

    } else { // select for exit

      if ( // if props.initialSelected (both entry and exit) matches the existing state's initial selected, keep the state's selected
        modeStateToSynchronize !== undefined
        && modeStateToSynchronize.mode === "select for exit"
        && ((props.mode.initialSelectedForExit === undefined) === (modeStateToSynchronize.initialSelectedForExit === undefined))
        && (
          (props.mode.initialSelectedForExit === undefined || modeStateToSynchronize.initialSelectedForExit === undefined)
          || ((() => {
            const zipped = props.mode.initialSelectedForExit.zip(modeStateToSynchronize.initialSelectedForExit);
            return zipped !== undefined && zipped.every(([propHasInitiallySelected, stateHasInitiallySelected]) => propHasInitiallySelected === stateHasInitiallySelected)
          })())
        )
        && (props.mode.entryProps.hasValue === modeStateToSynchronize.entry.hasValue)
        && (
          (props.mode.entryProps.hasValue === false || modeStateToSynchronize.entry.hasValue === false)
          || (
            (props.mode.entryProps.value.entryType === "simple" && modeStateToSynchronize.entry.value.entryType === "simple")
            || (
              (props.mode.entryProps.value.entryType === "strategic" && modeStateToSynchronize.entry.value.entryType === "strategic")
              && ((props.mode.entryProps.value.initialSelectedForEntry === undefined) === (modeStateToSynchronize.entry.value.props.initialSelectedForEntry === undefined))
              && (
                (props.mode.entryProps.value.initialSelectedForEntry === undefined || modeStateToSynchronize.entry.value.props.initialSelectedForEntry === undefined)
                || (() => {
                  const recycleZipped = props.mode.entryProps.value.initialSelectedForEntry.recyclePoolSelectedCounts
                    .zip(modeStateToSynchronize.entry.value.props.initialSelectedForEntry.recyclePoolSelectedCounts);
                  return (
                    (props.mode.entryProps.value.initialSelectedForEntry?.generalPoolSelectedCount === modeStateToSynchronize.entry.value.props.initialSelectedForEntry?.generalPoolSelectedCount)
                    && recycleZipped !== undefined
                    && recycleZipped.every(([propInitiallySelected, stateInitiallySelected]) => propInitiallySelected === stateInitiallySelected)
                  );
                })()
              )
            )
          )
        )
      ) {
        return {
          ...props.mode,
          selectedForExit: modeStateToSynchronize.selectedForExit,
          entry: optBind(
            optAnd(modeStateToSynchronize.entry, props.mode.entryProps),  // these are populated/not-populated together, based on if-statement above
            ([stateEntry, propsEntryProps]): Optional<LocalReadyPoolModeStateEntryState> => {
              if (stateEntry.entryType === "simple" && propsEntryProps.entryType === "simple") {
                return opt({
                  ...stateEntry,
                  props: propsEntryProps,
                });
              } else if (stateEntry.entryType === "strategic" && propsEntryProps.entryType === "strategic") {
                return opt({
                  ...stateEntry,
                  props: propsEntryProps,
                });
              } else return nullopt; // should never happen, based on if-statement above
            }
          )
        };

      } else { // else a props.initialSelected changed, so use that for selected
        return {
          ...props.mode,
          selectedForExit:
            (props.mode.initialSelectedForExit === undefined)
              ? Array(props.contracts.length).fill(false)
              : props.mode.initialSelectedForExit.shallowCopy(),
          entry: optMap(
            props.mode.entryProps,
            propsEntryProps => (
              (propsEntryProps.entryType === "simple")
                ? { entryType: "simple", props: propsEntryProps }
                : {
                  entryType: "strategic",
                  props: propsEntryProps,
                  selectedForEntry: (
                    (propsEntryProps.initialSelectedForEntry === undefined)
                      ? {
                        recyclePoolSelectedCounts: Array(propsEntryProps.communityPools.recyclePoolsContracts.length).fill(0),
                        generalPoolSelectedCount: 0,
                      }
                      : {
                        recyclePoolSelectedCounts: propsEntryProps.initialSelectedForEntry.recyclePoolSelectedCounts.shallowCopy(),
                        generalPoolSelectedCount: propsEntryProps.initialSelectedForEntry.generalPoolSelectedCount,
                      }
                  ),
                }
            )
          )
        };
      }
    }
  }
  const [mode, setModeState] = React.useState<LocalReadyPoolModeState>(modePropsAsModeState());
  const modeStateSynchonized = React.useRef(true); // initial state is already synchronized
  if (modeStateSynchonized.current) {
    // we just synchronized. synchronize on next render
    modeStateSynchonized.current = false;
  } else {
    // synchronize now
    modeStateSynchonized.current = true;
    setModeState(modePropsAsModeState(mode));
  }

  const [hoveredContract, setHoveredContract] = React.useState<Optional<{
    section:
    | { section: "general enterable" | "general entering" | "ready" | "exiting" }
    | { section: "recycle enterable" | "recycle entering", iPool: number },
    iContract: number,
  }>>(nullopt);

  const recycleDataZipped =
    (mode.mode == "select for exit" && mode.entry.hasValue === true && mode.entry.value.entryType === "strategic")
      ? mode.entry.value.selectedForEntry.recyclePoolSelectedCounts
        .zip(mode.entry.value.props.communityPools.recyclePoolsContracts)
      : [];

  return (
    <Section key={props.usekey} {...attrs}>
      <Section
        title={mode.mode === "select for exit" ? mode.selectInstruction : undefined}
      >
        { // <Section _enterable>
          (mode.mode == "select for exit" && mode.entry.hasValue === true && mode.entry.value.entryType === "strategic")
            ? (
              <Section key={`${props.usekey}_enterable_pool`}
                title={mode.entry.value.props.enterableTitle}
                style={{
                  display: "inline-block",
                  verticalAlign: "top",
                  position: "relative",
                }}
              >
                <img
                  src={contractBoardImgSrc}
                  style={{ width: "600px" }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: "198px",
                    top: "72px",
                    width: "201px",
                    height: "275px",
                  }}
                  onMouseOver={(_event) => {
                    setHoveredContract(opt({
                      section: { section: "general enterable" },
                      iContract:
                        (mode.entry.hasValue === true && mode.entry.value.entryType === "strategic") // TODO FIX these should always be true
                          ? mode.entry.value.selectedForEntry.generalPoolSelectedCount
                          : 0,
                    }));
                  }}
                  onMouseOut={(_event) => { setHoveredContract(nullopt); }}
                ></div>
                {
                  (() => {
                    const entry = mode.entry.value;
                    if (recycleDataZipped === undefined) return undefined;

                    // get from rng seeded with products in discard pile (or something else fixed?)
                    const positionOffsetsJitter: [number, number][] = [[2, 1], [-1, -5], [-6, -3], [5, 1], [-8, 2], [-1, 5], [-6, -4], [-3, 3], [8, -4], [-7, -5]];
                    const positionOffsets =
                      positionOffsetsJitter.map(([leftJitter, topJitter], iPos) => ({
                        leftOffset: 0,
                        topOffset: (iPos < readyPoolSize ? iPos * 20 : (readyPoolSize * 20) + ((iPos - readyPoolSize) * 4)),
                        leftJitter,
                        topJitter,
                      }));

                    return recycleDataZipped
                      .map(([selectedCount, pool], iPool) => (
                        <SupplyContractsInteractableStack
                          key={`${props.usekey}_enterable_recycle_pool_${iPool}`}
                          style={{
                            position: "absolute",
                            left: iPool == 0 ? "80px" : "410px",
                            top: "125px",
                          }}
                          usekey={`${props.usekey}_enterable_recycle_pool_${iPool}`}
                          contracts={
                            pool
                              .takeZip(positionOffsets)
                              .map(([p, positionOffset], iContract) => {
                                const highlighted =
                                  (hoveredContract.hasValue === true
                                    && (hoveredContract.value.section.section === "recycle enterable" || hoveredContract.value.section.section === "recycle entering")
                                    && hoveredContract.value.section.iPool === iPool
                                    && ((iContract < selectedCount) ? iContract >= hoveredContract.value.iContract : iContract <= hoveredContract.value.iContract)
                                    && ((iContract < selectedCount) === (hoveredContract.value.iContract < selectedCount))
                                  )
                                    ? { highlighted: true as true, iHoveredContract: hoveredContract.value.iContract }
                                    : { highlighted: false as false };

                                return {
                                  productType: opt(p),
                                  opacity: iContract < selectedCount ? "slightly faded" : "visible",
                                  highlighted: highlighted.highlighted,
                                  crossedOut: false,
                                  clickable: iContract < readyPoolSize,
                                  positionOffset: {
                                    leftPx: positionOffset.leftOffset + ((iContract >= selectedCount) ? 0 : (iPool == 0) ? -50 : 50),
                                    topPx: positionOffset.topOffset,
                                  },
                                  positionJitter: {
                                    leftPx: positionOffset.leftJitter,
                                    topPx: positionOffset.topJitter,
                                  },
                                  zIndex: positionOffsets.length - (
                                    (iContract >= readyPoolSize)
                                      ? (iContract + 1)
                                      : (() => {
                                        if (iContract < selectedCount) {
                                          return (highlighted.highlighted === true)
                                            ? (iContract - selectedCount)
                                            : (readyPoolSize - 1 - iContract);
                                        } else {
                                          return (highlighted.highlighted === true)
                                            ? (highlighted.iHoveredContract - iContract)
                                            : (iContract - selectedCount);
                                        }
                                      })()
                                  ),
                                };
                              })
                          }
                          onClick={(e) => {
                            const selectedIContract = pool[e.iContract];
                            if (selectedIContract === undefined || e.iContract >= readyPoolSize) {
                              console.log(`Bad iContract from recycle enterable pool LocalReadyPoolSupplyContracts click event: ${e.iContract}`);
                              console.trace();
                            } else {
                              const newRecyclePoolSelectedCounts = (() => {
                                const newCounts = entry.selectedForEntry.recyclePoolSelectedCounts.shallowCopy();
                                newCounts[iPool] = e.iContract + ((e.iContract < selectedCount) ? 0 : 1)
                                return newCounts;
                              })();

                              const newNonGeneralPoolReadyCounts = (
                                (newRecyclePoolSelectedCounts.reduce((a, b) => a + b))
                                + (mode.selectedForExit.filter(s => !s).length)
                              );
                              const newGeneralSelectedForEntry = Math.max(0, Math.min(readyPoolSize, readyPoolSize - newNonGeneralPoolReadyCounts));

                              const newSelectedForEntry = {
                                ...entry.selectedForEntry,
                                recyclePoolSelectedCounts: newRecyclePoolSelectedCounts,
                                generalPoolSelectedCount: newGeneralSelectedForEntry,
                              };

                              setModeState({
                                ...mode,
                                entry: opt({
                                  ...entry,
                                  selectedForEntry: newSelectedForEntry
                                })
                              });
                              if (mode.onChange !== undefined) mode.onChange({
                                selectedForExit: mode.selectedForExit,
                                selectedForEntry: opt(newSelectedForEntry)
                              });
                            }
                          }}
                          onHover={(e) => {
                            if (e.iContract.hasValue === false) {
                              setHoveredContract(nullopt);
                            } else {
                              const selectedIContract = pool[e.iContract.value];
                              if (selectedIContract === undefined || e.iContract.value >= readyPoolSize) {
                                console.log(`Bad iContract from recycle enterable pool LocalReadyPoolSupplyContracts hover event: ${e.iContract.value}`);
                                console.trace();
                              } else {
                                setHoveredContract(opt({
                                  section: {
                                    section: "recycle enterable",
                                    iPool,
                                  },
                                  iContract: e.iContract.value,
                                }));
                              }
                            }
                          }}
                        />
                      ));
                  })()
                }
              </Section>
            )
            : undefined
        }
        { // <Section _entering_recycle
          (() => {
            if (mode.mode !== "select for exit"
              || mode.entry.hasValue === false
              || recycleDataZipped === undefined
              || mode.entry.value.entryType !== "strategic"
            ) return undefined;
            const entry = mode.entry.value;

            return (
              <Section key={`${props.usekey}_entering_recycle_pools`}
                style={{
                  display: "inline-block",
                  verticalAlign: "top",
                  position: "relative",
                }}
              >
                {
                  recycleDataZipped.map(([selectedCount, pool], iPool) => {
                    return (
                      <Section key={`${props.usekey}_ready_entering_recycle_pool_${iPool}`}
                        title={`${entry.props.enteringTitle} (from Urgent ${iPool + 1})`}
                      >
                        <SupplyContractsInteractableGrid
                          usekey={`${props.usekey}_ready_pool_contracts_entering_recycle_pool_${iPool}`}
                          contracts={
                            pool.take(readyPoolSize)
                              .map((p, iContract): InteractableSupplyContractData => {
                                const hoveringToSelectInEnterableSection = (
                                  hoveredContract.hasValue === true
                                  && (hoveredContract.value.section.section === "recycle enterable" || hoveredContract.value.section.section === "recycle entering")
                                  && hoveredContract.value.section.iPool === iPool
                                  && iContract <= hoveredContract.value.iContract
                                );
                                return {
                                  productType: opt(p),
                                  opacity: iContract < selectedCount ? "visible" : (hoveringToSelectInEnterableSection) ? "faded" : "hidden",
                                  highlighted:
                                    (iContract < selectedCount || hoveringToSelectInEnterableSection)
                                    && hoveredContract.hasValue === true
                                    && (hoveredContract.value.section.section === "recycle enterable" || hoveredContract.value.section.section === "recycle entering")
                                    && hoveredContract.value.section.iPool === iPool
                                    && ((iContract < selectedCount) ? iContract >= hoveredContract.value.iContract : iContract <= hoveredContract.value.iContract)
                                    && ((iContract < selectedCount) === (hoveredContract.value.iContract < selectedCount)),
                                  crossedOut:
                                    mode.entry.hasValue === true
                                    && (iContract < selectedCount)
                                    && hoveredContract.hasValue === true
                                    && (hoveredContract.value.section.section === "recycle enterable" || hoveredContract.value.section.section === "recycle entering")
                                    && hoveredContract.value.section.iPool === iPool
                                    && iContract >= hoveredContract.value.iContract,
                                  clickable: iContract < selectedCount,
                                };
                              })
                          }
                          onClick={(e) => {
                            if (e.iContract >= selectedCount) {
                              console.log(`Bad iContract from recycle entering pool LocalReadyPoolSupplyContracts click event: ${e.iContract}`);
                              console.trace();
                            } else {
                              const newRecyclePoolSelectedCounts = (() => {
                                const newCounts = entry.selectedForEntry.recyclePoolSelectedCounts.shallowCopy();
                                newCounts[iPool] = selectedCount - (selectedCount - e.iContract);
                                return newCounts;
                              })();

                              const newNonGeneralPoolReadyCounts = (
                                (newRecyclePoolSelectedCounts.reduce((a, b) => a + b))
                                + (mode.selectedForExit.filter(s => !s).length)
                              );
                              const newGeneralSelectedForEntry = Math.max(0, Math.min(readyPoolSize, readyPoolSize - newNonGeneralPoolReadyCounts));

                              const newSelectedForEntry = {
                                ...entry.selectedForEntry,
                                recyclePoolSelectedCounts: newRecyclePoolSelectedCounts,
                                generalPoolSelectedCount: newGeneralSelectedForEntry,
                              };

                              setModeState({
                                ...mode,
                                entry: opt({
                                  ...entry,
                                  selectedForEntry: newSelectedForEntry
                                })
                              });
                              setHoveredContract(nullopt); // this contract is about to disappear from this section
                              if (mode.onChange !== undefined) mode.onChange({
                                selectedForExit: mode.selectedForExit,
                                selectedForEntry: opt(newSelectedForEntry)
                              });
                            }
                          }}
                          onHover={(e) => {
                            if (e.iContract.hasValue === false) setHoveredContract(nullopt);
                            else {
                              if (e.iContract.value >= selectedCount) {
                                console.log(`Bad iContract from recycle entering pool LocalReadyPoolSupplyContracts click event: ${e.iContract.value}`);
                                console.trace();
                              } else {
                                setHoveredContract(opt({
                                  section: { section: "recycle entering", iPool },
                                  iContract: e.iContract.value,
                                }))
                              }
                            }
                          }}
                        />
                      </Section>
                    );

                  })
                }
              </Section>
            );
          })()
        }
        <Section key={`${props.usekey}_ready_and_entering_general_pools`}
          title={mode.mode == "select for exit" ? mode.readyTitle : undefined}
          style={{ display: "inline-block", verticalAlign: "top" }}
        >
          <SupplyContractsInteractableGrid
            usekey={`${props.usekey}_ready_pool_contracts`}
            contracts={
              (mode.mode === "static")
                ? props.contracts
                  .map((p) => ({ productType: opt(p), opacity: "visible", highlighted: false, crossedOut: false, clickable: false }))
                : // mode == "select for exit"
                (props.contracts
                  .zip(mode.selectedForExit) ?? []) // TODO fix by moving props.contracts into the state, zipped with selected
                  .map(([p, selected], iContract) => {
                    return {
                      productType: opt(p),
                      opacity: (!selected) ? "visible" : "faded",
                      highlighted:
                        hoveredContract.hasValue === true
                        && (hoveredContract.value.section.section === "ready" || hoveredContract.value.section.section === "exiting")
                        && hoveredContract.value.iContract === iContract,
                      crossedOut:
                        mode.entry.hasValue === true
                        && (
                          selected || (
                            hoveredContract.hasValue === true
                            && hoveredContract.value.section.section === "ready"
                            && hoveredContract.value.iContract === iContract
                          )
                        ),
                      clickable: true
                    };
                  })
            }
            onClick={(e) => {
              if (mode.mode == "select for exit") {
                const iContractCurrentSelectedForExit = mode.selectedForExit[e.iContract];
                if (iContractCurrentSelectedForExit === undefined) {
                  console.log(`Bad iContract from ready pool LocalReadyPoolSupplyContracts click event: ${e.iContract}`);
                  console.trace();
                } else {
                  const newSelectedForExit = mode.selectedForExit.shallowCopy();
                  newSelectedForExit[e.iContract] = !iContractCurrentSelectedForExit;

                  const newEntry = optMap(mode.entry,
                    modeEntryVal => {
                      if (modeEntryVal.entryType === "simple") return modeEntryVal;

                      const newNonGeneralPoolReadyCounts = (
                        (modeEntryVal.selectedForEntry.recyclePoolSelectedCounts.reduce((a, b) => a + b))
                        + (newSelectedForExit.filter(s => !s).length)
                      );
                      const newGeneralSelectedForEntry = Math.max(0, Math.min(readyPoolSize, readyPoolSize - newNonGeneralPoolReadyCounts));

                      const newSelectedForEntry = {
                        ...modeEntryVal.selectedForEntry,
                        generalPoolSelectedCount: newGeneralSelectedForEntry,
                      };
                      return {
                        ...modeEntryVal,
                        selectedForEntry: newSelectedForEntry,
                      }
                    }
                  );

                  setModeState({ ...mode, selectedForExit: newSelectedForExit, entry: newEntry });
                  if (mode.onChange !== undefined) mode.onChange({
                    selectedForExit: newSelectedForExit,
                    selectedForEntry: optBind(newEntry, newEntryVal => newEntryVal.entryType === "strategic" ? opt(newEntryVal.selectedForEntry) : nullopt)
                  });
                }
              }
            }}
            onHover={(e) => {
              if (e.iContract.hasValue === false) {
                setHoveredContract(nullopt);
              } else {
                if (mode.mode == "select for exit") {
                  const iContractCurrentSelected = mode.selectedForExit[e.iContract.value];
                  if (iContractCurrentSelected === undefined) {
                    console.log(`Bad iContract from ready pool LocalReadyPoolSupplyContracts hover event: ${e.iContract.value}`);
                    console.trace();
                  } else {
                    setHoveredContract(opt({
                      section: { section: "ready", },
                      iContract: e.iContract.value,
                    }));
                  }
                }
              }
            }}
          />
          { // <Section _entering_general
            (mode.mode == "select for exit" && mode.entry.hasValue === true)
              ? (
                <Section key={`${props.usekey}_ready_entering_general_pool`}
                  title={(mode.entry.value.entryType === "simple")
                    ? `${mode.entry.value.props.enteringTitle}`
                    : `${mode.entry.value.props.enteringTitle} (Random)`
                  }
                >
                  <SupplyContractsInteractableGrid
                    usekey={`${props.usekey}_ready_pool_contracts_entering_general_pool`}
                    contracts={
                      Array(readyPoolSize).fill(false)
                        .map((_false, iContract): InteractableSupplyContractData => {
                          if (mode.entry.hasValue === false) return { productType: nullopt, opacity: "hidden", highlighted: false, crossedOut: false, clickable: false }; // TODO FIX hasValue should always be true
                          const selectedForEntry =
                            (mode.entry.value.entryType === "simple")
                              ? iContract < mode.selectedForExit.filter(s => s).length
                              : iContract < mode.entry.value.selectedForEntry.generalPoolSelectedCount;
                          return {
                            productType: nullopt,
                            opacity:
                              selectedForEntry
                                ? "visible"
                                : "hidden",
                            highlighted: false,
                            crossedOut: false,
                            clickable: false,
                          };
                        })
                    }
                  />
                </Section>
              )
              : undefined
          }
        </Section>
        { // <Section _exit>
          (mode.mode == "select for exit")
            ? (
              <Section key={`${props.usekey}_exit`}
                style={{ display: "inline-block", verticalAlign: "top" }}
                title={mode.exitTitle}
              >
                <SupplyContractsInteractableGrid
                  usekey={`${props.usekey}_exit_contracts`}
                  contracts={
                    (props.contracts
                      .zip(mode.selectedForExit) ?? []) // TODO fix, see above
                      .map(([p, s], iContract) => {
                        return {
                          productType: opt(p),
                          opacity: s ? "visible" : "hidden",
                          highlighted:
                            hoveredContract.hasValue === true
                            && (hoveredContract.value.section.section === "exiting" || hoveredContract.value.section.section === "ready")
                            && hoveredContract.value.iContract === iContract,
                          crossedOut: false,
                          clickable: s
                        };
                      })
                  }
                  onClick={(e) => {
                    const iContractCurrentSelectedForExit = mode.selectedForExit[e.iContract];
                    if (iContractCurrentSelectedForExit === undefined) {
                      console.log(`Bad iContract from exit LocalReadyPoolSupplyContracts click event: ${e.iContract}`);
                      console.trace();
                    } else {
                      const newSelectedForExit = mode.selectedForExit.shallowCopy();
                      newSelectedForExit[e.iContract] = !iContractCurrentSelectedForExit;

                      const newEntry = optMap(mode.entry,
                        modeEntryVal => {
                          if (modeEntryVal.entryType === "simple") return modeEntryVal;

                          const newNonGeneralPoolReadyCounts = (
                            (modeEntryVal.selectedForEntry.recyclePoolSelectedCounts.reduce((a, b) => a + b))
                            + (newSelectedForExit.filter(s => !s).length)
                          );
                          const newGeneralSelectedForEntry = Math.max(0, Math.min(readyPoolSize, readyPoolSize - newNonGeneralPoolReadyCounts));

                          const newSelectedForEntry = {
                            ...modeEntryVal.selectedForEntry,
                            generalPoolSelectedCount: newGeneralSelectedForEntry,
                          };
                          return {
                            ...modeEntryVal,
                            selectedForEntry: newSelectedForEntry,
                          }
                        }
                      );

                      setModeState({ ...mode, selectedForExit: newSelectedForExit, entry: newEntry, });
                      setHoveredContract(nullopt); // this contract is about to disappear from this section
                      if (mode.onChange !== undefined) mode.onChange({
                        selectedForExit: newSelectedForExit,
                        selectedForEntry: optBind(newEntry, newEntryVal => newEntryVal.entryType === "strategic" ? opt(newEntryVal.selectedForEntry) : nullopt),
                      });
                    }
                  }}
                  onHover={(e) => {
                    if (e.iContract.hasValue === false) setHoveredContract(nullopt);
                    else {
                      const iContractCurrentSelected = mode.selectedForExit[e.iContract.value];
                      if (iContractCurrentSelected === undefined) {
                        console.log(`Bad iContract from exit LocalReadyPoolSupplyContracts click event: ${e.iContract.value}`);
                        console.trace();
                      } else {
                        setHoveredContract(opt({
                          section: { section: "exiting" },
                          iContract: e.iContract.value,
                        }));
                      }
                    }
                  }}
                />
              </Section>
            )
            : undefined
        }
      </Section>
      {
        (mode.mode == "select for exit")
          ? (
            <button
              disabled={!(mode.isSubmittable === undefined
                || mode.isSubmittable({
                  selectedForExit: mode.selectedForExit,
                  selectedForEntry: optBind(mode.entry, entryVal => entryVal.entryType === "strategic" ? opt(entryVal.selectedForEntry) : nullopt),
                }))
              }
              onClick={(_e) => {
                mode.onSubmit({
                  selectedForExit: mode.selectedForExit,
                  selectedForEntry: optBind(mode.entry, entryVal => entryVal.entryType === "strategic" ? opt(entryVal.selectedForEntry) : nullopt),
                });
              }}
            >
              {mode.submitText}
            </button>
          )
          : undefined
      }
    </Section>
  );
}

type CartContents =
  | { labeled: false, state: "no crate" | "open crate" | "closed crate" }
  | { labeled: true, state: "open crate" | "closed crate", count: number, productType: Optional<ProductType> }
type CartOfficerToolsProps = {
  crowbarPresent: boolean,
  stampPresent: boolean,
  controls: (
    | {
      localControllable: true,
      onInternalOfficerToolUpdate: (event: { toolsUpdates: NetworkTypes.OfficerToolsState, sendUpdateNow: boolean }) => void,
    }
    | {
      localControllable: false,
      eventHandling?: {
        registerEventHandlers: (args: { onExternalOfficerToolUpdate: (event: { newToolsState: NetworkTypes.OfficerToolsState }) => void }) => { handlerRegistrationId: number },
        unregisterEventHandlers: (handlerRegistrationId: number) => void,
      }
    }
  )
}

/**
 * (React hook) Provides an interface with cart officer tools and the corresponding server update events.
 * 
 * Caller provides a TDragState state type to capture the current state of the tool(s) being rendered.
 */
function useNetworkedOfficerToolState<TLocalState>(args: {
  propsTools: CartOfficerToolsProps,
  // if animationFunction options change make sure to update "calculate..." to emulate the functions
  networkStateToLocalState: (args: {
    networkState: Optional<NetworkTypes.OfficerToolsState>,
    previousState: Optional<TLocalState>,
  }) => Optional<{ state: TLocalState, animateTransition: "always" | "if existing" | "never" }>,
  localStateToNetworkStateUpdate: (localState: TLocalState) => NetworkTypes.OfficerToolsState,
  isStateOfficerControllable: (localState: TLocalState) => boolean,
  areStatesEqualForRenderAndNetwork: (a: TLocalState, b: TLocalState) => boolean,
  getMouseDownState: (args: {
    eventTimeMs: number,
    previousState: TLocalState,
    event: MouseEvent,
  }) => { state: TLocalState, animateTransition: "always" | "if existing" | "never", sendUpdateNow: boolean },
  getMouseUpState: (args: {
    eventTimeMs: number,
    previousState: TLocalState,
    event: MouseEvent,
  }) => { state: TLocalState, animateTransition: "always" | "if existing" | "never", sendUpdateNow: boolean },
  getMouseMoveState: (args: {
    eventTimeMs: number,
    previousState: TLocalState,
    event: MouseEvent,
    clientMouseDownPosition: Optional<{ x: number, y: number }>,
  }) => { state: TLocalState, animateTransition: "always" | "if existing" | "never", sendUpdateNow: boolean },
  animationFunction: "linear",
  getInterruptedAnimationState: (args: { eventTime: number, animationProgress: number, startState: TLocalState, endState: TLocalState }) => TLocalState,
}) {
  const toolUpdateAnimationDurationMs = officerToolUpdateMinIntervalMs + 50;
  const getInterruptedAnimationState = (funcArgs: { animationStartTimeMs: number, interruptMs: number, startState: TLocalState, endState: TLocalState }) => {
    // currently only linear function permitted
    return args.getInterruptedAnimationState({
      ...funcArgs,
      eventTime: funcArgs.interruptMs,
      animationProgress:
        Math.min((funcArgs.interruptMs - funcArgs.animationStartTimeMs), toolUpdateAnimationDurationMs)
        / toolUpdateAnimationDurationMs,
    });
  };

  const [localData, setLocalData] = React.useState<Optional<{
    mouse:
    | { down: false }
    | { down: true, startPosition: { x: number, y: number } },
    localState: TLocalState,
    animation: Optional<{
      animationStartTimeMs: number,
      destLocalState: TLocalState,
    }>
  }>>(
    (args.propsTools.crowbarPresent === false && args.propsTools.stampPresent === false)
      ? nullopt
      : optMap(
        args.networkStateToLocalState({ networkState: nullopt, previousState: nullopt }),
        localState => ({
          mouse: { down: false },
          localState: localState.state,
          animation: nullopt,
        })
      )
  );

  const onOfficerControlEvent = (funcArgs: {
    eventTimeMs: number,
    newMouse?:
    | { down: false }
    | { down: true, startPosition: { x: number, y: number } },
    getEventState: (currentLocalState: TLocalState) => {
      state: TLocalState;
      animateTransition: "always" | "if existing" | "never";
      sendUpdateNow: boolean;
    },
  }) => {
    if (localData.hasValue === false) return;
    const controls = args.propsTools.controls;

    /*const onMouseDownUpHandler = (funcArgs: { event: MouseEvent, downEvent: boolean }) => {
      if (args.propsTools.crowbarPresent === false && args.propsTools.stampPresent === false) return;
      const controls = args.propsTools.controls;*/
    if (
      controls.localControllable == false
      || (localData.hasValue == true && !(args.isStateOfficerControllable(localData.value.localState)))
    ) {
      return;
    }

    const newMouse = funcArgs.newMouse ?? localData.value.mouse;

    setLocalData(() => {
      const animationData = optMap(localData.value.animation,
        animation => ({
          animation: animation,
          interruptState: getInterruptedAnimationState({
            animationStartTimeMs: animation.animationStartTimeMs,
            interruptMs: funcArgs.eventTimeMs,
            startState: localData.value.localState,
            endState: animation.destLocalState,
          })
        })
      );

      const currentState = animationData.hasValue === true ? animationData.value.interruptState : localData.value.localState;
      const newState = funcArgs.getEventState(currentState);

      if (animationData.hasValue === true && args.areStatesEqualForRenderAndNetwork(newState.state, animationData.value.animation.destLocalState)) {
        return opt({
          mouse: newMouse,
          localState: localData.value.localState,
          animation: opt({
            ...animationData.value.animation,
            destLocalState: newState.state,
          })
        });
      }

      const currentEqualsNew = args.areStatesEqualForRenderAndNetwork(currentState, newState.state);

      if (!currentEqualsNew) {
        controls.onInternalOfficerToolUpdate({
          toolsUpdates: args.localStateToNetworkStateUpdate(newState.state),
          sendUpdateNow: newState.sendUpdateNow,
        });
      }

      return opt({
        mouse: newMouse,
        ...(
          (!currentEqualsNew && (newState.animateTransition === "always" || (newState.animateTransition === "if existing" && animationData.hasValue)))
            ? {
              localState: currentState,
              animation: opt({
                animationStartTimeMs: funcArgs.eventTimeMs,
                destLocalState: newState.state
              })
            }
            : {
              localState: newState.state,
              animation: nullopt,
            }
        )
      });
    });
  }

  const onMouseDownUp = (funcArgs: { event: MouseEvent, downEvent: boolean }) => {
    const eventTimeMs = Date.now();
    if (args.propsTools.crowbarPresent === false && args.propsTools.stampPresent === false) return;

    if (localData.hasValue === false) return; // ignore when tool not present

    if (
      args.propsTools.controls.localControllable == false
      || !(args.isStateOfficerControllable(localData.value.localState))
    ) {
      return; // ignore mouse events when tool not controllable
    }

    if (localData.value.mouse.down === funcArgs.downEvent) {
      return;  // ignore repeat downup events; they shouldn't happen
    }

    onOfficerControlEvent({
      eventTimeMs,
      newMouse:
        (funcArgs.downEvent == true)
          ? { down: true, startPosition: { x: funcArgs.event.clientX, y: funcArgs.event.clientY } }
          : { down: false },
      getEventState(currentLocalState) {
        return (
          (funcArgs.downEvent == true)
            ? args.getMouseDownState
            : args.getMouseUpState
        )({
          eventTimeMs,
          previousState: currentLocalState,
          event: funcArgs.event,
        });
      },
    });
  }

  React.useEffect(() => {
    if (args.propsTools.crowbarPresent === false && args.propsTools.stampPresent === false) return;
    const controls = args.propsTools.controls;
    if (controls.localControllable == false) {
      const eventHandling = controls.eventHandling;
      if (eventHandling !== undefined) {
        const { handlerRegistrationId } = eventHandling.registerEventHandlers({
          onExternalOfficerToolUpdate: (event) => {
            if (localData.hasValue == true && !(args.isStateOfficerControllable(localData.value.localState))) {
              return;
            }

            const eventTime = Date.now();
            setLocalData(() => {
              const newLocalStateOpt = args.networkStateToLocalState({ networkState: opt(event.newToolsState), previousState: optMap(localData, localData => localData.localState) });
              return optMap(newLocalStateOpt,
                newLocalState => {
                  if (localData.hasValue == false) {
                    return {
                      mouse: { down: false }, // arbitrary -- this won't be used since localControllable false
                      localState: newLocalState.state,
                      animation: nullopt,
                    };
                  } else {
                    if (localData.value.animation.hasValue === true && args.areStatesEqualForRenderAndNetwork(newLocalState.state, localData.value.animation.value.destLocalState)) {
                      return {
                        ...localData.value,
                        animation: opt({
                          ...localData.value.animation.value,
                          destLocalState: newLocalState.state,
                        })
                      }
                    }

                    const currentLocalState = (
                      (localData.value.animation.hasValue == false)
                        ? localData.value.localState
                        : getInterruptedAnimationState({
                          interruptMs: eventTime,
                          animationStartTimeMs: localData.value.animation.value.animationStartTimeMs,
                          startState: localData.value.localState,
                          endState: localData.value.animation.value.destLocalState,
                        })
                    );

                    if (!args.areStatesEqualForRenderAndNetwork(currentLocalState, newLocalState.state) && (newLocalState.animateTransition === "always" || (newLocalState.animateTransition === "if existing" && localData.value.animation.hasValue))) {
                      return {
                        mouse: { down: false }, // won't be used
                        localState: currentLocalState,
                        animation: opt({
                          animationStartTimeMs: eventTime,
                          destLocalState: newLocalState.state,
                        }),
                      };
                    } else {
                      return {
                        ...localData.value,
                        localState: newLocalState.state,
                        animation: nullopt,
                      };
                    }
                  }
                }
              );
            });
          }
        });
        return () => { eventHandling.unregisterEventHandlers(handlerRegistrationId); }
      } else {
        return;
      }

    } else { // localControllable == true
      const onWindowMouseUp = (event: MouseEvent) => { onMouseDownUp({ event, downEvent: false }); };
      const onWindowMouseMove = (event: MouseEvent) => {
        const eventTimeMs = Date.now();
        if (args.propsTools.crowbarPresent === false && args.propsTools.stampPresent === false) return;
        if (localData.hasValue === false) return;
        if (!args.isStateOfficerControllable(localData.value.localState)) return;

        onOfficerControlEvent({
          eventTimeMs,
          getEventState(currentLocalState) {
            return args.getMouseMoveState({
              eventTimeMs,
              previousState: currentLocalState,
              event,
              clientMouseDownPosition: (localData.value.mouse.down === true) ? opt(localData.value.mouse.startPosition) : nullopt,
            });
          },
        });
      };

      window.addEventListener("mouseup", onWindowMouseUp);
      window.addEventListener("mousemove", onWindowMouseMove);

      return () => {
        window.removeEventListener("mouseup", onWindowMouseUp);
        window.removeEventListener("mousemove", onWindowMouseMove);
      };
    }
  }, [localData]);

  return {
    toolUpdateAnimationDurationMs,
    localData,
    onOfficerControlEvent: ((args: {
      eventTimeMs: number,
      getEventState: (currentLocalState: TLocalState) => {
        state: TLocalState;
        animateTransition: "always" | "if existing" | "never";
        sendUpdateNow: boolean;
      },
    }) => onOfficerControlEvent(args)),
    onToolMouseDown: (event: MouseEvent) => onMouseDownUp({ event, downEvent: true }),
    onAnimationComplete: () => {
      if (localData.hasValue === true && localData.value.animation.hasValue === true) {
        setLocalData(opt({
          ...localData.value,
          localState: localData.value.animation.value.destLocalState,
          animation: nullopt,
        }));
      }
    },
  };
}

/**
 * (Element) A trader's cart and contained crate. 
 * Crate lid is animated according to a simple animation type.
 * Animates interactable officer tools internally as needed.
 */
function AnimatedCart(props: {
  contents: CartContents,
  officerTools: CartOfficerToolsProps & { crowbarFullyUsed: boolean },
  animation: Optional<{
    animation: "blast lid" | "open lid" | "close lid",
    onComplete: Optional<() => void>,
  }>,
  [otherOptions: string]: unknown
}) {
  const attrs = omitAttrs(['contents', 'officerTools', 'animation'], props);

  const currentRenderTimeMs = Date.now();

  const crowbarDragDistanceRequired = 400;
  const crowbarUpdateAnimationFunction = "linear";

  const {
    localData: crowbarDragData,
    onToolMouseDown: onCrowbarMouseDownHandler,
    toolUpdateAnimationDurationMs: crowbarUpdateAnimationDurationMs,
    onAnimationComplete: onCrowbarAnimationComplete,
  } = (
      useNetworkedOfficerToolState<{ crowbar: NetworkTypes.OfficerToolCrowbarState, stamp: Optional<OfficerToolStampState> }>({
        propsTools: props.officerTools,
        networkStateToLocalState({ networkState }) {
          if (props.officerTools.crowbarFullyUsed) {
            return opt({
              state: {
                crowbar: { useProgress: 1 },
                stamp: nullopt,
              },
              animateTransition: "if existing",
            });
          } else if (networkState.hasValue === true && networkState.value.crowbar.hasValue === true) {
            return opt({
              state: {
                crowbar: networkState.value.crowbar.value,
                stamp: networkState.value.stamp,
              },
              animateTransition: "always",
            });
          } else if (props.officerTools.crowbarPresent) {
            return opt({
              animateTransition: "always",
              state: {
                crowbar: { useProgress: 0 },
                stamp:
                  (networkState.hasValue === true)
                    ? networkState.value.stamp
                    : nullopt, // stamp state is fairly unused by AnimatedCart; can be whatever on the very first interrogation state
              },
            });
          } else {
            return nullopt;
          }
        },
        localStateToNetworkStateUpdate(localState) {
          return {
            crowbar: opt(localState.crowbar),
            stamp: nullopt, // do not update stamp from AnimatedCart
          };
        },

        isStateOfficerControllable(localState) {
          return (
            props.officerTools.crowbarFullyUsed === false
            && localState.crowbar.useProgress < 1
            && (
              localState.stamp.hasValue === false
              || (
                localState.stamp.value.stamps.length === 0
                && localState.stamp.value.state !== "stamping"
              )
            )
          );
        },

        areStatesEqualForRenderAndNetwork(localStateA, localStateB) {
          return localStateA.crowbar.useProgress == localStateB.crowbar.useProgress;
        },

        getMouseDownState(args) { return { state: args.previousState, animateTransition: "never", sendUpdateNow: false } },
        getMouseUpState(args) { return { state: { ...args.previousState, crowbar: { useProgress: 0 } }, animateTransition: "always", sendUpdateNow: true } },

        getMouseMoveState(args) {
          // translates mouse drag pixels [0,400] to crowbar drag progress [0,1] using a log function, 
          // i.e. mouse drag provides more progress at the starting range (e.g. [0,100]) than the ending
          // See on wolfram alpha: "log2(1 + (x/10)) / log2(40) from x = -20 to x = 400"
          if (args.clientMouseDownPosition.hasValue === false) {
            return { state: { ...args.previousState, crowbar: { useProgress: 0 } }, animateTransition: "never", sendUpdateNow: false, };
          } else {
            const state = (
              Math.min(1, Math.max(0,
                Math.log2(1 + ((args.event.clientY - args.clientMouseDownPosition.value.y) / 10))
                / Math.log2(crowbarDragDistanceRequired / 10)
              ))
            );
            return {
              state: { ...args.previousState, crowbar: { useProgress: isNaN(state) ? 0 : state } },
              animateTransition: "never",
              sendUpdateNow: state === 1,
            };
          }
        },

        animationFunction: crowbarUpdateAnimationFunction,
        getInterruptedAnimationState(args) {
          return {
            ...args.endState,
            crowbar: {
              useProgress:
                args.startState.crowbar.useProgress
                + (
                  args.animationProgress
                  * (args.endState.crowbar.useProgress - args.startState.crowbar.useProgress)
                ),
            },
          };
        },
      })
    );

  const crowbarStartRotateDeg = -103;
  const crowbarEndRotateDeg = -45;
  const dragProgressToStyleDegString = (dragState: number) => {
    return `${Math.ceil(crowbarStartRotateDeg + (dragState * (crowbarEndRotateDeg - crowbarStartRotateDeg)))}deg`;
  }

  //console.log(`Animated Cart officer tools: ${JSON.stringify(props.officerTools)}, crowbar data: ${JSON.stringify(crowbarData)}`);

  return (
    <div {...attrs}>
      <div style={{ position: "relative", display: "inline-block" }}>   { /* TODO why is this "inline-block"?? */}
        { /* <div> */}
        <div style={{   // div of claimed contents text
          whiteSpace: "nowrap",
          marginLeft: "20px",
          marginRight: "45px",
          marginTop: "23px",
          marginBottom: "50px",
        }}>
          <div style={{
            width: "auto",
            textAlign: "center",
            opacity: (props.contents.labeled) ? 0.8 : 0,
            color: "white",
            fontWeight: "bold",
            fontFamily: "Courier New (monospace)",
          }}>
            <span>
              {
                (props.contents.labeled == true)
                  ? (
                    `${props.contents.count}`
                    + `${props.contents.productType.hasValue == true && props.contents.productType.value == ProductType.MILK ? " " : ""}` // milk emoji is smol
                    + `${props.contents.productType.hasValue == true ? getProductInfo(props.contents.productType.value).icon : unknownProductIcon}`
                  )
                  : `0 ${unknownProductIcon}` // div will be invisible, but put something realistic for element shape
              }
            </span>
          </div>
        </div>
        { /* </div> */}

        <img
          src={(() => {   // img of crate base
            switch ((props.animation.hasValue == true) ? "open crate" : props.contents.state) {
              case "no crate":
                return cartEmptyImgSrc;
              case "open crate":
                return (props.contents.labeled) ? cartOpenLabeledImgSrc : cartOpenUnlabeledImgSrc;
              case "closed crate":
                return (props.contents.labeled) ? cartClosedLabeledImgSrc : cartClosedUnlabeledImgSrc;
            }
          })()}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            zIndex: -3,
          }}
        />

        <img
          src={cartLidImgSrc}
          style={{
            opacity: (props.animation.hasValue == true || crowbarDragData.hasValue === true) ? 1 : 0,
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            zIndex: 3,
            animationName: (() => {
              if (props.animation.hasValue == false) {
                return undefined;
              }
              switch (props.animation.value.animation) {
                case "blast lid": return "cart_lid_blasting";
                case "open lid": return "cart_lid_opening";
                case "close lid": return "cart_lid_closing";
              }
            })(),
            animationDuration: props.animation.hasValue && props.animation.value.animation == "blast lid" ? "400ms" : "800ms",
            animationIterationCount: 1,
            animationTimingFunction: "linear",
            animationFillMode: "both",
            animationDirection: "normal",
            animationDelay: "0s",
            transformOrigin: "35% 4%",
          }}
          onAnimationEnd={() => {
            if (props.animation.hasValue == true && props.animation.value.onComplete.hasValue == true) {
              props.animation.value.onComplete.value();
            }
          }}
        />

        <Keyframes
          name="cart_lid_blasting"
          from={{ left: 0, top: 0, rotate: "0deg" }}
          to={{ left: "-100px", top: "-100px", rotate: "-150deg" }}
        />
        <Keyframes
          name="cart_lid_opening"
          from={{ left: 0 }}
          to={{ left: "-100px" }}
        />
        <Keyframes
          name="cart_lid_closing"
          from={{ left: "-100px" }}
          to={{ left: 0 }}
        />

        {
          (crowbarDragData.hasValue === true)
            ? (
              <div
                draggable={false}
                onMouseDown={(event) => { onCrowbarMouseDownHandler(event.nativeEvent); }}
                style={{
                  position: "absolute",
                  left: "52px",
                  top: "2px",
                  width: "50%",
                  zIndex: 2,
                  rotate: (crowbarDragData.value.animation.hasValue == false)
                    ? dragProgressToStyleDegString(crowbarDragData.value.localState.crowbar.useProgress)
                    : undefined,
                  animationName: (crowbarDragData.value.animation.hasValue == true)
                    ? (
                      `cart_crowbar_animation`
                      + `_${dragProgressToStyleDegString(crowbarDragData.value.localState.crowbar.useProgress)}`
                      + `_${dragProgressToStyleDegString(crowbarDragData.value.animation.value.destLocalState.crowbar.useProgress)}`
                    )
                    : undefined,
                  animationDuration: `${crowbarUpdateAnimationDurationMs}ms`,
                  animationIterationCount: 1,
                  animationTimingFunction: crowbarUpdateAnimationFunction,
                  animationFillMode: "both",
                  animationDirection: "normal",
                  animationDelay: `${Math.floor(
                    (crowbarDragData.value.animation.hasValue == false)
                      ? 0
                      : (-Math.min( // negative delay starts animation in middle of animation
                        (currentRenderTimeMs - crowbarDragData.value.animation.value.animationStartTimeMs),
                        crowbarUpdateAnimationDurationMs
                      ))
                  )}ms`,
                  transformOrigin: "5% 8%",
                }}
                onAnimationEnd={onCrowbarAnimationComplete}
              >
                <img
                  src={crowbarImgSrc}
                  draggable={false}
                  style={{
                    maxWidth: "100%",
                  }}
                />

                { // crowbar animation Keyframes
                  (crowbarDragData.value.animation.hasValue == true)
                    ? (
                      <Keyframes
                        name={
                          `cart_crowbar_animation`
                          + `_${dragProgressToStyleDegString(crowbarDragData.value.localState.crowbar.useProgress)}`
                          + `_${dragProgressToStyleDegString(crowbarDragData.value.animation.value.destLocalState.crowbar.useProgress)}`
                        }
                        from={{ rotate: dragProgressToStyleDegString(crowbarDragData.value.localState.crowbar.useProgress) }}
                        to={{ rotate: dragProgressToStyleDegString(crowbarDragData.value.animation.value.destLocalState.crowbar.useProgress) }}
                      />
                    )
                    : undefined
                }
              </div>
            )
            : undefined
        }
      </div>
    </div>
  );
}

/**
 * (Element) A trader's cart and contained crate (contains an AnimatedCart), 
 * and animated contained crate products.
 * 
 * Animates according to CartMotionGameAnimationSteps, CrateGameAnimationSteps,
 * and CrateContentsGameAnimationSteps in the game-wide GameAnimationSequence.
 * The cart is not interactable while animating.
 * 
 * Works with other FloatingAnimatedCarts to create the illusion of a single cart
 * floating around the screen; a static FloatingAnimatedCart appears at all locations 
 * that a cart could be, and is made invisible/visible as needed (see `props.active`).
 * 
 * @param props.location where this cart is located --
 *                       combines with `props.iPlayerOwner` to form a unique id,
 *                       determines whether interaction is possible,
 *                       and is used to understand the starting point for floating
 * @param props.iPlayerOwner the trader that this cart belongs to --
 *                           combines with `props.location` to form a unique id,
 *                           and is used to filter for relevant animation steps
 * @param props.iPlayerLocal the local trader player number --
 *                           used to identify the correct trader supplies icon 
 *                           element ids for contained crate products animations
 * @param props.active whether the `props.iPlayerOwner` trader's cart is at this
 *                     current location (or was at this location at the start of
 *                     the animation sequence) -- when not active, this cart is just
 *                     an invisible element for the owner's active cart to float to
 */
function FloatingAnimatedCart(props: {
  location: "Trader Supplies" | "Suspect Cart Area",
  iPlayerOwner: ValidPlayerIndex,
  iPlayerLocal: ValidPlayerIndex,
  active: boolean,
  contents: CartContents,
  officerTools: CartOfficerToolsProps,
  animation: Optional<GameAnimationSequence>,
  [otherOptions: string]: unknown
}) {
  const attrs = omitAttrs(['location', 'iPlayerOwner', 'iPlayerLocal', 'active', 'contents', 'officerTools', 'animation'], props);

  const renderCount = React.useRef(0);
  React.useEffect(() => { renderCount.current++; });

  const getStaticCartEleId = (args: { location: "Trader Supplies" | "Suspect Cart Area", iPlayerOwner?: ValidPlayerIndex }) =>
    (args.location == "Trader Supplies")
      ? `menu_game_trader_animated_cart_${args.iPlayerOwner === undefined ? "" : iPlayerToNum(args.iPlayerOwner)}_static_cart`
      : `menu_game_suspect_cart_animated_cart_static_cart`;

  const { preAnimationStepState, postAnimationStepState } = (
    useGameAnimationStates<{
      location: "Trader Supplies" | "Suspect Cart Area",
      crateState: "lid blasted" | "lid opened" | "lid closed",
      crateContents:
      | { state: "none" }
      | { state: "displayed", products: ProductType[], iProductCheekyDelay: Optional<number> }
      | { state: "arrived", products: ProductType[], destinations: CrateProductDestination[], illegalsHidden: boolean }
      onStateReached: Optional<() => void>,
    }>({
      animation: props.animation,
      propsState: {
        location: props.location,
        crateState: props.contents.state == "open crate" ? "lid opened" : "lid closed",
        crateContents: { state: "none" },
        onStateReached: nullopt,
      },

      getPostStepState({
        step,
        callAllOnCompletes,
        previousState,
      }) {
        if (step.type == "cart motion" && iPlayerToNum(step.iPlayerCart) == iPlayerToNum(props.iPlayerOwner)) {
          return {
            ...previousState,
            location: step.motion == "suspect area to trader supplies" ? "Trader Supplies" : "Suspect Cart Area",
            onStateReached: opt(callAllOnCompletes),
          };

        } else if (step.type == "crate" && iPlayerToNum(step.iPlayerCrate) == iPlayerToNum(props.iPlayerOwner)) {
          return {
            ...previousState,
            crateState: step.animation == "blast lid" ? "lid blasted" : step.animation == "open lid" ? "lid opened" : "lid closed",
            onStateReached: opt(callAllOnCompletes)
          };

        } else if (step.type == "crate contents" && iPlayerToNum(step.iPlayerCrate) == iPlayerToNum(props.iPlayerOwner)) {
          return {
            ...previousState,
            crateContents: {
              products: step.animation.contents.map(p => p.product),
              ...((step.animation.animation == "display contents")
                ? { state: "displayed", iProductCheekyDelay: step.animation.iProductCheekyDelay }
                : {
                  state: "arrived",
                  destinations: step.animation.contents.map(p => p.destination),
                  illegalsHidden: step.animation.illegalsHidden,
                }
              )
            },
            onStateReached: opt(callAllOnCompletes)
          };

        } else {
          return {
            ...previousState,
            onStateReached: nullopt,
          };
        }
      },

      getPostSequenceState({
        previousState,
      }) {
        return {
          ...previousState,
          onStateReached: nullopt,
        };
      },
    })
  );

  return (
    <div {...attrs} style={{ marginTop: props.location == "Suspect Cart Area" ? "70px" : "0px", marginLeft: "30px", marginRight: "30px", ...(attrs['style'] ?? {}) }}>
      <AnimatedCart
        key={`${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_animated_cart`}
        id={getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}
        style={{ opacity: props.active && props.animation.hasValue == false ? 1 : 0, display: "inline-block" }}
        contents={props.contents}
        animation={nullopt}
        officerTools={{ ...props.officerTools, crowbarFullyUsed: false }}
      />
      {
        (props.active && props.animation.hasValue == true)
          ? (
            <FloatingDiv
              usekey={`${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_floating_section_rerender_${renderCount.current}`}
              key={`${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_floating_section_rerender_${renderCount.current}`}
              hidden={!props.active || !props.animation.hasValue}
              animationSteps={
                [
                  {
                    action: "teleport to",
                    targetPosition: {
                      relativeElementId: getStaticCartEleId({ location: preAnimationStepState.location, iPlayerOwner: props.iPlayerOwner })
                    }
                  } as FloatingDivAnimationStep
                ].concat(
                  (preAnimationStepState.location != postAnimationStepState.location)
                    ? [
                      {
                        action: "float to",
                        targetPosition: {
                          relativeElementId: getStaticCartEleId({ location: postAnimationStepState.location, iPlayerOwner: props.iPlayerOwner })
                        },
                        animationDuration: "500ms"
                      },
                      {
                        action: "notify", callback: () => {
                          if (props.active && postAnimationStepState.onStateReached.hasValue == true) postAnimationStepState.onStateReached.value();
                        }
                      }
                    ]
                    : []
                )
              }
            >
              <AnimatedCart
                key={`${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_floating_animated_cart`}
                style={{ display: "inline-block" }}
                contents={
                  props.contents.labeled == false
                    ? props.contents
                    : {
                      ...props.contents,
                      state: preAnimationStepState.crateState == "lid closed" ? "closed crate" : "open crate",
                    }
                }
                animation={
                  preAnimationStepState.crateState == postAnimationStepState.crateState
                    ? nullopt
                    : opt({
                      animation: postAnimationStepState.crateState == "lid blasted" ? "blast lid" : postAnimationStepState.crateState == "lid opened" ? "open lid" : "close lid",
                      onComplete: opt(() => {
                        if (props.active && postAnimationStepState.onStateReached.hasValue == true) postAnimationStepState.onStateReached.value();
                      })
                    })
                }
                officerTools={
                  (preAnimationStepState.crateState == "lid closed" && postAnimationStepState.crateState == "lid blasted")
                    // while lid is blasting make a fully used crowbar present. make non-controllable and we expect no external updates
                    ? {
                      ...props.officerTools,
                      crowbarPresent: true,
                      crowbarFullyUsed: true,
                      controls: { localControllable: false }
                    }
                    : { ...props.officerTools, crowbarFullyUsed: false }
                }
              />
              <span id={`${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_floating_section_product_cart_interior_reference`}
                style={{
                  opacity: 0,
                  position: "absolute",
                  left: "25px",
                  top: "25%",
                }}
              >
                {unknownProductIcon}
              </span>
              <span id={`${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_floating_section_product_cart_opening_reference`}
                style={{
                  opacity: 0,
                  position: "absolute",
                  left: "25px",
                  top: "-25%",
                }}
              >
                {unknownProductIcon}
              </span>
              { // contained crate products
                (() => {
                  const products = (
                    preAnimationStepState.crateContents.state != "none"
                      ? preAnimationStepState.crateContents.products
                      : postAnimationStepState.crateContents.state != "none"
                        ? postAnimationStepState.crateContents.products
                        : []
                  );

                  return products.map((p, i) => (
                    <div key={`${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_product_${i}`}>
                      <span id={`${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_floating_section_product_${i}_display_reference`}
                        style={(() => {
                          const totalArcAngle = (80 + 10 * products.length) * (Math.PI / 180);
                          const arcLengthPerProduct = 25; // (approximate)
                          const radius = (arcLengthPerProduct * products.length) / totalArcAngle;
                          const arcAnglePerProduct = totalArcAngle / products.length;
                          const angle = (Math.PI / 2) - (totalArcAngle / 2) + (arcAnglePerProduct * (products.length - 1 - i + 0.5));
                          return {
                            // contained products are only shown during animation sequences, 
                            // so just always have the FloatingDiv displayed and use this element only as a reference:
                            opacity: 0,
                            position: "absolute",
                            left: `${25 + Math.floor(Math.cos(angle) * radius)}px`,
                            top: `-${20 - (products.length * 3) + Math.floor(Math.sin(angle) * radius)}px`,
                          };
                        })()}
                      >
                        {unknownProductIcon}
                      </span>

                      <FloatingDiv
                        usekey={`${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_product_${i}_floating_section_rerender_${renderCount.current}`}
                        key={`${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_product_${i}_floating_section_rerender_${renderCount.current}`}
                        style={{ zIndex: -4 }}
                        animationSteps={
                          [
                            {
                              action: "teleport to",
                              targetPosition: {
                                relativeElementId:
                                  (() => {
                                    const preStepContents = preAnimationStepState.crateContents;

                                    if (preStepContents.state == "none") {
                                      return `${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_floating_section_product_cart_interior_reference`;
                                    } else if (preStepContents.state == "displayed") {
                                      return `${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_floating_section_product_${i}_display_reference`;
                                    } else { // arrived
                                      const destination = preStepContents.destinations[i];

                                      if (destination === undefined) {
                                        // TODO impossible -- wrap destination into postAnimationStepState.crateContents? (make it have a location per-product or somethin)
                                        console.log(`destination === undefined`);
                                        console.trace();
                                        return "";
                                      } else if (destination.destination == "garbage") {
                                        return "menu_game_working_center_pools_recycle";
                                      } else { // trader
                                        if (iPlayerToNum(destination.iPlayer) == iPlayerToNum(props.iPlayerLocal)) {
                                          return `menu_game_local_supplies_item_icon_${p}`;
                                        } else {
                                          return `menu_game_traders_${iPlayerToNum(destination.iPlayer)}_supplies_item_icon_${getProductInfo(p).legal ? p : "illegal"}`
                                        }
                                      }
                                    }
                                  })()
                              }
                            } as FloatingDivAnimationStep,
                            {
                              action: "wait",
                              delayMs: ((postAnimationStepState.crateContents.state == "displayed") ? 700 : 450) * i + (() => {
                                const postStepContents = postAnimationStepState.crateContents;

                                return (
                                  postStepContents.state == "displayed"
                                  && postStepContents.iProductCheekyDelay.hasValue == true
                                  && i >= postStepContents.iProductCheekyDelay.value)
                                  ? 2200 : 0
                              })(),
                            } satisfies FloatingDivAnimationStep,
                          ].concat(
                            (preAnimationStepState.crateContents.state != postAnimationStepState.crateContents.state)
                              ? (
                                (
                                  (preAnimationStepState.crateContents.state == "none")
                                    ? [
                                      {
                                        action: "float to",
                                        targetPosition: {
                                          relativeElementId: `${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_floating_section_product_cart_opening_reference`
                                        },
                                        animationDuration: "300ms",
                                        timingFunction: "ease-in",
                                      } as FloatingDivAnimationStep
                                    ]
                                    : []
                                ).concat([
                                  {
                                    action: "float to",
                                    targetPosition: {
                                      relativeElementId: (() => {
                                        const postStepContents = postAnimationStepState.crateContents;

                                        if (postStepContents.state == "none") {
                                          return `${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_floating_section_product_cart_interior_reference`;
                                        } else if (postStepContents.state == "displayed") {
                                          return `${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_floating_section_product_${i}_display_reference`;
                                        } else { // arrived
                                          const destination = postStepContents.destinations[i];

                                          if (destination === undefined) {
                                            // TODO impossible -- wrap destination into postAnimationStepState.crateContents? (make it have a location per-product or somethin)
                                            console.log(`destination === undefined`);
                                            console.trace();
                                            return "";
                                          } else if (destination.destination == "garbage") {
                                            return "menu_game_working_center_pools_recycle";
                                          } else { // trader
                                            if (iPlayerToNum(destination.iPlayer) == iPlayerToNum(props.iPlayerLocal)) {
                                              return `menu_game_local_supplies_item_icon_${p}`;
                                            } else {
                                              return `menu_game_traders_${iPlayerToNum(destination.iPlayer)}_supplies_item_icon_${getProductInfo(p).legal ? p : "illegal"}`
                                            }
                                          }
                                        }
                                      })()
                                    },
                                    animationDuration: postAnimationStepState.crateContents.state == "displayed" ? "300ms" : "800ms",
                                    timingFunction: (preAnimationStepState.crateContents.state == "none") ? "ease-out" : "ease-in-out",
                                  } as FloatingDivAnimationStep,
                                  {
                                    action: "notify",
                                    callback: () => {
                                      if (i == products.length - 1 && postAnimationStepState.onStateReached.hasValue == true) postAnimationStepState.onStateReached.value();
                                    }
                                  } as FloatingDivAnimationStep,
                                ])
                              )
                              : []
                          )
                        }
                      >
                        <span>
                          {(() => {
                            const illegalsHidden = (() => {
                              if (getProductInfo(p).legal || postAnimationStepState.crateContents.state != "arrived" || !postAnimationStepState.crateContents.illegalsHidden) {
                                return false;
                              }

                              const destination = postAnimationStepState.crateContents.destinations[i];
                              if (destination === undefined) {
                                // TODO impossible -- wrap destination into postAnimationStepState.crateContents? (make it have a location per-product or somethin)
                                console.log(`destination === undefined`);
                                console.trace();
                                return true;
                              } else if (destination.destination == "garbage") return false;
                              else return iPlayerToNum(destination.iPlayer) != iPlayerToNum(props.iPlayerLocal);
                            })();

                            return illegalsHidden ? illegalProductIcon : getProductInfo(p).icon;
                          })()}
                        </span>
                      </FloatingDiv>
                    </div>
                  ));
                })()
              }
            </FloatingDiv>
          )
          : undefined
      }
    </div>
  );
};

/**
 * (Element) Div of text displaying potential point earnings or losses.
 */
function Earnings(props: {
  earnings: number,
  getTitle: (args: { earningsPhrase: "losses" | "earnings" }) => string
  [otherOptions: string]: unknown
}) {
  const attrs = omitAttrs(['earnings', 'getTitle'], props);

  return (
    <div {...attrs}>
      <span>{props.getTitle({ earningsPhrase: (props.earnings < 0) ? "losses" : "earnings" })}</span>
      <span style={{ color: (props.earnings < 0) ? "red" : (props.earnings > 0) ? "green" : "black" }}>
        {props.earnings}
        {(props.earnings < 0) ? fineIcon : (props.earnings > 0) ? pointIcon : undefined}
      </span>
    </div>
  );

}

/**
 * (Element) Div of a stampable scroll with text - either an entry visa, incident report, or deal payment
 */
function EntryVisa(props: {
  title: string,
  buildVisaBodyEle: (args: {
    paymentsData: {
      givingListEle: React.ReactNode,
      payment: {
        iPlayerGiver: ValidPlayerIndex,
        payment: Payment,
      },
      preAnimationStepPaymentState: "revealed" | "collected" | "distributed" | "not yet revealed",
      postAnimationStepPaymentState: "revealed" | "collected" | "distributed" | "not yet revealed",
    }[],
    buildVisaTextEle: (args: { visaText: string, includesHeader: boolean }) => React.ReactNode,
  }) => React.ReactNode,
  animation: Optional<GameAnimationSequence>,
  officerTools: CartOfficerToolsProps,
  stampIcon: string,
  stamps: NetworkTypes.EntryVisaStamp[],
}) {
  const paymentsMatch = (
    a: { iPlayerGiver: ValidPlayerIndex, payment: Payment },
    b: { iPlayerGiver: ValidPlayerIndex, payment: Payment },
  ) => iPlayerToNum(a.iPlayerGiver) === iPlayerToNum(b.iPlayerGiver);

  const { iGameAnimationStep, gameAnimationStep, preAnimationStepState, postAnimationStepState, postAnimationSequenceState } = (
    useGameAnimationStates<{
      revealedPaymentsStates: {
        payment: {
          iPlayerGiver: ValidPlayerIndex,
          payment: Payment,
        }
        state: "revealed" | "collected" | "distributed",
      }[],
      onStateReached: Optional<() => void>,
    }>({
      animation: props.animation,
      propsState: {
        revealedPaymentsStates: [],
        onStateReached: nullopt,
      },

      getPostStepState({
        step,
        callAllOnCompletes,
        previousState,
      }) {
        if (step.type === "payment") {
          const newRevealedPaymentsStates = previousState.revealedPaymentsStates.shallowCopy();
          const stepPaymentState = (() => {
            const stepPaymentInitialState = {
              payment: {
                iPlayerGiver: step.iPlayerGiver,
                payment: step.payment,
              },
              state: "revealed" as "revealed" | "collected" | "distributed",
            };
            for (let i = 0; i < newRevealedPaymentsStates.length; i++) {
              const paymentState = newRevealedPaymentsStates[i];
              if (paymentState === undefined) continue; // TODO fix this should never happen
              if (paymentsMatch(paymentState.payment, stepPaymentInitialState.payment)) {
                newRevealedPaymentsStates[i] = stepPaymentInitialState;
                return stepPaymentInitialState;
              }
            }
            // else
            newRevealedPaymentsStates.push(stepPaymentInitialState);
            return stepPaymentInitialState;
          })();

          if (step.action === "reveal if not yet revealed") {
            // there are no paymentStates where this has not yet happened. Leave as-is.
          } else if (step.action === "give" && stepPaymentState.state === "revealed") {
            stepPaymentState.state = "collected";
          } else if (step.action === "receive") {
            // there are no paymentStates where this has happened (except distributed so okay to overwrite)
            stepPaymentState.state = "distributed";
          }

          return {
            ...previousState,
            revealedPaymentsStates: newRevealedPaymentsStates,
            onStateReached: opt(callAllOnCompletes),
          };
        } else {
          return {
            ...previousState,
            onStateReached: nullopt,
          };
        }
      },

      getPostSequenceState({ previousState }) {
        return {
          ...previousState,
          onStateReached: nullopt,
        }
      },
    })
  );

  React.useEffect(() => {
    if (
      gameAnimationStep.hasValue === true
      && gameAnimationStep.value.step.type === "payment"
      && gameAnimationStep.value.step.action === "reveal if not yet revealed"
    ) {
      gameAnimationStep.value.onCompleteRegistrations.forEach(c => c());
    }
  }, [iGameAnimationStep]);

  const allPaymentsData = (
    postAnimationSequenceState.revealedPaymentsStates
      .map(finalPaymentState => ({
        payment: finalPaymentState.payment,
        preAnimationStepPaymentState:
          preAnimationStepState.revealedPaymentsStates
            .filter(paymentState => paymentsMatch(paymentState.payment, finalPaymentState.payment))
          [0]
            ?.state
          ?? ("not yet revealed" as "not yet revealed"),
        postAnimationStepPaymentState:
          postAnimationStepState.revealedPaymentsStates
            .filter(paymentState => paymentsMatch(paymentState.payment, finalPaymentState.payment))
          [0]
            ?.state
          ?? ("not yet revealed" as "not yet revealed"),
      }))
      .map(paymentData => ({
        ...paymentData,
        givingListEle: (
          <div>
            {
              [
                {
                  icon: moneyIcon,
                  id: -1,
                  amount: paymentData.payment.payment.money
                }
              ]
                .concat(
                  paymentData.payment.payment.suppliesProducts
                    .map((amount, p) => ({
                      icon: productInfos.get(p).icon,
                      id: p,
                      amount,
                    }))
                    .arr
                )
                .filter(s => s.amount > 0)
                .map((s, i) => (
                  <span key={`menu_game_payment_player_${iPlayerToNum(paymentData.payment.iPlayerGiver)}_item_${s.id}`}>
                    {i == 0 ? undefined : ", "}{s.amount}{" "}
                    <span
                      style={{
                        opacity:
                          (paymentData.preAnimationStepPaymentState === "collected" && paymentData.postAnimationStepPaymentState === "collected")
                            ? 1
                            : 0.3
                      }}
                      id={`menu_game_payment_player_${iPlayerToNum(paymentData.payment.iPlayerGiver)}_item_icon_${s.id}`}
                    >
                      {s.icon}
                    </span>
                  </span>
                ))
            }
          </div>
        )
      }))
  );

  const currentRenderTimeMs = Date.now();

  const stampInitialNetworkState: OfficerToolStampState & { state: "not held" } = {
    offset: {
      x: 0,
      y: -100,
    },
    stamps: [],
    state: "not held",
  };
  const stampUpdateAnimationFunction = "linear" as "linear";

  const stampZoneMaximumY = 15;
  const inStampZone = (offset: { x: number, y: number }) => (
    offset.x >= -30 && offset.x <= 30
    && offset.y >= -30 && offset.y <= stampZoneMaximumY
  );
  const stampMinDurationMs = 500;

  const {
    localData: stampDragData,
    onOfficerControlEvent: onStampOfficerControlEvent,
    onToolMouseDown: onStampMouseDownHandler,
    toolUpdateAnimationDurationMs: stampUpdateAnimationDurationMs,
    onAnimationComplete: onStampAnimationComplete,
  } = (
      useNetworkedOfficerToolState<
        & OfficerToolStampState
        & (
          | { state: "not held" }
          | (
            & (
              | { state: "held" }
              | { state: "stamping", stampingStartTimeMs: number, liftRequestedOffset: Optional<{ x: number, y: number }> }
            )
            & {
              pickupInfo: {
                clientMousePosition: { x: number, y: number },
                offset: { x: number, y: number },
              },
            }
          )
        )
      >({
        propsTools: props.officerTools,
        networkStateToLocalState({ networkState, previousState }) {
          if (networkState.hasValue === true && networkState.value.stamp.hasValue === true) {
            return opt({
              state: {
                offset: networkState.value.stamp.value.offset,
                stamps: networkState.value.stamp.value.stamps,
                ...(
                  // networkStateToLocalState is only used for initial state (which should always be not held)
                  // and for external updates (in which case we're not the officer so mousePickupPosition isn't used)
                  (networkState.value.stamp.value.state === "not held")
                    ? { state: "not held" }
                    : {
                      ...(
                        (networkState.value.stamp.value.state === "stamping")
                          ? { state: "stamping", stampingStartTimeMs: 0, liftRequestedOffset: nullopt }
                          : { state: networkState.value.stamp.value.state }
                      ),
                      pickupInfo: {
                        clientMousePosition: { x: 0, y: 0 },
                        offset: { x: 0, y: 0 }
                      }
                    }
                )
              },
              animateTransition:
                (previousState.hasValue === false)
                  ? "always"
                  : (previousState.value.state === "stamping" || networkState.value.stamp.value.state === "stamping")
                    ? "never"
                    : (
                      previousState.value.offset.x !== networkState.value.stamp.value.offset.x
                      || previousState.value.offset.y !== networkState.value.stamp.value.offset.y
                    )
                      ? "always"
                      : "if existing",
            });
          } else if (props.officerTools.stampPresent) {
            return opt({
              state: stampInitialNetworkState,
              animateTransition: "always",
            });
          } else {
            return nullopt;
          }
        },
        localStateToNetworkStateUpdate(localState) {
          return {
            stamp: opt(localState),
            crowbar: nullopt,
          };
        },

        isStateOfficerControllable(localState) {
          return localState.stamps.length == 0 || (localState.state !== "not held");
        },

        areStatesEqualForRenderAndNetwork(a, b) {
          const stampsZipped = a.stamps.zip(b.stamps);
          return (
            a.offset.x == b.offset.x && a.offset.y == b.offset.y
            && a.state === b.state
            && stampsZipped !== undefined && stampsZipped.every(([as, bs]) => as.x == bs.x && as.y == bs.y)
          );
        },

        getMouseDownState(args) {
          if (args.previousState.state === "not held") {
            const eventTargetSize =
              (args.event.target instanceof Element)
                ? { width: args.event.target.clientWidth, height: args.event.target.clientHeight }
                : { width: 0, height: 0 }; // should never happen
            const offset = {
              x: args.previousState.offset.x + args.event.offsetX - eventTargetSize.width * 0.5,
              y: args.previousState.offset.y + args.event.offsetY - eventTargetSize.height * 0.85,
            };
            return {
              state: {
                ...args.previousState,
                state: "held",
                offset,
                pickupInfo: {
                  clientMousePosition: { x: args.event.clientX, y: args.event.clientY },
                  offset,
                }
              },
              animateTransition: "never",
              sendUpdateNow: true,
            };
          } else if (args.previousState.state === "stamping") {
            // ignore duplicate stamp
            return {
              state: {
                ...args.previousState,
                stopRequested: false,
              },
              animateTransition: "never",
              sendUpdateNow: false,
            };
          } else { // "held"
            const newOffset = {
              x: args.previousState.pickupInfo.offset.x + (args.event.clientX - args.previousState.pickupInfo.clientMousePosition.x),
              y: args.previousState.pickupInfo.offset.y + (args.event.clientY - args.previousState.pickupInfo.clientMousePosition.y),
            };
            if (inStampZone(newOffset)) {
              return {
                state: {
                  offset: newOffset,
                  // sanity check: only allow 20 stamps
                  stamps: args.previousState.stamps.skip(Math.max(0, args.previousState.stamps.length - 19)).concat([newOffset]),
                  state: "stamping",
                  stampingStartTimeMs: args.eventTimeMs,
                  liftRequestedOffset: nullopt,
                  pickupInfo: args.previousState.pickupInfo,
                },
                animateTransition: "never",
                sendUpdateNow: true,
              };
            } else {
              return {
                state: {
                  ...stampInitialNetworkState,
                  stamps: args.previousState.stamps,
                  state: "not held",
                },
                animateTransition: "always",
                sendUpdateNow: true,
              };
            }
          }
        },

        getMouseUpState({ eventTimeMs, previousState, event }) {
          if (previousState.state === "held") {
            // mouse up happened after stamp has just been picked up
            return { state: previousState, animateTransition: "never", sendUpdateNow: false };
          } else if (previousState.state === "not held") {
            // mouse up happened in the middle of stamp being put back
            return {
              state: {
                ...stampInitialNetworkState,
                stamps: previousState.stamps,
                state: "not held",
              },
              animateTransition: "if existing",
              sendUpdateNow: true,
            };
          } else {
            // mouse up to lift from stamp
            const newOffset = {
              x: previousState.pickupInfo.offset.x + (event.clientX - previousState.pickupInfo.clientMousePosition.x),
              y: previousState.pickupInfo.offset.y + (event.clientY - previousState.pickupInfo.clientMousePosition.y),
            };
            return {
              state:
                (eventTimeMs < (previousState.stampingStartTimeMs + stampMinDurationMs))
                  ? {
                    ...previousState,
                    liftRequestedOffset: opt(newOffset),
                  }
                  : {
                    ...previousState,
                    state: "held",
                    offset: newOffset,
                  },
              animateTransition: "never",
              sendUpdateNow: true,
            }
          }
        },

        getMouseMoveState(args) {
          if (args.previousState.state === "not held") {
            // mouse move happened in the middle of stamp being put back
            return {
              state: {
                ...stampInitialNetworkState,
                stamps: args.previousState.stamps,
                state: "not held",
              },
              animateTransition: "if existing",
              sendUpdateNow: true,
            };
          } else {
            const newOffset = {
              x: args.previousState.pickupInfo.offset.x + (args.event.clientX - args.previousState.pickupInfo.clientMousePosition.x),
              y: args.previousState.pickupInfo.offset.y + (args.event.clientY - args.previousState.pickupInfo.clientMousePosition.y),
            };
            if (args.previousState.state === "stamping") {
              // mouse move happened in the middle of stamping
              return {
                state: {
                  ...args.previousState,
                  liftRequestedOffset: optMap(args.previousState.liftRequestedOffset, () => newOffset)
                },
                animateTransition: "if existing",
                sendUpdateNow: false,
              };
            } else {
              // mouse move happened while holding
              return {
                state: {
                  ...args.previousState,
                  offset: newOffset,
                },
                animateTransition: "never",
                sendUpdateNow: false,
              }
            }
          }
        },

        animationFunction: stampUpdateAnimationFunction,
        getInterruptedAnimationState(args) {
          const interruptedOffset = {
            x: args.startState.offset.x + (args.animationProgress * (args.endState.offset.x - args.startState.offset.x)),
            y: args.startState.offset.y + (args.animationProgress * (args.endState.offset.y - args.startState.offset.y)),
          };
          return {
            ...args.endState,
            offset: interruptedOffset,
          };
        },
      })
    );

  React.useEffect(() => {
    const nowMs = Date.now();
    if (stampDragData.hasValue === true
      && stampDragData.value.localState.state === "stamping"
      && nowMs < (stampDragData.value.localState.stampingStartTimeMs + stampMinDurationMs)
      && stampDragData.value.localState.liftRequestedOffset.hasValue === true
    ) {
      const timeout = setTimeout(() => {
        onStampOfficerControlEvent({
          eventTimeMs: nowMs,
          getEventState(currentLocalState) {
            // the above if conditions should still take effect, but we sorta have to pretend like currentLocalState could be different
            if (currentLocalState.state === "stamping") {
              return {
                state: {
                  ...currentLocalState,
                  state: "held",
                  offset:
                    (currentLocalState.liftRequestedOffset.hasValue === true)
                      ? currentLocalState.liftRequestedOffset.value
                      : currentLocalState.offset,
                },
                animateTransition: "never",
                sendUpdateNow: true,
              };
            } else {
              // so this should never happen, but just in case
              return {
                state: currentLocalState,
                animateTransition: "if existing",
                sendUpdateNow: false,
              }
            }
          },
        });
      }, (stampDragData.value.localState.stampingStartTimeMs + stampMinDurationMs - nowMs));
      return (() => { clearTimeout(timeout); });
    }
    return undefined;
  }, [stampDragData]);

  console.log(stampDragData);
  console.log(currentRenderTimeMs);

  const stampStateToStyles = (state:
    & OfficerToolStampState
    & (
      | { state: "not held" }
      | {
        state: "held" | "stamping",
        pickupInfo: {
          clientMousePosition: { x: number, y: number },
          offset: { x: number, y: number },
        },
      }
    )): { stampImg: React.CSSProperties, stampTarget: React.CSSProperties } => {
    return {
      stampImg: {
        left: `${Math.round(state.offset.x)}px`,
        bottom: `${0
          - Math.round(state.offset.y)
          + (state.state === "held" ? 30 : 0)
          }px`,
      },
      stampTarget: {
        left: `${Math.round(state.offset.x)}px`,
        bottom: `${0 - Math.round(state.offset.y)}px`,
      }
    };
  }

  return (
    <Section title={props.title} style={{
      opacity:
        (allPaymentsData.length === 0 || postAnimationStepState.revealedPaymentsStates.length > 0)
          ? 1 : 0
    }}>
      {
        (() => {
          if (allPaymentsData.length <= 2) {
            return (
              <div>
                <div
                  style={{
                    display: "inline-block",
                    width: "100%",
                    textAlign: "center",
                    backgroundImage: `url(${visaScrollImgSrc})`,
                    backgroundSize: "contain",
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                    zIndex: -4,
                  }}>
                  <div style={{ margin: "70px" }}>
                    {
                      props.buildVisaBodyEle({
                        paymentsData: allPaymentsData,
                        buildVisaTextEle({ visaText, includesHeader }) {
                          return (
                            <div>
                              {
                                visaText
                                  .split("\n")
                                  .map((l, i) =>
                                    l.trim() == ""
                                      ? (<div style={{ opacity: 0 }}>~</div>)
                                      : (
                                        <div style={
                                          (i == 0 && includesHeader)
                                            ? {
                                              fontSize: "130%",
                                              fontWeight: "bold",
                                            }
                                            : {}
                                        }>
                                          {l}
                                        </div>)
                                  )
                              }
                            </div>
                          );
                        },
                      })
                    }
                    <div>
                      <div style={{
                        display: "inline-block",
                        verticalAlign: "middle",
                        marginRight: "30px"
                      }}>
                        Duty Officer:
                      </div>
                      <div style={{
                        display: "inline-block",
                        verticalAlign: "middle",
                        fontSize: "200%",
                        borderWidth: "2px",
                        borderStyle: "dashed",
                        borderRadius: "15px",
                        borderColor: "black",
                      }}>
                        <div style={{ margin: "5px", }}>
                          <div style={{
                            opacity: 0,
                          }}>
                            {props.stampIcon}
                          </div>
                        </div>
                        {
                          (() => {
                            const stamps = (
                              (stampDragData.hasValue === true)
                                ? opt(stampDragData.value.localState.stamps)
                                : (props.stamps.length > 0)
                                  ? opt(props.stamps)
                                  : nullopt
                            );
                            return (
                              <div style={{ position: "relative" }}>
                                {
                                  (stamps.hasValue === true)
                                    ? (
                                      stamps.value.map((stamp, iStamp) => (
                                        <div
                                          key={`payment_area_stamp_${iStamp}`}
                                          style={{
                                            margin: "5px",
                                            position: "absolute",
                                            left: `${0 + stamp.x}px`,
                                            bottom: `${0 - stamp.y}px`,
                                            zIndex: iStamp,
                                          }}
                                        >
                                          {props.stampIcon}
                                        </div>
                                      ))
                                    )
                                    : undefined
                                }
                                <div // stamper target
                                  draggable={false} // just prevents mouse events from being suppressed by drag events
                                  onMouseDown={(event) => { onStampMouseDownHandler(event.nativeEvent); }}
                                  style={{
                                    margin: "5px",
                                    position: "absolute",
                                    ...(
                                      (stampDragData.hasValue === true)
                                        ? stampStateToStyles(stampDragData.value.localState).stampTarget
                                        : {}
                                    ),
                                    zIndex: 3 + (stamps.hasValue === true ? stamps.value.length : 0),
                                    cursor: props.officerTools.controls.localControllable === true ? "pointer" : "auto",
                                    opacity:
                                      (
                                        props.officerTools.controls.localControllable === true
                                        && stampDragData.hasValue === true
                                        && stampDragData.value.localState.state === "held"
                                        && inStampZone(stampDragData.value.localState.offset)
                                      )
                                        ? 0.3 : 0,
                                  }}
                                >
                                  {props.stampIcon}
                                </div>
                                <img // stamper img
                                  src={stampImgSrc}
                                  draggable={false} // just prevents mouse events from being suppressed by drag events
                                  onMouseDown={(event) => { onStampMouseDownHandler(event.nativeEvent); }}
                                  style={{
                                    opacity: stampDragData.hasValue === true ? 1 : 0,
                                    position: "absolute",
                                    ...(
                                      (stampDragData.hasValue === true && stampDragData.value.animation.hasValue === false)
                                        ? stampStateToStyles(stampDragData.value.localState).stampImg
                                        : {}
                                    ),
                                    width: "100%",
                                    zIndex: 4 + (stamps.hasValue === true ? stamps.value.length : 0),
                                    cursor: props.officerTools.controls.localControllable === true ? "pointer" : "auto",
                                    animationName:
                                      (stampDragData.hasValue === true && stampDragData.value.animation.hasValue === true)
                                        ? (
                                          `payment_stamp_animation`
                                          + `_${Math.round(stampDragData.value.localState.offset.x)}_${Math.round(stampDragData.value.localState.offset.y)}_${stampDragData.value.localState.state.replace(" ", "")}`
                                          + `_${Math.round(stampDragData.value.animation.value.destLocalState.offset.x)}_${Math.round(stampDragData.value.animation.value.destLocalState.offset.y)}_${stampDragData.value.animation.value.destLocalState.state.replace(" ", "")}`
                                        )
                                        : undefined,
                                    animationDuration: `${stampUpdateAnimationDurationMs}ms`,
                                    animationIterationCount: 1,
                                    animationTimingFunction: stampUpdateAnimationFunction,
                                    animationFillMode: "both",
                                    animationDirection: "normal",
                                    animationDelay: `${Math.floor(
                                      (stampDragData.hasValue == false || stampDragData.value.animation.hasValue == false)
                                        ? 0
                                        : (-Math.min( // negative delay starts animation in middle of animation
                                          (currentRenderTimeMs - stampDragData.value.animation.value.animationStartTimeMs),
                                          stampUpdateAnimationDurationMs
                                        ))
                                    )}ms`,
                                  }}
                                  onAnimationEnd={onStampAnimationComplete}
                                />
                                { // stamp animation Keyframes
                                  (stampDragData.hasValue == true && stampDragData.value.animation.hasValue == true)
                                    ? (
                                      <Keyframes
                                        name={
                                          `payment_stamp_animation`
                                          + `_${Math.round(stampDragData.value.localState.offset.x)}_${Math.round(stampDragData.value.localState.offset.y)}_${stampDragData.value.localState.state.replace(" ", "")}`
                                          + `_${Math.round(stampDragData.value.animation.value.destLocalState.offset.x)}_${Math.round(stampDragData.value.animation.value.destLocalState.offset.y)}_${stampDragData.value.animation.value.destLocalState.state.replace(" ", "")}`
                                        }
                                        from={stampStateToStyles(stampDragData.value.localState).stampImg}
                                        to={stampStateToStyles(stampDragData.value.animation.value.destLocalState).stampImg}
                                      />
                                    )
                                    : undefined
                                }
                              </div>
                            );
                          })()
                        }
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          } else {
            // this case should not be used yet -- just a temporary placeholder
            return (
              <div>
                {
                  allPaymentsData
                    .map((paymentData) => {
                      return (
                        <Section
                          key={`menu_game_payment_area_${iPlayerToNum(paymentData.payment.iPlayerGiver)}`}
                          title={`Player ${iPlayerToNum(paymentData.payment.iPlayerGiver)} pays:`}
                          style={{
                            opacity:
                              (paymentData.preAnimationStepPaymentState === "not yet revealed" && paymentData.postAnimationStepPaymentState === "not yet revealed")
                                ? 0
                                : 1
                          }}
                        >
                          {paymentData.givingListEle}
                        </Section>
                      );
                    })
                }
              </div>
            );
          }
        })()
      }
    </Section>
  );
}

export default function MenuGame(props: MenuGameProps) {
  const iPlayerLocal = props.clients.map((c, i) => { return { ...c, clientIndex: i }; }).arr.filter(c => c.clientId == props.localInfo.clientId)[0]?.clientIndex;
  if (iPlayerLocal === undefined) {
    const err = `Local clientId (${props.localInfo.clientId}) was not found in MenuGame props.clients: ${JSON.stringify(props.clients)}`;
    console.log(err);
    console.trace();
    props.onClose({ warning: err });
    return (<div>An error occurred.</div>);
  }

  const toSequentialTraderOrderingRaw = (args: { iPlayer: ValidPlayerIndex, iPlayerOfficer: ValidPlayerIndex }) => (iPlayerToNum(args.iPlayer) + props.clients.length - iPlayerToNum(args.iPlayerOfficer) - 1) % props.clients.length;

  const renderCount = React.useRef(0);
  React.useEffect(() => { renderCount.current++; });

  function produceError(err: any) {
    props.onClose({ warning: err });
  }

  const defaultWebSocketErrorHandlers: WebSocketHandlers = {
    onclose: (event) => {
      console.log("Connection closed.");
      console.log(event);
      produceError("Connection closed unexpectedly.");
    },
    onerror: (event) => {
      console.log("Connection errored:");
      console.log(event);
      produceError("Connection closed unexpectedly.");
    },
  };

  function handleRedundantWELCOMEMessage(rawMessage: string) {
    produceError(`Received redundant WELCOME message: ${rawMessage}`);
  }

  const [clientGameState, setClientGameState] = React.useState<ClientGameState>(() => {
    if (!(props.clients.arr.length == 3 || props.clients.arr.length == 4 || props.clients.arr.length == 5 || props.clients.arr.length == 6)) {
      return { state: "GameEnd", finalTraderSupplies: generateInitialPersistentGameState(props.settings, props.clients).traderSupplies };
    }
    return { state: "Setup" };
  });

  //console.log(JSON.stringify(clientGameState));

  const serverGameState: ServerGameState = (() => {
    switch (clientGameState.state) {
      case "Setup":
        // this should never happen
        return { state: "GameEnd", finalTraderSupplies: generateInitialPersistentGameState(props.settings, props.clients).traderSupplies };

      case "StrategicSwapPack":
      case "SimpleSwapPack":
        return {
          ...(
            (clientGameState.state === "StrategicSwapPack")
              ? {
                state: "StrategicSwapPack",
                iPlayerActiveSwapTrader: clientGameState.localActiveSwapTrader == true ? opt(iPlayerLocal) : clientGameState.iPlayerActiveSwapTrader,
              }
              : {
                state: "SimpleSwapPack",
                tradersSwapping: (
                  clientGameState.otherTradersSwapping.shallowCopy()
                    .set(iPlayerLocal, clientGameState.localOfficer === false && clientGameState.localActiveSwapTrader === true)
                )
              }
          ),
          round: clientGameState.round,
          communityPools: clientGameState.communityPools,
          traderSupplies: clientGameState.traderSupplies,
          counters: clientGameState.counters,
          iPlayerOfficer: clientGameState.localOfficer == true ? iPlayerLocal : clientGameState.iPlayerOfficer,
          cartStates: (
            clientGameState.otherCartStates.shallowCopy()
              .set(iPlayerLocal,
                (clientGameState.localOfficer === true || clientGameState.localActiveSwapTrader === true || clientGameState.localState !== "done")
                  ? { packed: false }
                  : { packed: true, cart: clientGameState.localCart }
              )),
        };

      case "CustomsIntro":
        return {
          state: "CustomsIntro",
          round: clientGameState.round,
          communityPools: clientGameState.communityPools,
          traderSupplies: clientGameState.traderSupplies,
          counters: clientGameState.counters,
          iPlayerOfficer: clientGameState.localOfficer == true ? iPlayerLocal : clientGameState.iPlayerOfficer,
          cartStates: clientGameState.cartStates,
          iPlayerActiveTrader: clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader,
        };

      case "Customs":
        return {
          state: "Customs",
          round: clientGameState.round,
          communityPools: clientGameState.communityPools,
          traderSupplies: clientGameState.traderSupplies,
          counters: clientGameState.counters,
          iPlayerOfficer: clientGameState.localOfficer == true ? iPlayerLocal : clientGameState.iPlayerOfficer,
          cartStates: clientGameState.cartStates,
          ...((clientGameState.customsState == "ready")
            ? { customsState: "ready" }
            : ((clientGameState.customsState == "resolving")
              ? {
                customsState: "resolving",
                iPlayerActiveTrader: clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader,
                result: (
                  (clientGameState.result.result == "ignored for deal")
                    ? {
                      result: "ignored for deal",
                      deal: clientGameState.result.deal,
                      dealProposedByOfficer: clientGameState.result.dealProposedByOfficer,
                      resultState: clientGameState.result.resultState,
                    }
                    : (clientGameState.result.result == "searched")
                      ? {
                        result: "searched",
                        iProductCheekyDelay: clientGameState.result.iProductCheekyDelay,
                        resultState: clientGameState.result.resultState,
                      }
                      : { result: "ignored", resultState: clientGameState.result.resultState }
                )
              }
              : {
                customsState: "interrogating",
                iPlayerActiveTrader: clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader,
                proposedDeal: clientGameState.proposedDeal,
                crowbarSelected: clientGameState.crowbarSelected,
                entryVisaVisible: clientGameState.entryVisaVisible,
              }
            )
          )
        };

      case "Refresh":
        return {
          state: "Refresh",
          round: clientGameState.round,
          communityPools: clientGameState.communityPools,
          traderSupplies: clientGameState.traderSupplies,
          counters: clientGameState.counters,
          iPlayerOfficer: clientGameState.localOfficer == true ? iPlayerLocal : clientGameState.iPlayerOfficer,
        };

      case "GameEnd":
        return {
          state: "GameEnd",
          finalTraderSupplies: clientGameState.finalTraderSupplies,
        };
    }
  })();

  const clientSendClientEventToServer = function (event: NetworkTypes.ClientEvent) {
    if (props.hostInfo.localHost == true) {
      serverHandleReceivedClientEvent(event);
    } else {
      props.ws.ws.send(`MSG|${props.hostInfo.hostClientId}|${event.type}|${JSON.stringify(event.data)}`);
    }
  }

  const toolsStateRef = React.useRef<NetworkTypes.OfficerToolsState>({ crowbar: nullopt, stamp: nullopt });
  const onExternalOfficerToolUpdateRegistrations: Optional<(event: { newToolsState: NetworkTypes.OfficerToolsState }) => void>[] = [];
  //const onInternalOfficerToolUpdateRegistrations: Optional<(event: { update: NetworkTypes.ServerOfficerToolUpdateEventData }) => void>[] = [];
  const clientHandleReceivedServerEvent = function (event: NetworkTypes.ServerEvent) {
    //console.log(event);
    const hostClientId = props.hostInfo.localHost == true ? props.localInfo.clientId : props.hostInfo.hostClientId;
    switch (event.type) {
      case NetworkTypes.ServerEventType.WELCOME:
      case NetworkTypes.ServerEventType.NOTWELCOME:
      case NetworkTypes.ServerEventType.CLIENT_JOINED:
      case NetworkTypes.ServerEventType.START_GAME:
        produceError(`Received unexpected lobby event: ${event}`);
        break;

      case NetworkTypes.ServerEventType.CLIENT_LEFT:
        if (!props.clients.arr.some(x => x.clientId == event.data.clientId)
          || event.data.clientId == props.localInfo.clientId) {
          produceError(`CLIENT_LEFT on nonexistent other client ${event.data.clientId}`);
        }
        if (event.data.clientId == hostClientId) {
          // host cannot be migrated yet
          produceError("Host disconnected.");
        };
        // ignore non-host leavers
        break;

      case NetworkTypes.ServerEventType.STATE_UPDATE: {
        if (clientGameState.state === "Customs"
          && clientGameState.customsState != "ready"
          && !(
            event.data.state.state === "Customs"
            && event.data.state.customsState != "ready"
          )
        ) {
          // reset tools
          toolsStateRef.current = {
            crowbar: nullopt,
            stamp: nullopt,
          };
        }

        // convert [new server state + current client state] to new client state
        switch (event.data.state.state) {
          case "StrategicSwapPack":
          case "SimpleSwapPack": {
            const eventTraderSupplies = (() => {
              const supplies = event.data.state.traderSupplies.everyTransform(s => {
                const shopProductCounts = ProductArray.tryNewArray(s.shopProductCounts);
                if (shopProductCounts.hasValue === false) return nullopt;
                return opt({ ...s, shopProductCounts: shopProductCounts.value });
              });
              if (supplies.hasValue === false) return nullopt;
              return props.clients.tryNewPlayerArray(supplies.value);
            })();
            const eventIPlayerOfficer = props.clients.validateIndex(event.data.state.iPlayerOfficer);
            const eventModeSpecificData: Optional<
              | { state: "StrategicSwapPack", iPlayerActiveSwapTrader: Optional<ValidatedPlayerIndex> }
              | { state: "SimpleSwapPack", tradersSwapping: PlayerArray<boolean> }
            > = (
                (event.data.state.state == "StrategicSwapPack")
                  ? optMap(
                    (event.data.state.iPlayerActiveSwapTrader.hasValue === true)
                      ? optMap(props.clients.validateIndex(event.data.state.iPlayerActiveSwapTrader.value), (i): Optional<ValidatedPlayerIndex> => opt(i))
                      : opt(nullopt),
                    iPlayerActiveSwapTrader => ({ state: "StrategicSwapPack", iPlayerActiveSwapTrader })
                  )
                  : optMap(
                    props.clients.tryNewPlayerArray(event.data.state.tradersSwapping),
                    tradersSwapping => ({ state: "SimpleSwapPack", tradersSwapping })
                  )
              );
            const eventCartStates = props.clients.tryNewPlayerArray(event.data.state.cartStates);
            if (eventTraderSupplies.hasValue === false
              || eventIPlayerOfficer.hasValue === false
              || eventModeSpecificData.hasValue === false
              || eventCartStates.hasValue === false) {
              console.log(`Received bad STATE_UPDATE: ${JSON.stringify(event)}`);
              break;
            }

            if (eventModeSpecificData.value.state === "StrategicSwapPack") {
              setClientGameState({
                state: "StrategicSwapPack",
                round: event.data.state.round,
                communityPools: event.data.state.communityPools,
                traderSupplies: eventTraderSupplies.value,
                counters: event.data.state.counters,
                otherCartStates: eventCartStates.value,
                ...(
                  (iPlayerToNum(iPlayerLocal) == iPlayerToNum(eventIPlayerOfficer.value))
                    ? { localOfficer: true, localActiveSwapTrader: false, iPlayerActiveSwapTrader: eventModeSpecificData.value.iPlayerActiveSwapTrader }
                    : {
                      localOfficer: false,
                      iPlayerOfficer: eventIPlayerOfficer.value,
                      ...(
                        (
                          eventModeSpecificData.value.iPlayerActiveSwapTrader.hasValue === true
                          && iPlayerToNum(iPlayerLocal) == iPlayerToNum(eventModeSpecificData.value.iPlayerActiveSwapTrader.value)
                        )
                          ? { localActiveSwapTrader: true }
                          : {
                            localActiveSwapTrader: false,
                            iPlayerActiveSwapTrader: eventModeSpecificData.value.iPlayerActiveSwapTrader,
                            ...((() => {
                              const localCart = eventCartStates.value.get(iPlayerLocal);

                              if (eventModeSpecificData.value.iPlayerActiveSwapTrader.hasValue === true
                                && (
                                  toSequentialTraderOrderingRaw({ iPlayer: eventModeSpecificData.value.iPlayerActiveSwapTrader.value, iPlayerOfficer: eventIPlayerOfficer.value })
                                  < toSequentialTraderOrderingRaw({ iPlayer: iPlayerLocal, iPlayerOfficer: eventIPlayerOfficer.value })
                                )
                              ) {
                                return {
                                  localState: "waiting",
                                };
                              } else if (localCart.packed == true) {
                                return {
                                  localState: "done",
                                  localCart: localCart.cart
                                };
                              } else if (clientGameState.state == "StrategicSwapPack" && clientGameState.localOfficer == false && clientGameState.localActiveSwapTrader == false && clientGameState.localState == "packing") {
                                return {
                                  localState: "packing",
                                  selectedReadyPoolProductsForPacking: clientGameState.selectedReadyPoolProductsForPacking,
                                  claimedProductType: clientGameState.claimedProductType,
                                  claimMessage: clientGameState.claimMessage
                                };
                              } else {
                                return {
                                  localState: "packing",
                                  selectedReadyPoolProductsForPacking: Array(readyPoolSize).fill(false),
                                  claimedProductType: { hasValue: false },
                                  claimMessage: ""
                                };
                              }
                            })())
                          }
                      )
                    }
                ),
              });
            } else {
              setClientGameState({
                state: "SimpleSwapPack",
                round: event.data.state.round,
                communityPools: event.data.state.communityPools,
                traderSupplies: eventTraderSupplies.value,
                counters: event.data.state.counters,
                otherCartStates: eventCartStates.value,
                otherTradersSwapping: eventModeSpecificData.value.tradersSwapping.shallowCopy(),
                ...(
                  (iPlayerToNum(iPlayerLocal) == iPlayerToNum(eventIPlayerOfficer.value))
                    ? { localOfficer: true, localActiveSwapTrader: false }
                    : {
                      localOfficer: false,
                      iPlayerOfficer: eventIPlayerOfficer.value,
                      ...(
                        (eventModeSpecificData.value.tradersSwapping.get(iPlayerLocal))
                          ? { localActiveSwapTrader: true }
                          : {
                            localActiveSwapTrader: false,
                            ...((() => {
                              const localCart = eventCartStates.value.get(iPlayerLocal);

                              if (localCart.packed == true) {
                                return {
                                  localState: "done",
                                  localCart: localCart.cart
                                };
                              } else if (clientGameState.state == "SimpleSwapPack" && clientGameState.localOfficer == false && clientGameState.localActiveSwapTrader == false && clientGameState.localState == "packing") {
                                return {
                                  localState: "packing",
                                  selectedReadyPoolProductsForPacking: clientGameState.selectedReadyPoolProductsForPacking,
                                  claimedProductType: clientGameState.claimedProductType,
                                  claimMessage: clientGameState.claimMessage
                                };
                              } else {
                                return {
                                  localState: "packing",
                                  selectedReadyPoolProductsForPacking: Array(readyPoolSize).fill(false),
                                  claimedProductType: { hasValue: false },
                                  claimMessage: ""
                                };
                              }
                            })())
                          }
                      )
                    }
                ),
              });
            }
          } break;

          case "CustomsIntro": {
            const eventTraderSupplies = (() => {
              const supplies = event.data.state.traderSupplies.everyTransform(s => {
                const shopProductCounts = ProductArray.tryNewArray(s.shopProductCounts);
                if (shopProductCounts.hasValue === false) return nullopt;
                return opt({ ...s, shopProductCounts: shopProductCounts.value });
              });
              if (supplies.hasValue === false) return nullopt;
              return props.clients.tryNewPlayerArray(supplies.value);
            })();
            const eventCartStates = props.clients.tryNewPlayerArray(event.data.state.cartStates);
            const eventIPlayerOfficer = props.clients.validateIndex(event.data.state.iPlayerOfficer);
            const eventIPlayerActiveTrader = props.clients.validateIndex(event.data.state.iPlayerActiveTrader);
            if (eventTraderSupplies.hasValue === false || eventCartStates.hasValue === false || eventIPlayerOfficer.hasValue === false || eventIPlayerActiveTrader.hasValue === false) {
              console.log(`Received bad STATE_UPDATE: ${JSON.stringify(event)}`);
              break;
            }
            setClientGameState({
              state: "CustomsIntro",
              round: event.data.state.round,
              communityPools: event.data.state.communityPools,
              traderSupplies: eventTraderSupplies.value,
              counters: event.data.state.counters,
              cartStates: eventCartStates.value,
              ...((iPlayerToNum(iPlayerLocal) == iPlayerToNum(eventIPlayerOfficer.value))
                ? { localOfficer: true, localActiveTrader: false, iPlayerActiveTrader: eventIPlayerActiveTrader.value }
                : {
                  localOfficer: false,
                  iPlayerOfficer: eventIPlayerOfficer.value,
                  ...((iPlayerToNum(iPlayerLocal) == iPlayerToNum(eventIPlayerActiveTrader.value))
                    ? { localActiveTrader: true }
                    : { localActiveTrader: false, iPlayerActiveTrader: eventIPlayerActiveTrader.value }
                  )
                }
              ),
              introState:
                (
                  clientGameState.state == "CustomsIntro"
                  && (
                    (clientGameState.localActiveTrader == true && iPlayerToNum(eventIPlayerActiveTrader.value) == iPlayerToNum(iPlayerLocal))
                    || (clientGameState.localActiveTrader == false && iPlayerToNum(clientGameState.iPlayerActiveTrader) == iPlayerToNum(eventIPlayerActiveTrader.value))
                  )
                )
                  ? clientGameState.introState
                  : "animating"
            });
          } break;

          case "Customs": {
            const eventTraderSupplies = (() => {
              const supplies = event.data.state.traderSupplies.everyTransform(s => {
                const shopProductCounts = ProductArray.tryNewArray(s.shopProductCounts);
                if (shopProductCounts.hasValue === false) return nullopt;
                return opt({ ...s, shopProductCounts: shopProductCounts.value });
              });
              if (supplies.hasValue === false) return nullopt;
              return props.clients.tryNewPlayerArray(supplies.value);
            })();
            const eventCartStates = props.clients.tryNewPlayerArray(event.data.state.cartStates);
            const eventIPlayerOfficer = props.clients.validateIndex(event.data.state.iPlayerOfficer);
            // TODO: better approach is convert SerializableServerGameState to ServerGameState so we don't need to use this fake 0 value here (that is unused since ready doesn't use this)
            const eventIPlayerActiveTrader = props.clients.validateIndex(event.data.state.customsState === "ready" ? 0 : event.data.state.iPlayerActiveTrader);
            if (eventTraderSupplies.hasValue === false || eventCartStates.hasValue === false || eventIPlayerOfficer.hasValue === false || eventIPlayerActiveTrader.hasValue === false) {
              console.log(`Received bad STATE_UPDATE: ${JSON.stringify(event)}`);
              break;
            }

            const localWipDeal: Optional<IgnoreDeal> =
              (clientGameState.state == "Customs"
                && clientGameState.customsState == "interrogating"
                && (clientGameState.localOfficer || clientGameState.localActiveTrader))
                ? clientGameState.localWipDeal
                : nullopt;

            setClientGameState({
              state: "Customs",
              round: event.data.state.round,
              communityPools: event.data.state.communityPools,
              traderSupplies: eventTraderSupplies.value,
              counters: event.data.state.counters,
              cartStates: eventCartStates.value,
              ...(() => {
                switch (event.data.state.customsState) {
                  case "ready":
                    return {
                      customsState: "ready",
                      ...((iPlayerToNum(iPlayerLocal) == iPlayerToNum(eventIPlayerOfficer.value))
                        ? { localOfficer: true }
                        : {
                          localOfficer: false,
                          iPlayerOfficer: eventIPlayerOfficer.value,
                        }
                      ),
                      readyState: (() => {
                        if (clientGameState.state == "Customs" && clientGameState.customsState == "ready") {
                          return clientGameState.readyState;
                        } else if (
                          (clientGameState.state == "Customs" && clientGameState.customsState == "interrogating")
                          || clientGameState.state == "CustomsIntro"
                        ) {
                          return {
                            state: "transitioning",
                            iPlayerExitingCart: (clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader)
                          }
                        } else {
                          return { state: "ready" };
                        }
                      })(),
                    };
                  case "interrogating":
                    return {
                      customsState: "interrogating",
                      interrogatingState:
                        (clientGameState.state == "Customs" && clientGameState.customsState == "interrogating")
                          ? clientGameState.interrogatingState
                          : "cart entering",
                      proposedDeal: optMap(event.data.state.proposedDeal, (proposedDealVal) => ({
                        officerGives: {
                          money: proposedDealVal.officerGives.money,
                          suppliesProducts: (() => {
                            const arr = ProductArray.tryNewArray(proposedDealVal.officerGives.suppliesProducts);
                            if (arr.hasValue === false) {
                              // TODO move this up to the other checks
                              console.log(`Received bad STATE_UPDATE: ${JSON.stringify(event)}`);
                              return productInfos.map(() => 0);
                            }
                            return arr.value;
                          })(),
                        },
                        traderGives: {
                          money: proposedDealVal.traderGives.money,
                          suppliesProducts: (() => {
                            const arr = ProductArray.tryNewArray(proposedDealVal.traderGives.suppliesProducts);
                            if (arr.hasValue === false) {
                              // TODO move this up to the other checks
                              console.log(`Received bad STATE_UPDATE: ${JSON.stringify(event)}`);
                              return productInfos.map(() => 0);
                            }
                            return arr.value;
                          })(),
                        },
                        message: proposedDealVal.message,
                        waitingOnOfficer: proposedDealVal.waitingOnOfficer,
                      })),
                      crowbarSelected: event.data.state.crowbarSelected,
                      entryVisaVisible: event.data.state.entryVisaVisible,
                      ...(
                        (iPlayerToNum(iPlayerLocal) == iPlayerToNum(eventIPlayerOfficer.value))
                          ? {
                            localOfficer: true,
                            localActiveTrader: false,
                            iPlayerActiveTrader: eventIPlayerActiveTrader.value,
                            localWipDeal
                          }
                          : ((iPlayerToNum(iPlayerLocal) == iPlayerToNum(eventIPlayerActiveTrader.value))
                            ? {
                              localOfficer: false,
                              iPlayerOfficer: eventIPlayerOfficer.value,
                              localActiveTrader: true,
                              localWipDeal
                            }
                            : {
                              localOfficer: false,
                              iPlayerOfficer: eventIPlayerOfficer.value,
                              localActiveTrader: false,
                              iPlayerActiveTrader: eventIPlayerActiveTrader.value
                            }
                          )
                      ),
                    };
                  case "resolving":
                    // Server isn't supposed to send a new 'resolving' state update during the middle of 'resolving' state.
                    // To play it safe (and because it's simple), we just always assume we're starting from scratch here, 
                    // which will just restart the 'resolving' client state if this unexpected event somehow occurs.
                    return {
                      customsState: "resolving",
                      ...((iPlayerToNum(iPlayerLocal) == iPlayerToNum(eventIPlayerOfficer.value))
                        ? { localOfficer: true, localActiveTrader: false, iPlayerActiveTrader: eventIPlayerActiveTrader.value, }
                        : {
                          localOfficer: false, iPlayerOfficer: eventIPlayerOfficer.value,
                          ...((iPlayerToNum(eventIPlayerActiveTrader.value) == iPlayerToNum(iPlayerLocal))
                            ? { localActiveTrader: true }
                            : { localActiveTrader: false, iPlayerActiveTrader: eventIPlayerActiveTrader.value }
                          )
                        }
                      ),
                      wipTraderSupplies: eventTraderSupplies.value.shallowCopy(),
                      result: (
                        (event.data.state.result.result === "ignored for deal")
                          ? {
                            result: "ignored for deal",
                            deal: {
                              officerGives: {
                                money: event.data.state.result.deal.officerGives.money,
                                suppliesProducts: (() => {
                                  const arr = ProductArray.tryNewArray(event.data.state.result.deal.officerGives.suppliesProducts);
                                  if (arr.hasValue === false) {
                                    // TODO move this up to the other checks
                                    console.log(`Received bad STATE_UPDATE: ${JSON.stringify(event)}`);
                                    return productInfos.map(() => 0);
                                  }
                                  return arr.value;
                                })(),
                              },
                              traderGives: {
                                money: event.data.state.result.deal.traderGives.money,
                                suppliesProducts: (() => {
                                  const arr = ProductArray.tryNewArray(event.data.state.result.deal.traderGives.suppliesProducts);
                                  if (arr.hasValue === false) {
                                    // TODO move this up to the other checks
                                    console.log(`Received bad STATE_UPDATE: ${JSON.stringify(event)}`);
                                    return productInfos.map(() => 0);
                                  }
                                  return arr.value;
                                })(),
                              },
                              message: event.data.state.result.deal.message,
                            },
                            dealProposedByOfficer: event.data.state.result.dealProposedByOfficer,
                            resultState: event.data.state.result.resultState,
                          }
                          : event.data.state.result
                      ),
                    };
                }
              })()
            });
          } break;

          case "Refresh": {
            const eventTraderSupplies = (() => {
              const supplies = event.data.state.traderSupplies.everyTransform(s => {
                const shopProductCounts = ProductArray.tryNewArray(s.shopProductCounts);
                if (shopProductCounts.hasValue === false) return nullopt;
                return opt({ ...s, shopProductCounts: shopProductCounts.value });
              });
              if (supplies.hasValue === false) return nullopt;
              return props.clients.tryNewPlayerArray(supplies.value);
            })();
            const eventIPlayerOfficer = props.clients.validateIndex(event.data.state.iPlayerOfficer);
            if (eventTraderSupplies.hasValue === false || eventIPlayerOfficer.hasValue === false) {
              console.log(`Received bad STATE_UPDATE: ${JSON.stringify(event)}`);
              break;
            }

            setClientGameState({
              state: "Refresh",
              round: event.data.state.round,
              communityPools: event.data.state.communityPools,
              traderSupplies: eventTraderSupplies.value,
              counters: event.data.state.counters,
              ...((iPlayerToNum(iPlayerLocal) == iPlayerToNum(eventIPlayerOfficer.value))
                ? { localOfficer: true }
                : { localOfficer: false, iPlayerOfficer: eventIPlayerOfficer.value }
              ),
            });
          } break;

          case "GameEnd": {
            const eventFinalTraderSupplies = (() => {
              const supplies = event.data.state.finalTraderSupplies.everyTransform(s => {
                const shopProductCounts = ProductArray.tryNewArray(s.shopProductCounts);
                if (shopProductCounts.hasValue === false) return nullopt;
                return opt({ ...s, shopProductCounts: shopProductCounts.value });
              });
              if (supplies.hasValue === false) return nullopt;
              return props.clients.tryNewPlayerArray(supplies.value);
            })();
            if (eventFinalTraderSupplies.hasValue === false) {
              console.log(`Received bad STATE_UPDATE: ${JSON.stringify(event)}`);
              break;
            }
            setClientGameState({
              state: "GameEnd",
              finalTraderSupplies: eventFinalTraderSupplies.value,
            });
          } break;
        }
      } break;

      case NetworkTypes.ServerEventType.OFFICER_TOOL_UPDATE: {
        if (event.data.toolsUpdates.crowbar.hasValue) {
          toolsStateRef.current = { ...toolsStateRef.current, crowbar: event.data.toolsUpdates.crowbar }
        }
        if (event.data.toolsUpdates.stamp.hasValue) {
          toolsStateRef.current = { ...toolsStateRef.current, stamp: event.data.toolsUpdates.stamp }
        }
        onExternalOfficerToolUpdateRegistrations.forEach(c => {
          if (c.hasValue == true) c.value({
            newToolsState: toolsStateRef.current
          })
        });
      } break;
    }
  }

  const serverHandleReceivedClientEvent = function (event: NetworkTypes.ClientEvent) {
    switch (event.type) {
      case NetworkTypes.ClientEventType.IDENTIFY:
        // unexpected. ignore? TODO
        break;

      case NetworkTypes.ClientEventType.SWAP_SUPPLY_CONTRACTS: {
        const iPlayerEvent = props.clients.map((c, i) => { return { ...c, clientIndex: i }; }).arr.filter(c => c.clientId == event.data.sourceClientId)[0]?.clientIndex;
        if (iPlayerEvent === undefined) {
          console.log(`Received bad PACK_CART client event: ${JSON.stringify(event)}`);
          console.trace();
          break;
        }
        if ((
          (
            serverGameState.state === "StrategicSwapPack"
            && serverGameState.iPlayerActiveSwapTrader.hasValue === true
            && props.clients.get(serverGameState.iPlayerActiveSwapTrader.value).clientId == event.data.sourceClientId
          )
          || (
            serverGameState.state === "SimpleSwapPack"
            && iPlayerToNum(iPlayerEvent) !== iPlayerToNum(serverGameState.iPlayerOfficer)
            && serverGameState.tradersSwapping.get(iPlayerEvent)
          ))
        ) {
          const nextState: Optional<SerializableServerGameState> = (() => {
            const newPools: CommunityContractPools = {
              generalPoolContractCounts: serverGameState.communityPools.generalPoolContractCounts.shallowCopy(),
              recyclePoolsContracts: serverGameState.communityPools.recyclePoolsContracts.map(p => p.shallowCopy()),
            };
            const readyPoolRecycling =
              serverGameState.traderSupplies.get(iPlayerEvent).readyPool
                .zip(event.data.recycled);
            const recyclePoolTaking = event.data.took.recycledPools.zip(newPools.recyclePoolsContracts);
            if (readyPoolRecycling === undefined
              || recyclePoolTaking === undefined
              || (
                event.data.recycled.filter(r => r).length
                != (
                  event.data.took.recycledPools.reduce((a, b) => a + b)
                  + event.data.took.generalPool
                )
              )
            ) {
              console.log(`Received bad SWAP_SUPPLY_CONTRACTS client event: ${JSON.stringify(event)}`);
              console.trace();
              return nullopt;
            }
            const [readyPoolRecycled, newReadyPool] = readyPoolRecycling.splitMap(([product, recycling]) => [recycling, product]);
            recyclePoolTaking
              .forEach(([taking, recyclePool]) => {
                newReadyPool.push(...recyclePool.splice(0, taking))
              })
            newReadyPool.push(...takeContractsFromGeneralPool(props.settings, newPools, event.data.took.generalPool));
            if (serverGameState.state === "StrategicSwapPack") {
              (newPools.recyclePoolsContracts[getRandomInt(newPools.recyclePoolsContracts.length)] ?? []).unshift(...readyPoolRecycled);
            } // else if "simple" mode, we don't need to worry about what contracts are in the recycle pool, so just dont bother tracking
            const newTraderSupplies = serverGameState.traderSupplies.shallowCopy();
            newTraderSupplies.set(iPlayerEvent, {
              ...serverGameState.traderSupplies.get(iPlayerEvent),
              readyPool: newReadyPool
            });
            return opt({
              ...(
                (serverGameState.state === "StrategicSwapPack")
                  ? (() => {
                    const iPlayerNext = props.clients.incrementIndexModLength(optValueOr(serverGameState.iPlayerActiveSwapTrader, iPlayerLocal /* TODO FIX default should never be used here */), 1);
                    return {
                      state: "StrategicSwapPack",
                      iPlayerActiveSwapTrader:
                        (iPlayerToNum(iPlayerNext) === iPlayerToNum(serverGameState.iPlayerOfficer))
                          ? nullopt
                          : opt(iPlayerNext.value),
                    };
                  })()
                  : {
                    state: "SimpleSwapPack",
                    tradersSwapping: serverGameState.tradersSwapping.set(iPlayerEvent, false).arr,
                  }
              ),
              round: serverGameState.round,
              communityPools: newPools,
              traderSupplies: newTraderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
              counters: serverGameState.counters,
              iPlayerOfficer: serverGameState.iPlayerOfficer.value,
              cartStates: serverGameState.cartStates.arr,
            });
          })();
          if (nextState.hasValue === false) break;

          props.ws.ws.send(`MSG|${props.clients.arr.filter(x => x.clientId != props.localInfo.clientId).map(x => x.clientId).join(",")}`
            + `|${NetworkTypes.ServerEventType.STATE_UPDATE}|${JSON.stringify({ state: nextState.value } satisfies NetworkTypes.ServerStateUpdateEventData)}`
          );
          clientHandleReceivedServerEvent({
            type: NetworkTypes.ServerEventType.STATE_UPDATE,
            data: { state: nextState.value }
          });
        } else {
          // unexpected state, TODO
          console.log(`Invalid SWAP_SUPPLY_CONTRACTS: ${JSON.stringify(event)}`);
        }
      } break;

      case NetworkTypes.ClientEventType.PACK_CART: {
        const iPlayerEvent = props.clients.map((c, i) => { return { ...c, clientIndex: i }; }).arr.filter(c => c.clientId == event.data.sourceClientId)[0]?.clientIndex;
        if (iPlayerEvent === undefined) {
          console.log(`Received bad PACK_CART client event: ${JSON.stringify(event)}`);
          console.trace();
          break;
        }
        if (
          (
            serverGameState.state == "StrategicSwapPack"
            && iPlayerToNum(serverGameState.iPlayerOfficer) !== iPlayerToNum(iPlayerEvent)
            && (
              serverGameState.iPlayerActiveSwapTrader.hasValue === false
              || (
                toSequentialTraderOrderingRaw({ iPlayer: iPlayerEvent, iPlayerOfficer: serverGameState.iPlayerOfficer })
                < toSequentialTraderOrderingRaw({ iPlayer: serverGameState.iPlayerActiveSwapTrader.value, iPlayerOfficer: serverGameState.iPlayerOfficer })
              )
            )
            && serverGameState.cartStates.get(iPlayerEvent).packed === false
          )
          || (
            serverGameState.state == "SimpleSwapPack"
            && iPlayerToNum(iPlayerEvent) !== iPlayerToNum(serverGameState.iPlayerOfficer)
            && serverGameState.tradersSwapping.get(iPlayerEvent) === false
          )
        ) {
          const nextState: Optional<SerializableServerGameState> = (() => {
            const readyPoolPacking =
              serverGameState.traderSupplies.get(iPlayerEvent).readyPool
                .zip(event.data.packed);
            if (readyPoolPacking === undefined) {
              console.log(`Received bad PACK_CART client event: ${JSON.stringify(event)}`);
              console.trace();
              return nullopt;
            }
            const [readyPoolPacked, newReadyPool] = readyPoolPacking.splitMap(([product, packing]) => [packing, product]);

            const newTraderSupplies = serverGameState.traderSupplies.shallowCopy();
            newTraderSupplies.set(iPlayerEvent, {
              ...serverGameState.traderSupplies.get(iPlayerEvent),
              readyPool: newReadyPool
            });

            const newCartStates = serverGameState.cartStates.shallowCopy();
            newCartStates.set(iPlayerEvent, {
              packed: true,
              cart: {
                count: readyPoolPacked.length,
                products: readyPoolPacked,
                claimedType: event.data.claimedType,
                claimMessage: event.data.claimMessage
              }
            });

            const nextStateCartStatesOpt = newCartStates.everyTransform((s, i) => (iPlayerToNum(i) == iPlayerToNum(serverGameState.iPlayerOfficer) || s.packed == true) ? opt(s) : nullopt);
            if (nextStateCartStatesOpt.hasValue == true) {
              return opt({
                state: "CustomsIntro",
                round: serverGameState.round,
                communityPools: serverGameState.communityPools,
                traderSupplies: newTraderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                counters: serverGameState.counters,
                iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                iPlayerActiveTrader: props.clients.incrementIndexModLength(serverGameState.iPlayerOfficer, 1).value,
                cartStates: nextStateCartStatesOpt.value.arr
              });
            } else {
              return opt({
                ...(
                  (serverGameState.state === "StrategicSwapPack")
                    ? { state: "StrategicSwapPack", iPlayerActiveSwapTrader: optMap(serverGameState.iPlayerActiveSwapTrader, (i => i.value)) }
                    : { state: "SimpleSwapPack", tradersSwapping: serverGameState.tradersSwapping.arr }
                ),
                round: serverGameState.round,
                communityPools: serverGameState.communityPools,
                traderSupplies: newTraderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                counters: serverGameState.counters,
                iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                cartStates: newCartStates.arr
              });
            }
          })();
          if (nextState.hasValue === false) break;

          props.ws.ws.send(`MSG|${props.clients.arr.filter(x => x.clientId != props.localInfo.clientId).map(x => x.clientId).join(",")}`
            + `|${NetworkTypes.ServerEventType.STATE_UPDATE}|${JSON.stringify({ state: nextState.value } satisfies NetworkTypes.ServerStateUpdateEventData)}`
          );
          clientHandleReceivedServerEvent({
            type: NetworkTypes.ServerEventType.STATE_UPDATE,
            data: { state: nextState.value }
          });
        } else {
          // unexpected state, TODO
          console.log(`Invalid PACK_CART: ${JSON.stringify(event)}`);
        }
      } break;

      case NetworkTypes.ClientEventType.ADVANCE_CUSTOMS_INTRO: {
        const iPlayerEvent = props.clients.map((c, i) => { return { ...c, clientIndex: i }; }).arr.filter(c => c.clientId == event.data.sourceClientId)[0]?.clientIndex;
        if (iPlayerEvent === undefined) {
          console.log(`Invalid ADVANCE_CUSTOMS_INTRO: ${JSON.stringify(event)}`);
          console.trace();
          break;
        }
        if (serverGameState.state == "CustomsIntro" && iPlayerToNum(serverGameState.iPlayerOfficer) == iPlayerToNum(iPlayerEvent)) {
          const nextState: SerializableServerGameState = (() => {
            const iPlayerNext = props.clients.incrementIndexModLength(serverGameState.iPlayerActiveTrader, 1);
            if (iPlayerToNum(iPlayerNext) === iPlayerToNum(serverGameState.iPlayerOfficer)) {
              return {
                state: "Customs",
                round: serverGameState.round,
                communityPools: serverGameState.communityPools,
                traderSupplies: serverGameState.traderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                counters: serverGameState.counters,
                iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                cartStates: serverGameState.cartStates.arr,
                customsState: "ready",
              };
            } else {
              return {
                state: "CustomsIntro",
                round: serverGameState.round,
                communityPools: serverGameState.communityPools,
                traderSupplies: serverGameState.traderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                counters: serverGameState.counters,
                iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                iPlayerActiveTrader: iPlayerNext.value,
                cartStates: serverGameState.cartStates.arr,
              };
            }
          })();

          props.ws.ws.send(`MSG|${props.clients.arr.filter(x => x.clientId != props.localInfo.clientId).map(x => x.clientId).join(",")}`
            + `|${NetworkTypes.ServerEventType.STATE_UPDATE}|${JSON.stringify({ state: nextState } satisfies NetworkTypes.ServerStateUpdateEventData)}`
          );
          clientHandleReceivedServerEvent({
            type: NetworkTypes.ServerEventType.STATE_UPDATE,
            data: { state: nextState }
          });
        } else {
          // unexpected state, TODO
          console.log(`Invalid ADVANCE_CUSTOMS_INTRO: ${JSON.stringify(event)}`);
        }
      } break;

      case NetworkTypes.ClientEventType.CUSTOMS_ACTION: {
        const handleUnexpectedState = () => {
          // unexpected state, TODO
          console.log(`Invalid OFFICER_CUSTOMS_ACTION: ${JSON.stringify(event)}`);
          return undefined as any;
        };

        const iPlayerEvent = props.clients.map((c, i) => { return { ...c, clientIndex: i }; }).arr.filter(c => c.clientId == event.data.sourceClientId)[0]?.clientIndex;
        if (iPlayerEvent === undefined) {
          handleUnexpectedState();
          break;
        }

        // validate sender
        if (
          serverGameState.state == "Customs"
          && (
            (
              iPlayerToNum(serverGameState.iPlayerOfficer) == iPlayerToNum(iPlayerEvent)
              && event.data.action.action != "resolve confirmation ready"
              && event.data.action.action != "resolve completed"
            )
            || (
              serverGameState.customsState == "interrogating"
              && iPlayerToNum(serverGameState.iPlayerActiveTrader) == iPlayerToNum(iPlayerEvent)
              && (
                event.data.action.action == "propose deal"
                || (
                  (event.data.action.action == "reject deal" || event.data.action.action == "accept deal")
                  && serverGameState.proposedDeal.hasValue == true
                )
              )
            )
            || (
              serverGameState.customsState == "resolving"
              && (event.data.action.action === "resolve confirmation ready" || event.data.action.action == "resolve completed")
              && (iPlayerToNum(iPlayerEvent) == iPlayerToNum(iPlayerLocal) && props.hostInfo.localHost == true)
            )
          )
        ) {
          if (
            event.data.action.action == "officer tool update"
            && (
              serverGameState.customsState == "interrogating"
              || (serverGameState.customsState === "resolving" && serverGameState.result.resultState.resultState === "confirming")
            )
          ) {
            props.ws.ws.send(`MSG|${props.clients.arr.filter(x => x.clientId != props.localInfo.clientId).map(x => x.clientId).join(",")}`
              + `|${NetworkTypes.ServerEventType.OFFICER_TOOL_UPDATE}|${JSON.stringify(event.data.action.update satisfies NetworkTypes.ServerOfficerToolUpdateEventData)}`
            );
            clientHandleReceivedServerEvent({
              type: NetworkTypes.ServerEventType.OFFICER_TOOL_UPDATE,
              data: event.data.action.update
            });
            return;
          }

          const nextState: Optional<SerializableServerGameState> = (() => {
            if (serverGameState.customsState == "ready") { // TODO fix: means action = resume interrogation, though type system isn't detecting it
              if (event.data.action.action != "resume interrogation") {
                handleUnexpectedState();
                return nullopt;
              }
              const eventIPlayerTrader = props.clients.validateIndex(event.data.action.iPlayerTrader);
              if (eventIPlayerTrader.hasValue === false
                || iPlayerToNum(eventIPlayerTrader.value) === iPlayerToNum(serverGameState.iPlayerOfficer)
                || serverGameState.cartStates.get(eventIPlayerTrader.value).packed === false) {
                handleUnexpectedState();
                return nullopt;
              }

              return opt({
                state: "Customs",
                round: serverGameState.round,
                communityPools: serverGameState.communityPools,
                traderSupplies: serverGameState.traderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                counters: serverGameState.counters,
                iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                cartStates: serverGameState.cartStates.arr,
                customsState: "interrogating",
                iPlayerActiveTrader: eventIPlayerTrader.value.value,
                proposedDeal: nullopt,
                crowbarSelected: false,
                entryVisaVisible: false,
              } satisfies SerializableServerGameState);
            } else if (serverGameState.customsState == "interrogating") {
              if (event.data.action.action == "resume interrogation"
                || event.data.action.action == "resolve confirmation ready"
                || event.data.action.action == "confirm resolve"
                || event.data.action.action == "resolve completed"
              ) {
                handleUnexpectedState();
                return nullopt;
              } else if (event.data.action.action == "pause interrogation") {
                return opt({
                  state: "Customs",
                  round: serverGameState.round,
                  communityPools: serverGameState.communityPools,
                  traderSupplies: serverGameState.traderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                  counters: serverGameState.counters,
                  iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                  cartStates: serverGameState.cartStates.arr,
                  customsState: "ready"
                } satisfies SerializableServerGameState);
              } else if (event.data.action.action == "officer tool update") {
                // should've been handled above
                handleUnexpectedState();
                return nullopt;
              } else if (event.data.action.action == "propose deal") {
                return opt({
                  ...serverGameState,
                  traderSupplies: serverGameState.traderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                  iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                  iPlayerActiveTrader: serverGameState.iPlayerActiveTrader.value,
                  cartStates: serverGameState.cartStates.arr,
                  proposedDeal: opt({
                    ...event.data.action.deal,
                    waitingOnOfficer: iPlayerToNum(serverGameState.iPlayerOfficer) != iPlayerToNum(iPlayerEvent)
                  }),
                } satisfies SerializableServerGameState);
              } else if (event.data.action.action == "reject deal") {
                if (
                  serverGameState.proposedDeal.hasValue == false
                  || (serverGameState.proposedDeal.value.waitingOnOfficer != (iPlayerToNum(serverGameState.iPlayerOfficer) == iPlayerToNum(iPlayerEvent)))
                ) {
                  handleUnexpectedState();
                  return nullopt;
                } else {
                  return opt({
                    ...serverGameState,
                    traderSupplies: serverGameState.traderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                    iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                    iPlayerActiveTrader: serverGameState.iPlayerActiveTrader.value,
                    cartStates: serverGameState.cartStates.arr,
                    proposedDeal: nullopt,
                  } satisfies SerializableServerGameState);
                }
              } else if (event.data.action.action == "prepare tool") {
                return opt({
                  ...serverGameState,
                  traderSupplies: serverGameState.traderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                  iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                  iPlayerActiveTrader: serverGameState.iPlayerActiveTrader.value,
                  cartStates: serverGameState.cartStates.arr,
                  crowbarSelected: serverGameState.crowbarSelected || event.data.action.tool === "crowbar",
                  entryVisaVisible: serverGameState.entryVisaVisible || event.data.action.tool === "stamp",
                  proposedDeal: optMap(serverGameState.proposedDeal, (proposedDealVal) => ({
                    officerGives: {
                      money: proposedDealVal.officerGives.money,
                      suppliesProducts: proposedDealVal.officerGives.suppliesProducts.arr,
                    },
                    traderGives: {
                      money: proposedDealVal.traderGives.money,
                      suppliesProducts: proposedDealVal.traderGives.suppliesProducts.arr,
                    },
                    message: proposedDealVal.message,
                    waitingOnOfficer: proposedDealVal.waitingOnOfficer,
                  })),
                } satisfies SerializableServerGameState);
              } else { // ignore cart, search cart, or accept deal
                return opt({
                  state: "Customs",
                  round: serverGameState.round,
                  communityPools: serverGameState.communityPools,
                  traderSupplies: serverGameState.traderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                  counters: {
                    ...serverGameState.counters,
                    ...(
                      (event.data.action.action === "search cart")
                        ? { incidentReport: serverGameState.counters.incidentReport + 1 }
                        : { entryVisa: serverGameState.counters.entryVisa + 1 }
                    )
                  },
                  iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                  cartStates: serverGameState.cartStates.arr,
                  customsState: "resolving",
                  iPlayerActiveTrader: serverGameState.iPlayerActiveTrader.value,
                  result: (
                    (event.data.action.action == "accept deal")
                      ? {
                        result: "ignored for deal",
                        ...(
                          (serverGameState.proposedDeal.hasValue === false) // TODO fix, this is proven false
                            ? handleUnexpectedState() as {
                              deal: SerializableIgnoreDeal,
                              dealProposedByOfficer: boolean,
                            }
                            : {
                              deal: {
                                officerGives: {
                                  money: serverGameState.proposedDeal.value.officerGives.money,
                                  suppliesProducts: serverGameState.proposedDeal.value.officerGives.suppliesProducts.arr,
                                },
                                traderGives: {
                                  money: serverGameState.proposedDeal.value.traderGives.money,
                                  suppliesProducts: serverGameState.proposedDeal.value.traderGives.suppliesProducts.arr,
                                },
                                message: serverGameState.proposedDeal.value.message,
                              },
                              dealProposedByOfficer: !serverGameState.proposedDeal.value.waitingOnOfficer,
                            }
                        ),
                        resultState: { resultState: "paying" },
                      }
                      : (event.data.action.action == "search cart")
                        ? {
                          result: "searched",
                          iProductCheekyDelay: (() => {
                            const activeTraderCartState = serverGameState.cartStates.get(serverGameState.iPlayerActiveTrader);
                            if (activeTraderCartState.packed == true) {
                              const numAccuratelyClaimedProducts = activeTraderCartState.cart.products.filter(p => p == activeTraderCartState.cart.claimedType).length;
                              if (numAccuratelyClaimedProducts >= 3 && activeTraderCartState.cart.count >= 4) {
                                const chance = 0.2;
                                if (Math.random() < chance) {
                                  if (numAccuratelyClaimedProducts != activeTraderCartState.cart.count) {
                                    return opt(numAccuratelyClaimedProducts);
                                  } else {
                                    return opt(Math.floor(Math.random() * (numAccuratelyClaimedProducts - 3)) + 3);
                                  }
                                }
                              }
                            }
                            return nullopt;
                          })(),
                          resultState: { resultState: "searching" },
                        }
                        : { result: "ignored", resultState: { resultState: "continuing", entryVisaStamps: event.data.action.entryVisaStamps } }
                  )
                } satisfies SerializableServerGameState)
              }
            } else { // "resolving"
              const suspectCartState = serverGameState.cartStates.get(serverGameState.iPlayerActiveTrader);
              if (
                suspectCartState.packed == false
                || !(
                  (
                    event.data.action.action === "resolve confirmation ready"
                    && (serverGameState.result.resultState.resultState === "paying" || serverGameState.result.resultState.resultState === "searching")
                  )
                  || (
                    event.data.action.action === "confirm resolve"
                    && serverGameState.result.resultState.resultState === "confirming"
                  )
                  || (
                    event.data.action.action === "resolve completed"
                    && serverGameState.result.resultState.resultState === "continuing"
                  )
                )
              ) {
                handleUnexpectedState();
                return nullopt;
              }

              if (event.data.action.action === "resolve confirmation ready" || event.data.action.action === "confirm resolve") {
                return opt({
                  state: "Customs",
                  round: serverGameState.round,
                  communityPools: serverGameState.communityPools,
                  traderSupplies: serverGameState.traderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                  counters: serverGameState.counters,
                  iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                  cartStates: serverGameState.cartStates.arr,
                  customsState: "resolving",
                  iPlayerActiveTrader: serverGameState.iPlayerActiveTrader.value,
                  result: (
                    (serverGameState.result.result === "searched")
                      ? {
                        ...serverGameState.result,
                        resultState:
                          (event.data.action.action === "resolve confirmation ready")
                            ? { resultState: "confirming" }
                            : { resultState: "continuing", entryVisaStamps: event.data.action.entryVisaStamps },
                      }
                      : (serverGameState.result.result === "ignored for deal")
                        ? {
                          result: "ignored for deal",
                          deal: {
                            officerGives: {
                              money: serverGameState.result.deal.officerGives.money,
                              suppliesProducts: serverGameState.result.deal.officerGives.suppliesProducts.arr,
                            },
                            traderGives: {
                              money: serverGameState.result.deal.traderGives.money,
                              suppliesProducts: serverGameState.result.deal.traderGives.suppliesProducts.arr,
                            },
                            message: serverGameState.result.deal.message,
                          },
                          dealProposedByOfficer: serverGameState.result.dealProposedByOfficer,
                          resultState:
                            (event.data.action.action === "resolve confirmation ready")
                              ? { resultState: "confirming" }
                              : { resultState: "continuing", entryVisaStamps: event.data.action.entryVisaStamps },
                        }
                        : serverGameState.result // TODO should be impossible by above if statement
                  ),
                } satisfies SerializableServerGameState);
              } else { // "resolve completed"
                const newPools: CommunityContractPools = {
                  generalPoolContractCounts: serverGameState.communityPools.generalPoolContractCounts.shallowCopy(),
                  recyclePoolsContracts: [serverGameState.communityPools.recyclePoolsContracts[0]?.shallowCopy() ?? []].concat(serverGameState.communityPools.recyclePoolsContracts.skip(1))
                };
                let newTraderSupplies = serverGameState.traderSupplies.shallowCopy();
                newTraderSupplies.set(serverGameState.iPlayerActiveTrader, {
                  ...newTraderSupplies.get(serverGameState.iPlayerActiveTrader),
                  shopProductCounts: newTraderSupplies.get(serverGameState.iPlayerActiveTrader).shopProductCounts.shallowCopy()
                });
                newTraderSupplies.set(serverGameState.iPlayerOfficer, {
                  ...newTraderSupplies.get(serverGameState.iPlayerOfficer)
                });
                if (serverGameState.result.result == "ignored" || serverGameState.result.result == "ignored for deal") {
                  suspectCartState.cart.products.forEach(p => {
                    newTraderSupplies.get(serverGameState.iPlayerActiveTrader).shopProductCounts.set(p, newTraderSupplies.get(serverGameState.iPlayerActiveTrader).shopProductCounts.get(p) + 1);
                  });
                  if (serverGameState.result.result == "ignored for deal") {
                    // execute deal
                    newTraderSupplies.get(serverGameState.iPlayerActiveTrader).money += serverGameState.result.deal.officerGives.money;
                    newTraderSupplies.get(serverGameState.iPlayerActiveTrader).money -= serverGameState.result.deal.traderGives.money;
                    newTraderSupplies.get(serverGameState.iPlayerOfficer).money += serverGameState.result.deal.traderGives.money;
                    newTraderSupplies.get(serverGameState.iPlayerOfficer).money -= serverGameState.result.deal.officerGives.money;
                  }
                } else { // "searched"
                  if (suspectCartState.cart.products.every(p => p == suspectCartState.cart.claimedType)) {
                    // officer pays
                    const finePaid = Math.min(
                      newTraderSupplies.get(serverGameState.iPlayerOfficer).money,
                      suspectCartState.cart.products.map(p => getProductInfo(p).fine as number).reduce((a, b) => a + b, 0)
                    );
                    newTraderSupplies.get(serverGameState.iPlayerOfficer).money -= finePaid;
                    newTraderSupplies.get(serverGameState.iPlayerActiveTrader).money += finePaid;
                    suspectCartState.cart.products.forEach(p => {
                      newTraderSupplies.get(serverGameState.iPlayerActiveTrader).shopProductCounts.set(p, newTraderSupplies.get(serverGameState.iPlayerActiveTrader).shopProductCounts.get(p) + 1);
                    });
                  } else {
                    // trader pays
                    const finePaid = Math.min(
                      newTraderSupplies.get(serverGameState.iPlayerActiveTrader).money,
                      suspectCartState.cart.products
                        .filter(p => p != suspectCartState.cart.claimedType)
                        .map(p => getProductInfo(p).fine as number)
                        .reduce((a, b) => a + b, 0)
                    );
                    newTraderSupplies.get(serverGameState.iPlayerActiveTrader).money -= finePaid;
                    newTraderSupplies.get(serverGameState.iPlayerOfficer).money += finePaid;
                    newTraderSupplies.get(serverGameState.iPlayerActiveTrader).shopProductCounts.set(suspectCartState.cart.claimedType,
                      newTraderSupplies.get(serverGameState.iPlayerActiveTrader).shopProductCounts.get(suspectCartState.cart.claimedType)
                      + suspectCartState.cart.products
                        .filter(p => p == suspectCartState.cart.claimedType)
                        .length
                    );
                    (newPools.recyclePoolsContracts[0] ?? []).push(
                      ...suspectCartState.cart.products
                        .filter(p => p != suspectCartState.cart.claimedType)
                    );
                  }
                }

                if (serverGameState.cartStates.arr.filter(c => c.packed == true).length == 1) {
                  // this was the last cart

                  // refresh ready pools
                  newTraderSupplies = newTraderSupplies.map(s => {
                    return {
                      ...s,
                      readyPool: s.readyPool.shallowCopy()
                    };
                  });
                  newTraderSupplies.arr.forEach(s => {
                    s.readyPool.push(...takeContractsFromGeneralPool(props.settings, newPools, readyPoolSize - s.readyPool.length));
                  });

                  // check for end of game
                  const newRound = serverGameState.round + 1;
                  if (newRound >= props.settings.numRounds) {
                    return opt({
                      state: "GameEnd",
                      finalTraderSupplies: newTraderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr }))
                    } satisfies SerializableServerGameState);
                  } else {
                    return opt({
                      ...(
                        (props.settings.swapMode === "strategic")
                          ? { state: "StrategicSwapPack", iPlayerActiveSwapTrader: opt(props.clients.incrementIndexModLength(serverGameState.iPlayerOfficer, 2).value), }
                          : { state: "SimpleSwapPack", tradersSwapping: props.clients.map((_c, i) => iPlayerToNum(i) === iPlayerToNum(props.clients.incrementIndexModLength(serverGameState.iPlayerOfficer, 1)) ? false : true).arr }
                      ),
                      round: newRound,
                      communityPools: newPools,
                      traderSupplies: newTraderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                      counters: serverGameState.counters,
                      iPlayerOfficer: props.clients.incrementIndexModLength(serverGameState.iPlayerOfficer, 1).value,
                      cartStates: props.clients.map(() => { return { "packed": false as false }; }).arr,
                    } satisfies SerializableServerGameState);
                  }
                } else {
                  const newCartStates = serverGameState.cartStates.shallowCopy();
                  newCartStates.set(serverGameState.iPlayerActiveTrader, { "packed": false });
                  return opt({
                    state: "Customs",
                    round: serverGameState.round,
                    communityPools: newPools,
                    traderSupplies: newTraderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                    counters: serverGameState.counters,
                    iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                    cartStates: newCartStates.arr,
                    customsState: "ready"
                  } satisfies SerializableServerGameState);
                }
              }
            }
          })();
          if (nextState.hasValue === false) break;

          props.ws.ws.send(`MSG|${props.clients.arr.filter(x => x.clientId != props.localInfo.clientId).map(x => x.clientId).join(",")}`
            + `|${NetworkTypes.ServerEventType.STATE_UPDATE}|${JSON.stringify({ state: nextState.value } satisfies NetworkTypes.ServerStateUpdateEventData)}`
          );
          clientHandleReceivedServerEvent({
            type: NetworkTypes.ServerEventType.STATE_UPDATE,
            data: { state: nextState.value }
          });
        } else {
          // TODO unexpected
          handleUnexpectedState();
        }
      } break;

    }
  }

  props.ws.setHandlers({
    ...defaultWebSocketErrorHandlers,
    onmessage: (event) => {
      const rawMessage: string = event.data.toString();
      const message = NetworkTypes.parseReceivedMessage(rawMessage);
      if (message.ok == false) {
        produceError(`Failed to parse message: ${message.error} | message: ${rawMessage}`);
      } else {
        switch (message.value.type) {
          case "WELCOME": {
            handleRedundantWELCOMEMessage(rawMessage);
          } break;

          case "MSG": {
            if (props.hostInfo.localHost) {
              // host only receives client events
              const msgEvent = NetworkTypes.parseClientEvent(message.value.message);
              if (msgEvent.ok == false) {
                produceError(`Failed to parse client event: ${msgEvent.error} | message: ${rawMessage}`);
              } else {
                serverHandleReceivedClientEvent(msgEvent.value);
              }
            } else {
              // non-host only receives server events
              const msgEvent = NetworkTypes.parseServerEvent(message.value.message);
              if (msgEvent.ok == false) {
                produceError(`Failed to parse server event: ${msgEvent.error} | message: ${rawMessage}`);
              } else {
                clientHandleReceivedServerEvent(msgEvent.value);
              }
            }
          } break;

          case "JOIN": {
            if (props.hostInfo.localHost == true) {
              // send notwelcome
              props.ws.ws.send(`MSG|${message.value.joinedClientId}|${NetworkTypes.ServerEventType.NOTWELCOME}`
                + `|${JSON.stringify({
                  reason: "Cannot join a game in progress."
                } satisfies NetworkTypes.ServerNotWelcomeEventData)}`);
            }
          } break;

          case "LEAVE": {
            // TODO
          } break;
        }
      }
    }
  });

  React.useEffect(() => {
    if (props.hostInfo.localHost) {
      if (!(props.clients.length >= 3 && props.clients.length <= 10)) {
        return;
      }

      const iPlayerOfficer = props.clients.getRandomIndex();
      const persistentGameState = generateInitialPersistentGameState(props.settings, props.clients);
      const state: SerializableServerGameState = {
        ...(
          (props.settings.swapMode === "strategic")
            ? { state: "StrategicSwapPack", iPlayerActiveSwapTrader: opt(props.clients.incrementIndexModLength(iPlayerOfficer, 1).value), }
            : { state: "SimpleSwapPack", tradersSwapping: props.clients.map((_c, i) => iPlayerToNum(i) === iPlayerToNum(iPlayerOfficer) ? false : true).arr }
        ), round: 0,
        communityPools: persistentGameState.communityPools,
        traderSupplies: persistentGameState.traderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
        counters: persistentGameState.counters,
        iPlayerOfficer: iPlayerOfficer.value,
        cartStates: props.clients.map(() => { return { "packed": false as false }; }).arr,
      };
      props.ws.ws.send(`MSG|${props.clients.arr.filter(x => x.clientId != props.localInfo.clientId).map(x => x.clientId).join(",")}`
        + `|${NetworkTypes.ServerEventType.STATE_UPDATE}|${JSON.stringify({ state } satisfies NetworkTypes.ServerStateUpdateEventData)}`
      );
      clientHandleReceivedServerEvent({
        type: NetworkTypes.ServerEventType.STATE_UPDATE,
        data: { state }
      });
    }
  }, []);

  const timeoutsToClearOnStateChange: NodeJS.Timeout[] = [];
  React.useEffect(() => {
    return () => {
      timeoutsToClearOnStateChange.forEach(t => clearTimeout(t));
    };
  })

  const previousAnimationSequenceRef = React.useRef<Optional<GameAnimationStep[]>>(nullopt);

  if (clientGameState.state == "Setup") {
    return (<div>Waiting for game to start<AnimatedEllipses /></div>);
  }
  if (clientGameState.state == "GameEnd") {
    const awards = (
      awardTypes
        .filterTransform(aw => {
          const playerEarnings = clientGameState.finalTraderSupplies.map((s, iPlayer) => {
            const relevantEarnings = s.shopProductCounts.arr.filterTransform((c, iProduct) => {
              if (c <= 0) return nullopt;
              const award = getProductInfo(iProduct).award;
              if (award.hasValue == false || award.value.productType != aw.awardType) return nullopt;
              return opt({
                productType: iProduct as ProductType,
                count: c,
                awardPoints: award.value.points * c,
              })
            });
            return {
              iPlayer,
              awardPoints: relevantEarnings.map(e => e.awardPoints).reduce((a, b) => a + b, 0),
              relevantEarnings: relevantEarnings
            };
          }).arr;

          const groupedPlayerEarnings = playerEarnings.groupBy(e => e.awardPoints).sort((a, b) => b.key - a.key).filter(g => g.key > 0);
          const firstEarningsGroup = groupedPlayerEarnings[0];
          if (firstEarningsGroup === undefined) {
            return nullopt;
          }

          const secondEarningsGroup = groupedPlayerEarnings[1];
          return opt({
            awardType: aw.awardType,
            ...(
              // excessive condition: if the second group is missing, the first should have everybody, but no easy way to prove that
              (firstEarningsGroup.group.length > 1 || secondEarningsGroup === undefined)
                ? {
                  placers: [
                    {
                      placeIcon: `${firstPlaceIcon}${secondPlaceIcon}`,
                      gamePointsEarned: Math.floor((aw.firstPlaceEarnings + aw.secondPlaceEarnings) / firstEarningsGroup.group.length),
                      earners: firstEarningsGroup.group
                    }
                  ],
                  nonPlacers: groupedPlayerEarnings.skip(1).map(g => g.group).reduce((a, b) => a.concat(b), []),
                }
                : {
                  placers: [
                    {
                      placeIcon: firstPlaceIcon,
                      gamePointsEarned: aw.firstPlaceEarnings,
                      earners: firstEarningsGroup.group
                    },
                    {
                      placeIcon: secondPlaceIcon,
                      gamePointsEarned: Math.floor(aw.secondPlaceEarnings / secondEarningsGroup.group.length),
                      earners: secondEarningsGroup.group
                    },
                  ],
                  nonPlacers: groupedPlayerEarnings.skip(2).map(g => g.group).reduce((a, b) => a.concat(b), []),
                }
            ),
          })
        })
    );

    return (<div>
      <h1>Game over!</h1>
      <h2>Total Scores:</h2>
      <div>
        {
          props.clients.zip(clientGameState.finalTraderSupplies)
            .map(([clientInfo, traderSupplies], iPlayer) => {
              return {
                name: clientInfo.name,
                points:
                  traderSupplies.money
                  + traderSupplies.shopProductCounts.map((c, i) => getProductInfo(i).value * c).arr.reduce((a, b) => a + b, 0)
                  + awards
                    .map(aw =>
                      aw.placers.map(p => p.earners.some(e => iPlayerToNum(e.iPlayer) == iPlayerToNum(iPlayer)) ? p.gamePointsEarned : 0).reduce((a, b) => a + b, 0)
                    ).reduce((a, b) => a + b, 0)
              };
            })
            .arr.groupBy(p => p.points)
            .sort((a, b) => b.key - a.key)
            .map((g, i) => (
              <div>
                <span>{i == 0 ? winnerIcon : ""}</span>
                <span>
                  {
                    g.group.map(p => p.name).join(", ")
                  }
                  {" "}
                  {`(${pointIcon}${g.key})`}
                </span>
              </div>
            ))
        }
      </div>
      <h3>{trophyIcon} Awards</h3>
      <div>
        {
          awards
            .map(aw => (
              <div style={{ display: "inline-block", verticalAlign: "top", margin: "30px" }}>
                <h1>{trophyIcon}{getProductInfo(aw.awardType).icon}</h1>
                <div>
                  {
                    aw.placers
                      .map((p) => (
                        <div>
                          <span>{p.placeIcon} ({pointIcon}{p.gamePointsEarned}{p.earners.length == 1 ? "" : " each"})</span>
                          {":  "}
                          <span>
                            {
                              p.earners.map(e => `${props.clients.get(e.iPlayer).name} (${e.relevantEarnings.map(re => `${getProductInfo(re.productType).icon}${re.count}`)})`).join(", ")
                            }
                          </span>
                        </div>
                      ))
                  }
                  {
                    aw.nonPlacers
                      .map(e => (
                        <div>
                          {`${props.clients.get(e.iPlayer).name} (${e.relevantEarnings.map(re => `${getProductInfo(re.productType).icon}${re.count}`)})`}
                        </div>
                      )
                      )
                  }
                </div>
              </div>
            ))
        }
      </div>
      <h3>Earned Supplies</h3>
      <div>
        {
          clientGameState.finalTraderSupplies.map((s, iPlayer) => (
            <Section title={`${props.clients.get(iPlayer).name}`}>
              <TraderSuppliesTable
                key={`menu_game_end_final_supplies_${iPlayer.value}`}
                usekey={`menu_game_end_final_supplies_${iPlayer.value}`}
                supplies={s}
                type={"local"}
                iPlayerOwner={iPlayer}
                animation={nullopt}
              />
            </Section>
          )).arr
        }
      </div>
    </div>
    );
  }

  const iPlayerOfficer = clientGameState.localOfficer == true ? iPlayerLocal : clientGameState.iPlayerOfficer;
  const toSequentialTraderOrdering = (iPlayer: ValidPlayerIndex) => toSequentialTraderOrderingRaw({ iPlayer, iPlayerOfficer });

  const currentTraderSupplies =
    clientGameState.state == "Customs" && clientGameState.customsState == "resolving"
      ? clientGameState.wipTraderSupplies
      : clientGameState.traderSupplies;
  //console.log(currentTraderSupplies);

  const animation: Optional<GameAnimationSequence> = (() => {
    const animationSequence = ((): Optional<{ sequence: GameAnimationStep[], onComplete: () => void, persistToNextGameState: boolean }> => {
      switch (clientGameState.state) {
        case "StrategicSwapPack":
        case "SimpleSwapPack":
        case "Refresh":
          return nullopt;
        case "CustomsIntro": {
          const iPlayerActiveTrader = clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader;
          if (clientGameState.introState == "animating") {
            const activeTraderCartState = clientGameState.cartStates.get(iPlayerActiveTrader);
            if (activeTraderCartState.packed == false) {
              // TODO fix shouldn't ever happen
              return nullopt;
            }
            return opt({
              sequence:
                (
                  (iPlayerToNum(props.clients.incrementIndexModLength(iPlayerActiveTrader, -1)) === iPlayerToNum(iPlayerOfficer))
                    ? []
                    : [{
                      type: "cart motion",
                      iPlayerCart: props.clients.incrementIndexModLength(iPlayerActiveTrader, -1),
                      motion: "suspect area to trader supplies",
                    } satisfies CartMotionGameAnimationStep] as GameAnimationStep[]
                ).concat([
                  {
                    type: "wait",
                    delayMs: 800
                  },
                  {
                    type: "cart motion",
                    iPlayerCart: iPlayerActiveTrader,
                    motion: "trader supplies to suspect area",
                  } satisfies CartMotionGameAnimationStep,
                  {
                    type: "wait",
                    delayMs: 500,
                  },
                ]).concat(
                  (activeTraderCartState.cart.claimMessage.hasValue == true)
                    ? [{ type: "claim message", message: activeTraderCartState.cart.claimMessage.value }, { type: "wait", delayMs: 500 }]
                    : []
                ),
              onComplete: () => {
                setClientGameState({
                  ...clientGameState,
                  introState: "ready",
                });
              },
              persistToNextGameState: true,
            });
          } else { // ready
            return opt({
              sequence: [],
              onComplete: () => { },
              persistToNextGameState: false,
            });
          }
        }
        case "Customs": {
          switch (clientGameState.customsState) {
            case "ready": {
              if (clientGameState.readyState.state == "transitioning") {
                return opt({
                  sequence: [
                    {
                      type: "cart motion",
                      iPlayerCart: clientGameState.readyState.iPlayerExitingCart,
                      motion: "suspect area to trader supplies",
                    } satisfies GameAnimationStep,
                    {
                      type: "wait",
                      delayMs: 700
                    }
                  ],
                  onComplete: () => {
                    setClientGameState({
                      ...clientGameState,
                      readyState: { state: "ready" },
                    });
                  },
                  persistToNextGameState: false,
                })
              } else {
                return nullopt;
              }
            }
            case "interrogating": {
              if (clientGameState.interrogatingState == "cart entering") {
                return opt({
                  sequence: [
                    {
                      type: "cart motion",
                      iPlayerCart: clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader,
                      motion: "trader supplies to suspect area",
                    },
                    {
                      type: "wait",
                      delayMs: 500,
                    }
                  ],
                  onComplete: () => {
                    setClientGameState({
                      ...clientGameState,
                      interrogatingState: "ready",
                    })
                  },
                  persistToNextGameState: false,
                })
              } else {
                return nullopt;
              }
            }
            case "resolving": {
              switch (clientGameState.result.resultState.resultState) {
                case "searching":
                case "paying": {
                  return opt({
                    sequence: ((): GameAnimationStep[] => {
                      const iPlayerActiveTrader = clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader;
                      const activePlayerCartState = clientGameState.cartStates.get(iPlayerActiveTrader);
                      if (activePlayerCartState.packed == false) {
                        // TODO fix not supposed to happen
                        return [];
                      }
                      const [legalProducts, illegalProducts] = activePlayerCartState.cart.products.split(p => p == activePlayerCartState.cart.claimedType);
                      if (clientGameState.result.result == "searched") {
                        const paymentRevealStep: PaymentGameAnimationStep = {
                          type: "payment",
                          action: "reveal if not yet revealed",
                          iPlayerGiver: (illegalProducts.length > 0) ? iPlayerActiveTrader : iPlayerOfficer,
                          iPlayerReceiver: (illegalProducts.length > 0) ? iPlayerOfficer : iPlayerActiveTrader,
                          payment: {
                            money: (illegalProducts.length > 0 ? illegalProducts : legalProducts).map(p => getProductInfo(p).fine as number).reduce((a, b) => a + b, 0),
                            suppliesProducts: productInfos.map(() => 0),
                          }
                        };

                        return [
                          {
                            type: "crate",
                            iPlayerCrate: iPlayerActiveTrader,
                            animation: "blast lid",
                          },
                          {
                            type: "wait",
                            delayMs: 1000,
                          },
                          {
                            type: "crate contents",
                            iPlayerCrate: iPlayerActiveTrader,
                            animation: {
                              animation: "display contents",
                              contents: legalProducts.concat(illegalProducts).map(p => ({ product: p })),
                              iProductCheekyDelay: clientGameState.result.iProductCheekyDelay,
                            }
                          },
                          {
                            type: "wait",
                            delayMs: 1000
                          },

                          paymentRevealStep,

                          {
                            type: "wait",
                            delayMs: 2000,
                          },
                          {
                            ...paymentRevealStep,
                            action: "give",
                          },
                          {
                            type: "wait",
                            delayMs: 750
                          },
                          {
                            ...paymentRevealStep,
                            action: "receive",
                          },
                          {
                            type: "wait",
                            delayMs: 750,
                          },
                          {
                            type: "crate contents",
                            iPlayerCrate: iPlayerActiveTrader,
                            animation: {
                              animation: "deposit contents",
                              contents: legalProducts.map(p => ({ product: p, destination: { destination: "supplies", iPlayer: iPlayerActiveTrader } as CrateProductDestination }))
                                .concat(illegalProducts.map(p => ({ product: p, destination: { destination: "garbage" } }))),
                              illegalsHidden: false,
                            }
                          },
                          {
                            type: "wait",
                            delayMs: 500,
                          },
                        ];
                      } else { // ignored / ignored for deal
                        return (
                          (
                            (clientGameState.result.result != "ignored for deal")
                              ? [] as GameAnimationStep[]
                              : (
                                (
                                  (paymentEmpty(clientGameState.result.deal.traderGives))
                                    ? []
                                    : [{
                                      type: "payment",
                                      action: "reveal if not yet revealed",
                                      iPlayerGiver: iPlayerActiveTrader,
                                      iPlayerReceiver: iPlayerOfficer,
                                      payment: clientGameState.result.deal.traderGives,
                                    } satisfies PaymentGameAnimationStep]
                                ).concat(
                                  (paymentEmpty(clientGameState.result.deal.officerGives))
                                    ? []
                                    : [{
                                      type: "payment",
                                      action: "reveal if not yet revealed",
                                      iPlayerGiver: iPlayerOfficer,
                                      iPlayerReceiver: iPlayerActiveTrader,
                                      payment: clientGameState.result.deal.officerGives,
                                    } satisfies PaymentGameAnimationStep]
                                )
                                  .map((paymentRevealStep, i): GameAnimationStep[] => [

                                    paymentRevealStep,

                                    {
                                      type: "wait",
                                      delayMs: i == 0 ? 2000 : 500
                                    },
                                    {
                                      ...paymentRevealStep,
                                      action: "give",
                                    },
                                    {
                                      type: "wait",
                                      delayMs: 1000,
                                    },
                                    {
                                      ...paymentRevealStep,
                                      action: "receive",
                                    },
                                    {
                                      type: "wait",
                                      delayMs: 1000,
                                    },
                                  ])
                                  .reduce((a, b) => a.concat(b))
                              )
                          )
                        );
                      }
                    })(),
                    onComplete: () => {
                      if (props.hostInfo.localHost) {
                        clientSendClientEventToServer({
                          type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                          data: {
                            sourceClientId: props.localInfo.clientId,
                            action: {
                              action: "resolve confirmation ready"
                            },
                          }
                        });
                      }
                    },
                    persistToNextGameState: true,
                  });
                } break;

                case "confirming": {
                  // placeholder to persist the above animation through to "confirming"
                  return opt({
                    sequence: [],
                    onComplete: () => { },
                    persistToNextGameState: true,
                  });
                } break;

                case "continuing": {
                  return opt({
                    sequence: ((): GameAnimationStep[] => {
                      const iPlayerActiveTrader = clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader;
                      const activePlayerCartState = clientGameState.cartStates.get(iPlayerActiveTrader);
                      if (activePlayerCartState.packed == false) {
                        // TODO fix not supposed to happen
                        return [];
                      }
                      const [legalProducts, illegalProducts] = activePlayerCartState.cart.products.split(p => p == activePlayerCartState.cart.claimedType);
                      if (clientGameState.result.result == "searched") {
                        return [
                          {
                            type: "cart motion",
                            iPlayerCart: iPlayerActiveTrader,
                            motion: "suspect area to trader supplies"
                          },
                          {
                            type: "wait",
                            delayMs: 1000
                          }
                        ];
                      } else { // ignored / ignored for deal
                        return (
                          [
                            {
                              type: "cart motion",
                              iPlayerCart: iPlayerActiveTrader,
                              motion: "suspect area to trader supplies",
                            },
                            {
                              type: "wait",
                              delayMs: 1000,
                            },
                            {
                              type: "crate",
                              iPlayerCrate: iPlayerActiveTrader,
                              animation: "open lid",
                            },
                            {
                              type: "wait",
                              delayMs: 400,
                            },
                            {
                              type: "crate contents",
                              iPlayerCrate: iPlayerActiveTrader,
                              animation: {
                                animation: "deposit contents",
                                contents: legalProducts.concat(illegalProducts).map(p => ({ product: p, destination: { destination: "supplies", iPlayer: iPlayerActiveTrader } })),
                                illegalsHidden: true
                              }
                            },
                            {
                              type: "wait",
                              delayMs: 1000,
                            }
                          ]
                        );
                      }
                    })(),
                    onComplete: () => {
                      if (props.hostInfo.localHost) {
                        clientSendClientEventToServer({
                          type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                          data: {
                            sourceClientId: props.localInfo.clientId,
                            action: {
                              action: "resolve completed"
                            },
                          }
                        });
                      }
                    },
                    persistToNextGameState: false,
                  });
                } break;
              }
            }
          }
        }
      }
    })();
    if (animationSequence.hasValue == false) return nullopt;
    const onCompleteRegistrations = Array(animationSequence.value.sequence.length).fill(false).map(() => [] as (() => void)[]);
    const lastRegistrations = onCompleteRegistrations.at(-1);
    if (lastRegistrations !== undefined) {
      lastRegistrations.push(() => {
        animationSequence.value.onComplete();
      });
    }
    return (animationSequence.hasValue == true)
      ? opt({
        sequence: animationSequence.value.sequence,
        onCompleteRegistrations: onCompleteRegistrations,
        previousGameStateSequence: previousAnimationSequenceRef.current,
        persistToNextGameState: animationSequence.value.persistToNextGameState,
      })
      : nullopt;
  })();
  if (animation.hasValue === true && animation.value.persistToNextGameState === true) {
    previousAnimationSequenceRef.current = opt(optValueOr(animation.value.previousGameStateSequence, []).concat(animation.value.sequence));
  } else {
    previousAnimationSequenceRef.current = nullopt;
  }

  console.log("clientGameState:");
  console.log(clientGameState);
  console.log("animation:");
  console.log(animation);

  // setup timeouts for "wait" type animation steps
  if (animation.hasValue == true) {
    animation.value.sequence.forEach((animationStep, i) => {
      if (animationStep.type == "wait") {
        // TODO fix onCompleteRegistrations undefined checks here
        if (i == 0) {
          timeoutsToClearOnStateChange.push(setTimeout(() => { (animation.value.onCompleteRegistrations[0] ?? []).forEach(c => c()) }, animationStep.delayMs));
        } else {
          (animation.value.onCompleteRegistrations[i - 1] ?? []).push(() => {
            timeoutsToClearOnStateChange.push(setTimeout(() => { (animation.value.onCompleteRegistrations[i] ?? []).forEach(c => c()) }, animationStep.delayMs));
          });
        }
      }
    });
  }

  console.log(JSON.stringify(animation));



  return (
    <div id="menu_game" style={{
      WebkitTouchCallout: "none",
      WebkitUserSelect: "none",
      KhtmlUserSelect: "none",
      MozUserSelect: "none",
      msUserSelect: "none",
      userSelect: "none",
    }}>
      <Section id="menu_game_title">
        <div>
          Round {clientGameState.round + 1} of {props.settings.numRounds}: {(() => {
            switch (clientGameState.state) {
              case "StrategicSwapPack":
              case "SimpleSwapPack":
                return "Exchange Supply Contracts & Prepare Cart";
              case "CustomsIntro":
                return "Introductions";
              case "Customs":
                return "Interrogations";
              case "Refresh":
                return "Round Ending";
            }
          })()}
        </div>
        <div>
          {(() => {
            switch (clientGameState.state) {
              case "StrategicSwapPack":
              case "SimpleSwapPack":
                return (clientGameState.localOfficer == true)
                  ? (<span>Wait while traders exchange supply contracts and pack their carts with products<AnimatedEllipses /></span>)
                  : (clientGameState.localActiveSwapTrader == true)
                    ? "Recycle and replace your supply contracts"
                    : (clientGameState.localState === "waiting")
                      ? (<span>Wait for your turn to exchange supply contracts and pack your cart<AnimatedEllipses /></span>)
                      : (clientGameState.localState === "packing")
                        ? "Select products to pack into your cart, and decide which kind of legal product you'll tell the officer your cart contains"
                        : (<span>Wait while the remaining traders exchange supply contracts and pack their carts<AnimatedEllipses /></span>);
              case "CustomsIntro":
                return (clientGameState.localOfficer == true)
                  ? "Listen to what each trader says is in their cart (you will decide whether to search them at a later time)"
                  : (clientGameState.localActiveTrader == true)
                    ? "Briefly tell the officer what your cart contains (they will decide whether to search it at a later time)"
                    : (toSequentialTraderOrdering(iPlayerLocal) <= toSequentialTraderOrdering(clientGameState.iPlayerActiveTrader))
                      ? (<span>Wait while the remaining traders introduce their cart contents<AnimatedEllipses /></span>)
                      : (<span>Wait for your turn to introduce your cart<AnimatedEllipses /></span>);
              case "Customs":
                return (clientGameState.localOfficer == true)
                  ? "Interrogate each trader about their carts' contents, and decide whether to search them"
                  : (clientGameState.customsState != "ready" && clientGameState.localActiveTrader)
                    ? (clientGameState.customsState == "resolving")
                      ? "Wait for the officer to finish processing your cart"
                      : "Withstand interrogation from the officer about your cart's contents"
                    : (clientGameState.cartStates.get(iPlayerLocal).packed === false)
                      ? (<span>Wait while the remaining traders are interrogated about their carts' contents<AnimatedEllipses /></span>)
                      : (<span>Wait for the officer to interrogate you about your cart's contents<AnimatedEllipses /></span>);
              case "Refresh":
                return (<span>Wait for the next round<AnimatedEllipses /></span>);
            }
          })()
          }
        </div>
      </Section>

      <Section style={{ overflowX: "auto", overflowY: "hidden", whiteSpace: "nowrap", textAlign: "center" }}>
        {
          props.clients
            .map((client, iPlayer) => {
              return (
                <Section
                  key={`menu_game_traders_${iPlayer.value}`}
                  title={`${(
                    iPlayerToNum(iPlayer) === iPlayerToNum(iPlayerOfficer)
                      ? `${officerIcon}Officer`
                      : "Trader"
                  )} ${client.name}`}
                  style={{ display: "inline-block", verticalAlign: "top" }}
                >
                  { // supplies and cart
                    (iPlayerToNum(iPlayer) === iPlayerToNum(iPlayerLocal))
                      ? (
                        <div>(you)</div>
                      )
                      : (
                        <div>
                          <TraderSuppliesTable
                            style={{ display: "inline-block", verticalAlign: "top" }}
                            key={`menu_game_traders_${iPlayer.value}_supplies_rerender_${renderCount.current}`}
                            usekey={`menu_game_traders_${iPlayer.value}_supplies`}
                            supplies={currentTraderSupplies.get(iPlayer)}
                            iPlayerOwner={iPlayer}
                            animation={animation}
                            type={"other"}
                          />
                          <FloatingAnimatedCart
                            style={{ display: "inline-block", verticalAlign: "top" }}
                            key={`menu_game_traders_${iPlayer.value}_animated_cart_rerender_${renderCount.current}`}
                            location="Trader Supplies"
                            iPlayerOwner={iPlayer}
                            iPlayerLocal={iPlayerLocal}
                            active={!(
                              (
                                clientGameState.state == "CustomsIntro"
                                && (
                                  (clientGameState.introState == "ready" && clientGameState.localActiveTrader == false && iPlayerToNum(iPlayer) == iPlayerToNum(clientGameState.iPlayerActiveTrader))
                                  || (clientGameState.introState == "animating" && iPlayerToNum(iPlayer) == iPlayerToNum( // previous trader exiting (note no need to check this trader is officer)
                                    props.clients.incrementIndexModLength((clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader), -1)
                                  ))
                                )
                              )
                              || (
                                clientGameState.state == "Customs"
                                && (
                                  (clientGameState.customsState != "ready" && clientGameState.localActiveTrader == false && iPlayerToNum(clientGameState.iPlayerActiveTrader) == iPlayerToNum(iPlayer)
                                    && (clientGameState.customsState != "interrogating" || clientGameState.interrogatingState != "cart entering"))
                                  || (clientGameState.customsState == "ready" && clientGameState.readyState.state == "transitioning" && iPlayerToNum(iPlayer) == iPlayerToNum(clientGameState.readyState.iPlayerExitingCart))
                                )
                              )
                            )}
                            animation={animation}
                            contents={(() => {
                              switch (clientGameState.state) {
                                case "Refresh":
                                  return { labeled: false, state: "no crate" }
                                case "StrategicSwapPack":
                                case "SimpleSwapPack":
                                case "CustomsIntro":
                                case "Customs": {
                                  const cartState =
                                    (clientGameState.state == "StrategicSwapPack" || clientGameState.state == "SimpleSwapPack")
                                      ? clientGameState.otherCartStates.get(iPlayer)
                                      : clientGameState.cartStates.get(iPlayer);

                                  const isUnrevealedCustomsIntroPlayer =
                                    clientGameState.state == "CustomsIntro"
                                    && toSequentialTraderOrdering(iPlayer) >= toSequentialTraderOrdering(clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader);

                                  if (cartState.packed) {
                                    if (
                                      (clientGameState.state == "CustomsIntro" && !isUnrevealedCustomsIntroPlayer)
                                      || clientGameState.state == "Customs"
                                    ) {
                                      return {
                                        labeled: true,
                                        count: cartState.cart.count,
                                        productType: opt(cartState.cart.claimedType),
                                        state: "closed crate"
                                      };
                                    } else {
                                      return { labeled: false, state: "closed crate" };
                                    }
                                  } else {
                                    return {
                                      labeled: false,
                                      state: (() => {
                                        if (iPlayerToNum(iPlayerOfficer) == iPlayerToNum(iPlayer)) {
                                          return "no crate";
                                        } else if ((
                                          (
                                            clientGameState.state == "StrategicSwapPack"
                                            && (
                                              (clientGameState.localActiveSwapTrader === true)
                                                ? (toSequentialTraderOrdering(iPlayer) < toSequentialTraderOrdering(iPlayerLocal))
                                                : (clientGameState.iPlayerActiveSwapTrader.hasValue === false)
                                                  ? true
                                                  : (toSequentialTraderOrdering(iPlayer) < toSequentialTraderOrdering(clientGameState.iPlayerActiveSwapTrader.value))
                                            )
                                          )
                                          || (
                                            clientGameState.state == "SimpleSwapPack"
                                            && (clientGameState.otherTradersSwapping.get(iPlayer) === false)
                                          )
                                        )
                                        ) { // trader is packing
                                          return "open crate";
                                        } else { // trader is swapping, or Customs crate unpacked
                                          return "no crate";
                                        }
                                      })()
                                    };
                                  }
                                }
                              }
                            })()}
                            officerTools={{ crowbarPresent: false, stampPresent: false, controls: { localControllable: false } }}
                          />
                        </div>
                      )
                  }
                  { // status message
                    (() => {
                      switch (clientGameState.state) {
                        case "StrategicSwapPack":
                        case "SimpleSwapPack":
                          if (
                            (clientGameState.localActiveSwapTrader === true && iPlayerToNum(iPlayer) === iPlayerToNum(iPlayerLocal))
                            || (
                              (
                                clientGameState.state === "StrategicSwapPack"
                                && clientGameState.localActiveSwapTrader == false
                                && clientGameState.iPlayerActiveSwapTrader.hasValue === true
                                && iPlayerToNum(clientGameState.iPlayerActiveSwapTrader.value) == iPlayerToNum(iPlayer)
                              )
                              || (
                                clientGameState.state === "SimpleSwapPack"
                                && clientGameState.otherTradersSwapping.get(iPlayer)
                              )
                            )
                          ) {
                            return (<span>Swapping Supply Contracts<AnimatedEllipses /></span>);
                          } else if (
                            (iPlayerToNum(iPlayer) === iPlayerToNum(iPlayerLocal))
                              ? (
                                clientGameState.localOfficer === false
                                && clientGameState.localActiveSwapTrader === false
                                && clientGameState.localState === "packing"
                              )
                              : (
                                iPlayerToNum(iPlayer) !== iPlayerToNum(iPlayerOfficer)
                                && (
                                  (clientGameState.state === "SimpleSwapPack")
                                    ? clientGameState.otherTradersSwapping.get(iPlayer) === false
                                    : (clientGameState.localActiveSwapTrader === true)
                                      ? (toSequentialTraderOrdering(iPlayer) < toSequentialTraderOrdering(iPlayerLocal))
                                      : (clientGameState.iPlayerActiveSwapTrader.hasValue === false)
                                        ? true
                                        : (toSequentialTraderOrdering(iPlayer) < toSequentialTraderOrdering(clientGameState.iPlayerActiveSwapTrader.value))
                                )
                                && clientGameState.otherCartStates.get(iPlayer).packed == false
                              )
                          ) {
                            return (<span>Packing Cart<AnimatedEllipses /></span>);
                          }
                          return;

                        case "CustomsIntro":
                        case "Customs":
                        case "Refresh":
                          return;
                      }
                    })()
                  }
                  { // buttons
                    (() => {
                      if (
                        clientGameState.state == "Customs"
                        && clientGameState.customsState == "ready"
                        && clientGameState.localOfficer === true
                        && iPlayerToNum(iPlayer) !== iPlayerToNum(iPlayerLocal)
                        && clientGameState.cartStates.get(iPlayer).packed == true
                      ) {
                        return (
                          <button
                            onClick={() => {
                              clientSendClientEventToServer({
                                type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                                data: {
                                  sourceClientId: props.localInfo.clientId,
                                  action: {
                                    action: "resume interrogation",
                                    iPlayerTrader: iPlayer.value,
                                  }
                                }
                              });
                            }}
                          >
                            Interrogate
                          </button>
                        );
                      }
                      return undefined;
                    })()
                  }
                </Section>
              );
            })
            .arr
        }
      </Section>

      <Section style={{ textAlign: "center" }}>

        <Section id="menu_game_working_center" style={{ overflowX: "auto", overflowY: "hidden", whiteSpace: "nowrap", textAlign: "center" }} >
          <div style={{ display: "flex" }}>
            <Section title="Chat" style={{ display: "none", verticalAlign: "top" }}>

            </Section>

            <Section style={{ display: "inline-block", verticalAlign: "top" }} hidden>
              <div style={{ fontSize: "250%", position: "relative" }}>
                {recycleIcon}
                <div
                  id="menu_game_working_center_pools_recycle"
                  style={{ fontSize: `${Math.floor((100 / 250) * 100)}%`, opacity: 0, position: "absolute", left: `${Math.floor(50 - ((50 / 250) * 100))}%`, top: `${Math.floor(50 - ((50 / 250) * 100))}%` }}
                >
                  {recycleIcon}
                </div>
              </div>
            </Section>

            <Section id="menu_game_working_center_customs" style={{ display: "inline-block", verticalAlign: "top", flexGrow: "1" }}>
              <Section style={{ display: "inline-block", verticalAlign: "top", minWidth: "400px" }} >
                { // <Section Proposal
                  (
                    clientGameState.state == "Customs"
                    && clientGameState.customsState == "interrogating"
                    && clientGameState.proposedDeal.hasValue == true
                  )
                    ? (() => {
                      const proposedDeal = clientGameState.proposedDeal;
                      const iPlayerActiveTrader = clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader;
                      const givingList = (args: { givingIsOfficer: boolean }) => (
                        <div>
                          {
                            (args.givingIsOfficer)
                              ? (<div>Won't search {clientGameState.localActiveTrader ? "your" : `${props.clients.get(iPlayerActiveTrader).name}'s`} cart</div>)
                              : (paymentEmpty((args.givingIsOfficer) ? proposedDeal.value.officerGives : proposedDeal.value.traderGives))
                                ? (<span>Nothing</span>)
                                : undefined
                          }
                          {
                            (() => {
                              const giverGives = ((args.givingIsOfficer) ? proposedDeal.value.officerGives : proposedDeal.value.traderGives);
                              return [
                                {
                                  icon: moneyIcon,
                                  amount: giverGives.money
                                }
                              ]
                                .concat(
                                  giverGives.suppliesProducts
                                    .map((amount, p) => ({
                                      icon: productInfos.get(p).icon,
                                      amount,
                                    }))
                                    .arr
                                )
                                .filter(s => s.amount > 0)
                                .map(s => (
                                  <div>{s.amount} {s.icon}</div>
                                ))
                            })()

                          }
                        </div>
                      );
                      const localInvolved = (clientGameState.localOfficer || clientGameState.localActiveTrader);
                      const waitingOnLocal =
                        localInvolved
                        && (
                          (clientGameState.localOfficer && clientGameState.proposedDeal.value.waitingOnOfficer)
                          || (clientGameState.localActiveTrader && !clientGameState.proposedDeal.value.waitingOnOfficer)
                        );

                      return (
                        <Section
                          title={`${(
                            (localInvolved && !waitingOnLocal)
                              ? "You"
                              : props.clients.get(clientGameState.proposedDeal.value.waitingOnOfficer ? iPlayerActiveTrader : iPlayerOfficer).name
                          )} proposed deal:`
                          }
                        >
                          <Section>
                            <div>
                              <Section
                                title={clientGameState.localActiveTrader ? "You give:" : `Trader ${props.clients.get(iPlayerActiveTrader).name} gives:`}
                                style={{ display: "inline-block" }}
                              >
                                {givingList({ givingIsOfficer: false })}
                              </Section>
                              <Section
                                title={clientGameState.localOfficer ? "You give:" : `Officer ${props.clients.get(iPlayerOfficer).name} gives:`}
                                style={{ display: "inline-block" }}
                              >
                                {givingList({ givingIsOfficer: true })}
                              </Section>
                            </div>
                            {
                              (clientGameState.proposedDeal.value.message.hasValue === true)
                                ? (
                                  <Section>
                                    <ClaimMessageAnimatedRevealingText
                                      usekey={"menu_game_center_proposal_message"}
                                      initialMessage={clientGameState.proposedDeal.value.message.value}
                                      animation={nullopt}
                                    />
                                  </Section>
                                )
                                : undefined
                            }

                          </Section>

                          { // buttons
                            (waitingOnLocal)
                              ? (
                                <div>
                                  <br />
                                  <div>
                                    <button
                                      onClick={() => {
                                        clientSendClientEventToServer({
                                          type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                                          data: {
                                            sourceClientId: props.localInfo.clientId,
                                            action: {
                                              action: "reject deal"
                                            }
                                          }
                                        })
                                      }}
                                    >
                                      Reject Deal
                                    </button>
                                    <button
                                      onClick={() => {
                                        clientSendClientEventToServer({
                                          type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                                          data: {
                                            sourceClientId: props.localInfo.clientId,
                                            action: {
                                              action: "accept deal"
                                            }
                                          }
                                        })
                                      }}
                                    >
                                      Accept Deal
                                    </button>
                                  </div>
                                </div>
                              )
                              : (localInvolved)
                                ? (
                                  <div>
                                    <br />
                                    <div>
                                      Waiting for other player to respond<AnimatedEllipses />
                                    </div>
                                  </div>
                                )
                                : undefined
                          }
                        </Section>
                      );
                    })()
                    : undefined
                }
              </Section>

              { // <Section Suspect Cart
                (() => {
                  const { active, staticActive, iPlayerSuspect, suspectCart } = (() => {
                    const inactive = {
                      active: false,
                      staticActive: false,
                      iPlayerSuspect: 0 as 0,
                      suspectCart: {
                        count: 1,
                        claimedType: ProductType.MILK,
                        products: [ProductType.MILK],
                        claimMessage: nullopt,
                      }
                    };

                    const expectPackedCart = (s: CartState) => {
                      if (s.packed == false) {
                        // TODO unexpected
                        console.log(`clientGameState's active trader has an unpacked cart:`);
                        console.log(clientGameState);
                        return undefined;
                      }
                      return s.cart;
                    };

                    if ((clientGameState.state == "CustomsIntro" && clientGameState.introState == "ready")
                      || (clientGameState.state == "Customs" && clientGameState.customsState != "ready" && (clientGameState.customsState != "interrogating" || clientGameState.interrogatingState != "cart entering"))
                    ) {
                      const iPlayerSuspect = clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader;
                      return {
                        active: true,
                        staticActive: true,
                        iPlayerSuspect,
                        suspectCart: expectPackedCart(clientGameState.cartStates.get(iPlayerSuspect))
                      }
                    } else if (clientGameState.state == "CustomsIntro" && clientGameState.introState == "animating") {
                      const iPlayerSuspect = props.clients.incrementIndexModLength((clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader), -1);
                      if (iPlayerToNum(iPlayerSuspect) == iPlayerToNum(iPlayerOfficer)) {
                        // nope
                        return inactive;
                      } else {
                        return {
                          active: true,
                          staticActive: false,
                          iPlayerSuspect,
                          suspectCart: expectPackedCart(clientGameState.cartStates.get(iPlayerSuspect))
                        }
                      }
                    } else if (clientGameState.state == "Customs" && clientGameState.customsState == "ready" && clientGameState.readyState.state == "transitioning") {
                      const iPlayerSuspect = clientGameState.readyState.iPlayerExitingCart;
                      return {
                        active: true,
                        staticActive: false,
                        iPlayerSuspect,
                        suspectCart: expectPackedCart(clientGameState.cartStates.get(iPlayerSuspect))
                      }
                    } else {
                      return inactive;
                    }
                  })();

                  const cartContents: CartContents = {
                    labeled: true,
                    count: suspectCart !== undefined ? suspectCart.count : 0,
                    productType: suspectCart !== undefined ? opt(suspectCart.claimedType) : nullopt,
                    state: "closed crate"
                  };

                  return (
                    <Section style={{ display: "inline-block", verticalAlign: "top" }}>
                      <Section
                        title={
                          !staticActive
                            ? ""
                            : (clientGameState.state == "Customs" && clientGameState.customsState == "resolving" && clientGameState.result.result == "ignored")
                              ? `${iPlayerToNum(iPlayerSuspect) == iPlayerToNum(iPlayerLocal) ? "You" : props.clients.get(iPlayerSuspect).name} allowed through!`
                              : `${clientGameState.state == "CustomsIntro" ? "Interviewing" : "Interrogating"} ${iPlayerToNum(iPlayerSuspect) == iPlayerToNum(iPlayerLocal) ? "you" : props.clients.get(iPlayerSuspect).name}`
                        }
                        style={{ opacity: active ? 1 : 0 }}>
                        <FloatingAnimatedCart
                          key={`menu_game_suspect_cart_animated_cart_rerender_${renderCount.current}`}
                          location="Suspect Cart Area"
                          iPlayerOwner={iPlayerSuspect}
                          iPlayerLocal={iPlayerLocal}
                          active={active}
                          contents={cartContents}
                          animation={animation}
                          officerTools={(
                            (!(
                              active
                              && clientGameState.state == "Customs"
                              && clientGameState.customsState === "interrogating"
                            ))
                              ? { crowbarPresent: false, stampPresent: false, controls: { localControllable: false } }
                              : (clientGameState.crowbarSelected === false)
                                ? {
                                  crowbarPresent: false,
                                  stampPresent: clientGameState.entryVisaVisible,
                                  controls: { localControllable: false }
                                }
                                : {
                                  crowbarPresent: true,
                                  stampPresent: clientGameState.entryVisaVisible,
                                  controls:
                                    (iPlayerToNum(iPlayerLocal) === iPlayerToNum(iPlayerOfficer))
                                      ? {
                                        localControllable: true,
                                        onInternalOfficerToolUpdate: (() => {
                                          // buffer these events to avoid spamming server
                                          let newUpdateToSend: Optional<NetworkTypes.OfficerToolsState> = nullopt;
                                          let sendState: (
                                            | { queued: false, lastSendTimeMs: number }
                                            | { queued: true, timeout: NodeJS.Timeout }
                                          ) =
                                            { queued: false, lastSendTimeMs: 0 };
                                          let fullyUsedCrowbarEventSent = false;
                                          const sendTheNewToolStateToSend = () => {
                                            const sendingUpdate = newUpdateToSend;
                                            sendState = { queued: false, lastSendTimeMs: Date.now() };
                                            if (sendingUpdate.hasValue === false) return;

                                            if (!fullyUsedCrowbarEventSent) {
                                              clientSendClientEventToServer({
                                                type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                                                data: {
                                                  sourceClientId: props.localInfo.clientId,
                                                  action: {
                                                    action: "officer tool update",
                                                    update: {
                                                      toolsUpdates: sendingUpdate.value,
                                                    }
                                                  }
                                                }
                                              });

                                              if (sendingUpdate.value.crowbar.hasValue === true
                                                && sendingUpdate.value.crowbar.value.useProgress >= 1
                                              ) {
                                                fullyUsedCrowbarEventSent = true;
                                                clientSendClientEventToServer({
                                                  type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                                                  data: {
                                                    sourceClientId: props.localInfo.clientId,
                                                    action: {
                                                      action: "search cart"
                                                    }
                                                  }
                                                });
                                              }
                                            }
                                          };

                                          return (event) => {
                                            newUpdateToSend = opt(event.toolsUpdates);
                                            if (event.sendUpdateNow) {
                                              if (sendState.queued === true) {
                                                clearTimeout(sendState.timeout);
                                              }
                                              sendTheNewToolStateToSend();
                                            } else if (sendState.queued == false) {
                                              const minimumRepeatSendIntervalMs = officerToolUpdateMinIntervalMs;
                                              const intervalSinceLastSend = Date.now() - sendState.lastSendTimeMs;
                                              if (intervalSinceLastSend < minimumRepeatSendIntervalMs && !event.sendUpdateNow) {
                                                sendState = {
                                                  queued: true,
                                                  timeout: setTimeout(sendTheNewToolStateToSend, (minimumRepeatSendIntervalMs - intervalSinceLastSend))
                                                };
                                              } else {
                                                sendTheNewToolStateToSend();
                                              }
                                            }
                                          };
                                        })()
                                      }
                                      : {
                                        localControllable: false,
                                        eventHandling: {
                                          registerEventHandlers: (args) => {
                                            onExternalOfficerToolUpdateRegistrations.push(opt(args.onExternalOfficerToolUpdate));
                                            return { handlerRegistrationId: onExternalOfficerToolUpdateRegistrations.length - 1 };
                                          },
                                          unregisterEventHandlers: (handlerRegistrationId) => {
                                            onExternalOfficerToolUpdateRegistrations[handlerRegistrationId] = nullopt;
                                          },
                                        }
                                      }
                                }
                          )}
                        />
                      </Section>

                      <div
                        id="menu_game_working_center_customs_cart_claim_message"
                      >
                        <ClaimMessageAnimatedRevealingText
                          key={`menu_game_customs_claim_message_rerender_${renderCount.current}`}
                          usekey={`menu_game_customs_claim_message`}
                          animation={animation}
                        />
                      </div>

                      <div id="menu_game_working_center_customs_cart_buttons">
                        {
                          (() => {
                            if (
                              !staticActive
                              || !(clientGameState.state == "CustomsIntro" || clientGameState.state == "Customs")
                              || clientGameState.localOfficer == false) {
                              return undefined;
                            }
                            if (clientGameState.state == "CustomsIntro") {
                              const nextIntroTrader = props.clients.incrementIndexModLength(clientGameState.iPlayerActiveTrader, 1);
                              return (
                                <button
                                  hidden={clientGameState.introState != "ready"}
                                  onClick={() => {
                                    clientSendClientEventToServer({
                                      type: NetworkTypes.ClientEventType.ADVANCE_CUSTOMS_INTRO,
                                      data: {
                                        sourceClientId: props.localInfo.clientId
                                      }
                                    });
                                  }}
                                >
                                  {(iPlayerToNum(nextIntroTrader) == iPlayerToNum(iPlayerLocal)) ? "Begin Interrogations" : "Interview Next Trader"}
                                </button>
                              );
                            } else { // Customs
                              return (
                                <div hidden={clientGameState.customsState == "resolving"}>
                                  <div>
                                    <button
                                      style={{ display: "inline-block" }}
                                      disabled={clientGameState.customsState !== "interrogating" || clientGameState.crowbarSelected === true}
                                      onClick={() => {
                                        clientSendClientEventToServer({
                                          type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                                          data: {
                                            sourceClientId: props.localInfo.clientId,
                                            action: {
                                              action: "prepare tool",
                                              tool: "crowbar",
                                            }
                                          }
                                        });
                                      }}
                                    >
                                      Prepare Crowbar for Search
                                    </button>
                                  </div>
                                  <div>
                                    <span style={{ display: "inline-block" }}>or{" "}</span>
                                    <button
                                      style={{ display: "inline-block" }}
                                      disabled={clientGameState.customsState !== "interrogating" || clientGameState.entryVisaVisible === true}
                                      onClick={() => {
                                        clientSendClientEventToServer({
                                          type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                                          data: {
                                            sourceClientId: props.localInfo.clientId,
                                            action: {
                                              action: "prepare tool",
                                              tool: "stamp",
                                            }
                                          }
                                        });
                                      }}
                                    >
                                      Prepare Visa for Entry
                                    </button>
                                  </div>
                                  <div hidden={clientGameState.cartStates.arr.filter(s => s.packed == true).length == 1}>
                                    <span style={{ display: "inline-block" }}>or{" "}</span>
                                    <button
                                      style={{ display: "inline-block" }}
                                      onClick={() => {
                                        clientSendClientEventToServer({
                                          type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                                          data: {
                                            sourceClientId: props.localInfo.clientId,
                                            action: {
                                              action: "pause interrogation"
                                            }
                                          }
                                        });
                                      }}
                                    >
                                      Interrogate Someone Else
                                    </button>
                                  </div>
                                </div>
                              );
                            }
                          })()
                        }
                      </div>
                    </Section>
                  );
                })()
              }

              <Section style={{ display: "inline-block", verticalAlign: "top", minWidth: "400px" }}>
                { // <Section Entry Visa
                  (
                    clientGameState.state == "Customs"
                    && (
                      clientGameState.customsState == "resolving"
                      || clientGameState.customsState === "interrogating"
                    )
                  )
                    ? (() => {
                      const iPlayerActiveTrader = clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader;
                      const activeCart = clientGameState.cartStates.get(iPlayerActiveTrader);
                      if (activeCart.packed == false) {
                        // TODO fix shouldn't happen
                        return (<div></div>);
                      }


                      const cartOfficerToolsProps: CartOfficerToolsProps = (
                        {
                          crowbarPresent: clientGameState.customsState === "interrogating" && clientGameState.crowbarSelected === true,
                          stampPresent: (
                            (clientGameState.customsState === "resolving" && clientGameState.result.resultState.resultState === "confirming")
                            || (clientGameState.customsState === "interrogating" && clientGameState.entryVisaVisible === true)
                          ),
                          controls:
                            (iPlayerToNum(iPlayerLocal) == iPlayerToNum(iPlayerOfficer))
                              ? {
                                localControllable: true,
                                onInternalOfficerToolUpdate: (() => {
                                  // buffer these events to avoid spamming server
                                  let newUpdateToSend: Optional<NetworkTypes.OfficerToolsState> = nullopt;
                                  let sendState: (
                                    | { queued: false, lastSendTimeMs: number }
                                    | { queued: true, timeout: NodeJS.Timeout }
                                  ) =
                                    { queued: false, lastSendTimeMs: 0 };
                                  let fullyUsedStampEventSent = false;
                                  const sendTheNewToolStateToSend = () => {
                                    const sendingUpdate = newUpdateToSend;
                                    sendState = { queued: false, lastSendTimeMs: Date.now() };
                                    if (sendingUpdate.hasValue === false) return;

                                    if (!fullyUsedStampEventSent) {
                                      clientSendClientEventToServer({
                                        type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                                        data: {
                                          sourceClientId: props.localInfo.clientId,
                                          action: {
                                            action: "officer tool update",
                                            update: {
                                              toolsUpdates: sendingUpdate.value,
                                            }
                                          }
                                        }
                                      });

                                      if (sendingUpdate.value.stamp.hasValue === true
                                        && sendingUpdate.value.stamp.value.state === "not held"
                                        && sendingUpdate.value.stamp.value.stamps.length > 0
                                      ) {
                                        fullyUsedStampEventSent = true;
                                        const stamp = sendingUpdate.value.stamp.value;
                                        setTimeout(
                                          () => clientSendClientEventToServer({
                                            type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                                            data: {
                                              sourceClientId: props.localInfo.clientId,
                                              action: {
                                                action: (
                                                  (clientGameState.customsState === "interrogating")
                                                    ? "ignore cart"
                                                    : "confirm resolve"
                                                ),
                                                entryVisaStamps: stamp.stamps,
                                              }
                                            }
                                          }),
                                          500
                                        );
                                      }
                                    }
                                  };

                                  return (event) => {
                                    newUpdateToSend = opt(event.toolsUpdates);
                                    if (event.sendUpdateNow) {
                                      if (sendState.queued === true) {
                                        clearTimeout(sendState.timeout);
                                      }
                                      sendTheNewToolStateToSend();
                                    } else if (sendState.queued == false) {
                                      const minimumRepeatSendIntervalMs = officerToolUpdateMinIntervalMs;
                                      const intervalSinceLastSend = Date.now() - sendState.lastSendTimeMs;
                                      if (intervalSinceLastSend < minimumRepeatSendIntervalMs && !event.sendUpdateNow) {
                                        sendState = {
                                          queued: true,
                                          timeout: setTimeout(sendTheNewToolStateToSend, (minimumRepeatSendIntervalMs - intervalSinceLastSend))
                                        };
                                      } else {
                                        sendTheNewToolStateToSend();
                                      }
                                    }
                                  };
                                })()
                              }
                              : {
                                localControllable: false,
                                eventHandling: {
                                  registerEventHandlers: ((args) => {
                                    onExternalOfficerToolUpdateRegistrations.push(opt(args.onExternalOfficerToolUpdate));
                                    return { handlerRegistrationId: onExternalOfficerToolUpdateRegistrations.length - 1 };
                                  }),
                                  unregisterEventHandlers: ((handlerRegistrationId) => {
                                    onExternalOfficerToolUpdateRegistrations[handlerRegistrationId] = nullopt;
                                  }),
                                }
                              }
                        }
                      );

                      const stamps = (
                        (clientGameState.customsState === "resolving" && clientGameState.result.resultState.resultState === "continuing")
                          ? clientGameState.result.resultState.entryVisaStamps
                          : []
                      );

                      if (clientGameState.customsState === "resolving" && clientGameState.result.result == "searched") {
                        return (
                          <EntryVisa
                            key={`menu_game_payment_area_rerender_${renderCount.current}`}
                            title={activeCart.cart.products.every(p => p == activeCart.cart.claimedType) ? "Trader unreasonably searched!" : "Smuggling caught!"}
                            buildVisaBodyEle={(args) => {
                              const paymentData = args.paymentsData[0];
                              if (paymentData === undefined || args.paymentsData.length > 1) {
                                // unexpected!
                                console.log(`Unexpected payments data for a search situation:`);
                                console.log(JSON.stringify(args.paymentsData));
                                return <div>An error occurred.</div>;
                              }
                              if (iPlayerToNum(paymentData.payment.iPlayerGiver) === iPlayerToNum(iPlayerOfficer)) {
                                return (
                                  <div>
                                    {args.buildVisaTextEle({
                                      includesHeader: true,
                                      visaText:
                                        `Incident Report #${clientGameState.counters.incidentReport}
                                    
                                        The individual known as
                                        ${props.clients.get(iPlayerActiveTrader).name}
                                        is hereby permitted to enter
                                        and conduct business in
                                        ${props.settings.cityName},
                                        having been compensated for unlawful search 
                                        in compliance with Trade Code § 438-29, 
                                        paid at the scene in the amount of:`
                                    })}
                                    {paymentData.givingListEle}
                                  </div>
                                );
                              } else if (iPlayerToNum(paymentData.payment.iPlayerGiver) === iPlayerToNum(iPlayerActiveTrader)) {
                                return (
                                  <div>
                                    {args.buildVisaTextEle({
                                      includesHeader: true,
                                      visaText:
                                        `Incident Report #${clientGameState.counters.incidentReport}
                                    
                                        The individual known as
                                        ${props.clients.get(iPlayerActiveTrader).name},
                                        having issued a false statement 
                                        in violation of Trade Code § 438-12, 
                                        is granted conditional entry to
                                        ${props.settings.cityName}
                                        subject to immediate disposal of
                                        ${activeCart.cart.products
                                          .groupBy(p => p)
                                          .filter(g => g.key !== activeCart.cart.claimedType)
                                          .map(g => (`${getProductInfo(g.key).icon}${g.group.length}`))
                                          .join(", ")
                                        }
                                        and fines paid in the amount of:`
                                    })}
                                    {paymentData.givingListEle}
                                  </div>
                                );
                              } else { // another player?
                                // unexpected!
                                console.log(`Unexpected payments data for a search situation:`);
                                console.log(JSON.stringify(args.paymentsData));
                                return <div>An error occurred.</div>;
                              }
                            }}
                            animation={animation}
                            officerTools={cartOfficerToolsProps}
                            stampIcon={props.clients.get(iPlayerOfficer).icon}
                            stamps={stamps}
                          />
                        );
                      } else if (clientGameState.customsState === "resolving" && clientGameState.result.result == "ignored for deal") { // deal struck
                        return (
                          <EntryVisa
                            key={`menu_game_payment_area_rerender_${renderCount.current}`}
                            title={"Deal accepted!"}
                            buildVisaBodyEle={(args) => {
                              const traderPaymentData = args.paymentsData.filter(d => iPlayerToNum(d.payment.iPlayerGiver) === iPlayerToNum(iPlayerActiveTrader))[0];
                              const officerPaymentData = args.paymentsData.filter(d => iPlayerToNum(d.payment.iPlayerGiver) === iPlayerToNum(iPlayerOfficer))[0];
                              if (
                                (traderPaymentData === undefined && officerPaymentData === undefined)
                                || args.paymentsData.some(d => !(d === traderPaymentData || d === officerPaymentData))
                              ) {
                                // unexpected!
                                console.log(`Unexpected payments data for a ignore for deal situation:`);
                                console.log(JSON.stringify(args.paymentsData));
                                return <div>An error occurred.</div>;
                              }

                              return (
                                <div>
                                  {args.buildVisaTextEle({
                                    includesHeader: true,
                                    visaText:
                                      `Special Entry Visa #${clientGameState.counters.entryVisa}
                                
                                      The individual known as
                                      ${props.clients.get(iPlayerActiveTrader).name}
                                      is hereby permitted to enter 
                                      and conduct business in 
                                      ${props.settings.cityName},`
                                  })}
                                  {
                                    (() => {
                                      if (traderPaymentData !== undefined) {
                                        return (
                                          <div>
                                            {args.buildVisaTextEle({
                                              includesHeader: false,
                                              visaText:
                                                `having paid the required border control 
                                                administrative fee in the amount of:`
                                            })}
                                            {traderPaymentData.givingListEle}
                                            {
                                              (officerPaymentData !== undefined)
                                                ? (
                                                  <div>
                                                    {args.buildVisaTextEle({
                                                      includesHeader: false,
                                                      visaText:
                                                        `with change given in the amount of:`
                                                    })}
                                                    {officerPaymentData.givingListEle}
                                                  </div>
                                                )
                                                : undefined
                                            }
                                          </div>
                                        )
                                      } else if (officerPaymentData !== undefined) { // only officer pays
                                        return (
                                          <div>
                                            {args.buildVisaTextEle({
                                              includesHeader: false,
                                              visaText:
                                                `having been paid good behavior credits 
                                                in the amounts of:`
                                            })}
                                            {officerPaymentData?.givingListEle}
                                          </div>
                                        )
                                      } else { // TODO fix should never happen with if statement above
                                        return (<div></div>)
                                      }
                                    })()
                                  }
                                  {
                                    (clientGameState.result.result === "ignored for deal" && clientGameState.result.deal.message.hasValue === true)
                                      ? (
                                        <div>
                                          {args.buildVisaTextEle({
                                            includesHeader: false,
                                            visaText:
                                              `and, as stipulated by ${props.clients.get(clientGameState.result.dealProposedByOfficer ? iPlayerOfficer : iPlayerActiveTrader).name}:
                                              ${splitIntoLines(
                                                clientGameState.result.deal.message.value,
                                                (() => {
                                                  const headerLines = 15; // N
                                                  const headerCharsPerLine = 40; // M
                                                  const messageLength = clientGameState.result.deal.message.value.length; // C
                                                  /*
                                                   * The below is this equation (which models the entry visa text geometry), solved for charsPerLine:
                                                   * (headerLines + (messageLength / charsPerLine)) * (headerCharsPerLine / headerLines) = charsPerLine
                                                   */
                                                  return Math.max(40, (
                                                    (headerCharsPerLine / 2)
                                                    + (
                                                      (
                                                        Math.sqrt(headerCharsPerLine)
                                                        * Math.sqrt(
                                                          (4 * messageLength)
                                                          + (headerCharsPerLine * headerLines)
                                                        )
                                                      )
                                                      / (2 * Math.sqrt(headerLines))
                                                    )
                                                  ));

                                                })()
                                              ).join("\n")}`
                                          })}
                                          <br />
                                        </div>
                                      )
                                      : undefined
                                  }
                                </div>
                              )
                            }}
                            animation={animation}
                            officerTools={cartOfficerToolsProps}
                            stampIcon={props.clients.get(iPlayerOfficer).icon}
                            stamps={stamps}
                          />
                        );
                      } else { // ignored or about to ignore
                        return (
                          <div
                            style={{
                              opacity: (clientGameState.customsState === "resolving" || clientGameState.entryVisaVisible === true) ? 1 : 0
                            }}
                          >
                            <EntryVisa
                              key={`menu_game_payment_area_rerender_${renderCount.current}`}
                              title={"Entry Visa"}
                              buildVisaBodyEle={(args) => {
                                if (args.paymentsData.length > 0) {
                                  // unexpected!
                                  console.log(`Unexpected payments data for an ignore situation:`);
                                  console.log(JSON.stringify(args.paymentsData));
                                  return <div>An error occurred.</div>;
                                }

                                return (
                                  <div>
                                    {args.buildVisaTextEle({
                                      includesHeader: true,
                                      visaText:
                                        `Entry Visa #${clientGameState.counters.entryVisa}
                                    
                                      The individual known as
                                      ${props.clients.get(iPlayerActiveTrader).name}
                                      is hereby permitted to enter
                                      and conduct business in
                                      ${props.settings.cityName},
                                      recognized as being in
                                      full complicance
                                      with Trade Code § 438.
                                      `
                                    })}
                                  </div>
                                );
                              }}
                              animation={animation}
                              officerTools={cartOfficerToolsProps}
                              stampIcon={props.clients.get(iPlayerOfficer).icon}
                              stamps={stamps}
                            />
                          </div>
                        );
                      }
                    })()
                    : undefined
                }
              </Section>
            </Section>
          </div>
        </Section>
        <Section id="menu_game_working_prep" style={{ overflowX: "auto", overflowY: "hidden", whiteSpace: "nowrap", textAlign: "center" }} >
          { // <Section Claim Cart Contents
            (
              clientGameState.localOfficer == false
              && (clientGameState.state == "StrategicSwapPack" || clientGameState.state === "SimpleSwapPack")
              && clientGameState.localActiveSwapTrader === false
              && clientGameState.localState == "packing"
            )
              ? (
                <Section
                  title="Prepare Customs Statement"
                  style={{
                    display: "inline-block",
                    verticalAlign: "top"
                  }}
                >
                  The law only allows traders to carry one type of product when entering the city.
                  <br />
                  Select the type of {legalProductIcon}legal product that you will claim is in your cart:
                  <br />
                  <select
                    onChange={(e) => {
                      setClientGameState({
                        ...clientGameState,
                        claimedProductType: {
                          hasValue: true,
                          value: productInfos.arr.filter(p => p.type == parseInt(e.target.value))[0]?.type ?? ProductType.MILK
                        }
                      })
                    }}
                  >
                    <option disabled selected value=""> -- select -- </option>
                    {
                      productInfos.arr
                        .filter(p => p.legal)
                        .map((p) => (
                          <option key={`menu_game_working_prep_claim_type_option_${p.type}`} value={p.type}>{p.icon}</option>
                        ))
                    }
                  </select>
                  <br />
                  <textarea
                    rows={3}
                    cols={30}
                    onChange={e => setClientGameState({
                      ...clientGameState,
                      claimMessage: e.target.value.length <= 1000 ? e.target.value : clientGameState.claimMessage
                    })}
                    value={clientGameState.claimMessage}
                    placeholder="Write an additional message for the customs officer..."
                  />
                </Section>
              )
              : undefined
          }
          { // <Section WIP Deal
            (
              clientGameState.state == "Customs"
              && clientGameState.customsState == "interrogating"
              && clientGameState.interrogatingState == "ready"
              && (clientGameState.localOfficer == true || clientGameState.localActiveTrader == true)
            )
              ? (
                <Section
                  title={clientGameState.localWipDeal.hasValue ? "Strike a Deal" : undefined}
                  style={{ display: "inline-block", verticalAlign: "top" }}
                >
                  {
                    (() => {
                      const iPlayerActiveTrader = clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader;
                      const iPlayerOfficer = clientGameState.localOfficer == true ? iPlayerLocal : clientGameState.iPlayerOfficer;

                      const PrepDeal = (prepDealProps: {
                        onProposeDeal: (args: { deal: IgnoreDeal }) => void
                      }) => {
                        const [wipDeal, setWipDeal] = React.useState<Optional<IgnoreDeal>>(nullopt);

                        if (wipDeal.hasValue == false) {
                          const proposedDeal = clientGameState.proposedDeal;
                          return (
                            <div>
                              <button
                                onClick={() => {
                                  setWipDeal(opt({
                                    officerGives: {
                                      money: 0,
                                      suppliesProducts: productInfos.map(() => 0),
                                    },
                                    traderGives: {
                                      money: 0,
                                      suppliesProducts: productInfos.map(() => 0),
                                    },
                                    message: nullopt
                                  }));
                                }}
                              >
                                Propose a Deal
                              </button>
                              {
                                (proposedDeal.hasValue == true)
                                  ? (
                                    <button
                                      onClick={() => {
                                        setWipDeal(opt(proposedDeal.value));
                                      }}
                                    >
                                      Edit Proposed Deal
                                    </button>
                                  )
                                  : undefined
                              }
                            </div>
                          );
                        } else {
                          const GiveInterface = (giveInterfaceProps: { giverIsOfficer: boolean, giverSupplies: TraderSupplies }) => (
                            <div>
                              {
                                giveInterfaceProps.giverIsOfficer
                                  ? (
                                    <span>
                                      Won't search {props.clients.get(iPlayerActiveTrader).name}'s cart
                                    </span>
                                  )
                                  : undefined
                              }
                              {
                                (() => {
                                  const [someoneGivingSupplies, nobodyGivingSupplies] = (
                                    (
                                      [
                                        {
                                          ordering: 0,
                                          icon: moneyIcon,
                                          id: -1,
                                          maxGivingAmount: giveInterfaceProps.giverSupplies.money,
                                          officerGiving: {
                                            giveable: true,
                                            currentAmount: wipDeal.value.officerGives.money,
                                            set: (newAmount) => {
                                              setWipDeal(opt({
                                                ...wipDeal.value,
                                                officerGives: { ...wipDeal.value.officerGives, money: newAmount }
                                              }))
                                            }
                                          },
                                          traderGiving: {
                                            giveable: true,
                                            currentAmount: wipDeal.value.traderGives.money,
                                            set: (newAmount) => {
                                              setWipDeal(opt({
                                                ...wipDeal.value,
                                                traderGives: { ...wipDeal.value.traderGives, money: newAmount }
                                              }))
                                            }
                                          }
                                        }
                                      ] as {
                                        ordering: number,
                                        icon: string,
                                        id: number,
                                        maxGivingAmount: number
                                        officerGiving:
                                        | { giveable: false }
                                        | { giveable: true, currentAmount: number, set: (newAmount: number) => void }
                                        traderGiving:
                                        | { giveable: false }
                                        | { giveable: true, currentAmount: number, set: (newAmount: number) => void }
                                      }[]
                                    )
                                      .concat(
                                        productInfos
                                          .zip(wipDeal.value.officerGives.suppliesProducts)
                                          .zip(wipDeal.value.traderGives.suppliesProducts)
                                          .zip(giveInterfaceProps.giverSupplies.shopProductCounts)
                                          .map(([[[info, officerGiveCount], traderGiveCount], giverSuppliesCount]) => ({ info, officerGiveCount, traderGiveCount, giverSuppliesCount }))
                                          .arr
                                          .filter((p) => p.info.legal)
                                          .map((p) => ({
                                            ordering: 1 + (.001 * p.info.type),
                                            icon: p.info.icon,
                                            id: p.info.type,
                                            maxGivingAmount: p.giverSuppliesCount,
                                            officerGiving: {
                                              giveable: true,
                                              currentAmount: p.officerGiveCount,
                                              set: (newAmount: number) => {
                                                setWipDeal(opt({
                                                  ...wipDeal.value,
                                                  officerGives: {
                                                    ...wipDeal.value.officerGives,
                                                    suppliesProducts: wipDeal.value.officerGives.suppliesProducts.shallowCopy().set(p.info.type, newAmount)
                                                  }
                                                }))
                                              }
                                            },
                                            traderGiving: {
                                              giveable: true,
                                              currentAmount: p.traderGiveCount,
                                              set: (newAmount: number) => {
                                                setWipDeal(opt({
                                                  ...wipDeal.value,
                                                  traderGives: {
                                                    ...wipDeal.value.traderGives,
                                                    suppliesProducts: wipDeal.value.traderGives.suppliesProducts.shallowCopy().set(p.info.type, newAmount)
                                                  }
                                                }))
                                              }
                                            },
                                          }))
                                      )
                                      .map(s => // map officer/trading to current/other
                                        (
                                          (giveInterfaceProps.giverIsOfficer)
                                            ? {
                                              ...s,
                                              currentGiving: (s.maxGivingAmount < 1) ? { giveable: false } : s.officerGiving,
                                              otherGiving: s.traderGiving,
                                            }
                                            : {
                                              ...s,
                                              currentGiving: (s.maxGivingAmount < 1) ? { giveable: false } : s.traderGiving,
                                              otherGiving: s.officerGiving,
                                            }
                                        ) as {
                                          ordering: number,
                                          icon: string,
                                          id: number,
                                          maxGivingAmount: number
                                          officerGiving:
                                          | { giveable: false }
                                          | { giveable: true, currentAmount: number, set: (newAmount: number) => void }
                                          traderGiving:
                                          | { giveable: false }
                                          | { giveable: true, currentAmount: number, set: (newAmount: number) => void }
                                          currentGiving:
                                          | { giveable: false }
                                          | { giveable: true, currentAmount: number, set: (newAmount: number) => void }
                                          otherGiving:
                                          | { giveable: false }
                                          | { giveable: true, currentAmount: number, set: (newAmount: number) => void }
                                        }
                                      )
                                      .split(s =>
                                        (s.currentGiving.giveable == true && s.currentGiving.currentAmount > 0)
                                        || (s.otherGiving.giveable == true && s.otherGiving.currentAmount > 0)
                                      )
                                  );
                                  console.log("Someone giving: ");
                                  console.log(JSON.stringify(someoneGivingSupplies));
                                  console.log("Nobody giving: ");
                                  console.log(JSON.stringify(nobodyGivingSupplies));
                                  const giveableSupplies = (
                                    nobodyGivingSupplies
                                      .sort((a, b) => a.ordering - b.ordering)
                                      .filterTransform((s) =>
                                        (s.currentGiving.giveable == true || s.otherGiving.giveable == true)
                                          ? opt({
                                            id: s.id,
                                            icon: s.icon,
                                            currentGiving: s.currentGiving,
                                          })
                                          : nullopt
                                      )
                                  );

                                  return (
                                    someoneGivingSupplies
                                      .sort((a, b) => a.ordering - b.ordering)
                                      .map(s => {
                                        const giving = s.currentGiving.giveable == true && s.currentGiving.currentAmount > 0;
                                        return (
                                          <div
                                            key={`menu_game_working_prep_deal_giving_officer_${giveInterfaceProps.giverIsOfficer}_selector_${s.id}`}
                                            style={{ opacity: giving ? 1 : 0 }}
                                          >
                                            <span>{s.icon}</span>
                                            <input
                                              disabled={!giving}
                                              type="number"
                                              min="1"
                                              value={s.currentGiving.giveable == true ? s.currentGiving.currentAmount : 1}
                                              max={s.maxGivingAmount}
                                              onChange={(e) => { if (s.currentGiving.giveable == true) s.currentGiving.set(parseInt(e.target.value)); }}
                                            />
                                            <button
                                              disabled={!giving}
                                              onClick={() => { if (s.currentGiving.giveable == true) s.currentGiving.set(0); }}
                                            >
                                              ❌
                                            </button>
                                          </div>
                                        );
                                      })
                                      .concat(giveableSupplies.length == 0 ? [] : [(
                                        <div>
                                          <select
                                            onChange={(e) =>
                                              (giveableSupplies
                                                .filterTransform(s => s.id == parseInt(e.target.value) && s.currentGiving.giveable === true ? opt(s.currentGiving.set) : nullopt)
                                              [0] ?? (() => { }))(1)
                                            }
                                          >
                                            <option disabled selected value=""></option>
                                            {
                                              giveableSupplies
                                                .filter(s => s.currentGiving.giveable)
                                                .map(s => (
                                                  <option
                                                    key={`menu_game_working_prep_deal_giving_officer_${giveInterfaceProps.giverIsOfficer}_item_${s.id}`}
                                                    value={s.id}
                                                  >
                                                    {s.icon}
                                                  </option>
                                                ))
                                            }
                                          </select>
                                        </div>
                                      )])
                                  );
                                })()
                              }
                            </div>
                          );

                          return (
                            <div>
                              <Section>
                                <div>
                                  <Section
                                    title={`Trader ${props.clients.get(iPlayerActiveTrader).name} Gives:`}
                                    style={{ display: "inline-block" }}
                                  >
                                    <GiveInterface
                                      giverIsOfficer={false}
                                      giverSupplies={currentTraderSupplies.get(iPlayerActiveTrader)}
                                    />
                                  </Section>
                                  <Section
                                    title={`Officer ${props.clients.get(iPlayerOfficer).name} Gives:`}
                                    style={{ display: "inline-block" }}
                                  >
                                    <GiveInterface
                                      giverIsOfficer={true}
                                      giverSupplies={currentTraderSupplies.get(iPlayerOfficer)}
                                    />
                                  </Section>
                                </div>
                                <textarea
                                  rows={3}
                                  cols={30}
                                  onChange={e => setWipDeal(opt({
                                    ...wipDeal.value,
                                    message:
                                      (e.target.value.trim() === "")
                                        ? nullopt
                                        : opt(e.target.value.substring(0, 1000))
                                  }))
                                  }
                                  value={optValueOr(wipDeal.value.message, "")}
                                  placeholder="Include an additional message..."
                                />
                              </Section>
                              <div id={`menu_game_working_prep_deal_prep_deal_buttons`}>
                                <button onClick={() => { setWipDeal(nullopt); }} >
                                  Go Back
                                </button>
                                <button onClick={() => { prepDealProps.onProposeDeal({ deal: wipDeal.value }); }} >
                                  Propose Deal
                                </button>
                                {
                                  (clientGameState.proposedDeal.hasValue == true)
                                    ? (
                                      <button onClick={(() => { setWipDeal(clientGameState.proposedDeal); })} >
                                        Copy Proposed Deal
                                      </button>
                                    )
                                    : undefined
                                }
                              </div>
                            </div>
                          );
                        }
                      };

                      return (
                        <PrepDeal
                          onProposeDeal={({ deal }) => {
                            clientSendClientEventToServer({
                              type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                              data: {
                                sourceClientId: props.localInfo.clientId,
                                action: {
                                  action: "propose deal",
                                  deal: {
                                    officerGives: {
                                      money: deal.officerGives.money,
                                      suppliesProducts: deal.officerGives.suppliesProducts.arr,
                                    },
                                    traderGives: {
                                      money: deal.traderGives.money,
                                      suppliesProducts: deal.traderGives.suppliesProducts.arr,
                                    },
                                    message: deal.message,
                                  }
                                }
                              }
                            });
                          }}
                        />
                      );
                    })()
                  }
                </Section>
              )
              : undefined
          }
        </Section>

      </Section>

      <Section title={`Your Stuff (${props.localInfo.localPlayerName})`} style={{ overflowX: "auto", overflowY: "hidden", whiteSpace: "nowrap", textAlign: "center" }}>
        <div>
          <Section
            key="menu_game_local_ready_pool"
            title={(
              ((clientGameState.state == "StrategicSwapPack" || clientGameState.state === "SimpleSwapPack") && clientGameState.localActiveSwapTrader === true)
              || ((clientGameState.state == "StrategicSwapPack" || clientGameState.state === "SimpleSwapPack") && clientGameState.localOfficer == false && clientGameState.localState == "packing"))
              ? undefined : "Supply Contracts"}
            style={{ display: "inline-block", verticalAlign: "top", flexGrow: "1" }}
          >
            <LocalReadyPool
              key={`menu_game_local_ready_pool_ready_pool_${clientGameState.state}_${(clientGameState.state == "StrategicSwapPack" || clientGameState.state === "SimpleSwapPack") && clientGameState.localActiveSwapTrader}`}
              usekey="menu_game_local_ready_pool_ready_pool"
              contracts={currentTraderSupplies.get(iPlayerLocal).readyPool}
              mode={
                (
                  ((clientGameState.state == "StrategicSwapPack" || clientGameState.state === "SimpleSwapPack") && clientGameState.localActiveSwapTrader === true)
                  || ((clientGameState.state == "StrategicSwapPack" || clientGameState.state === "SimpleSwapPack") && clientGameState.localOfficer == false && clientGameState.localState == "packing")
                )
                  ? {
                    mode: "select for exit",
                    selectInstruction: `Select Contracts to ${clientGameState.localActiveSwapTrader === true
                      ? (clientGameState.state === "SimpleSwapPack" ? "Swap Out" : "Swap In/Out")
                      : "Fulfill and Pack into Crate"}`,
                    readyTitle: "Keeping",
                    exitTitle:
                      clientGameState.localActiveSwapTrader === true
                        ? (clientGameState.state === "SimpleSwapPack" ? "Throwing Out" : "Recycling")
                        : "Packing into Cart",
                    submitText:
                      clientGameState.localActiveSwapTrader === true
                        ? (clientGameState.state === "SimpleSwapPack" ? "Replace Selected Contracts" : "Swap In/Out Selected Contracts")
                        : "Close-up Cart",
                    entryProps: (
                      (clientGameState.localActiveSwapTrader === false)
                        ? nullopt
                        : (clientGameState.state === "SimpleSwapPack")
                          ? opt({
                            entryType: "simple",
                            enteringTitle: "Replacements (from Community Pool)"
                          })
                          : opt({
                            entryType: "strategic",
                            enterableTitle: "Community Pools",
                            enteringTitle: "Taking",
                            communityPools: clientGameState.communityPools,
                          })
                    ),
                    isSubmittable: () => true, // clientGameState.localActiveSwapTrader === true || (selected.some(s => s) && clientGameState.claimedProductType.hasValue),
                    onSubmit: ({ selectedForExit, selectedForEntry }) => {
                      if (clientGameState.localActiveSwapTrader === true) {
                        const selectedForExitCount = selectedForExit.filter(s => s).length;
                        const selectedForEntryCount = (
                          (clientGameState.state === "SimpleSwapPack")
                            ? selectedForExitCount
                            : (selectedForEntry.hasValue === false)
                              ? 0
                              : (selectedForEntry.value.generalPoolSelectedCount + selectedForEntry.value.recyclePoolSelectedCounts.reduce((a, b) => a + b))
                        );
                        const newReadyPoolCount = readyPoolSize + selectedForEntryCount - selectedForExitCount;
                        if (newReadyPoolCount != readyPoolSize) {
                          if (newReadyPoolCount < readyPoolSize) {
                            alert(`The swap would leave you with too few contracts (you would have ${newReadyPoolCount}; must have ${readyPoolSize}). Claim more contracts from the community pools, or recycle fewer contracts.`);
                          } else {
                            alert(`The swap would leave you with too many contracts (you would have ${newReadyPoolCount}; must have only ${readyPoolSize}). Recycle more contracts, or claim fewer contracts from the community pools.`);
                          }
                        } else {
                          clientSendClientEventToServer({
                            type: NetworkTypes.ClientEventType.SWAP_SUPPLY_CONTRACTS,
                            data: {
                              sourceClientId: props.localInfo.clientId,
                              recycled: selectedForExit,
                              took:
                                (selectedForEntry.hasValue === true)
                                  ? {
                                    recycledPools: selectedForEntry.value.recyclePoolSelectedCounts,
                                    generalPool: selectedForEntry.value.generalPoolSelectedCount,
                                  }
                                  : {
                                    recycledPools: clientGameState.communityPools.recyclePoolsContracts.map(() => 0),
                                    generalPool: (clientGameState.state === "SimpleSwapPack") ? selectedForExitCount : 0,
                                  }
                            }
                          });
                        }
                      } else { // Pack
                        if (clientGameState.claimedProductType.hasValue == false) {
                          alert("You must prepare a statement about the contents of your cart for the customs officer!");
                        } else if (clientGameState.selectedReadyPoolProductsForPacking.every(s => !s)) {
                          alert("You must pack at least one item into your cart!");
                        } else {
                          const claimMessage = clientGameState.claimMessage.trim();
                          clientSendClientEventToServer({
                            type: NetworkTypes.ClientEventType.PACK_CART,
                            data: {
                              sourceClientId: props.localInfo.clientId,
                              packed: selectedForExit,
                              claimedType: clientGameState.claimedProductType.value,
                              claimMessage: claimMessage == "" ? nullopt : opt(claimMessage)
                            }
                          });
                        }
                      }
                    },
                    onChange: ({ selectedForExit: selected }) => {
                      if (clientGameState.localActiveSwapTrader === false) {
                        setClientGameState({
                          ...clientGameState,
                          selectedReadyPoolProductsForPacking: selected,
                        });
                      }
                    }
                  }
                  : { mode: "static" }
              }
            />
          </Section>

          <Section style={{ display: "inline-block", verticalAlign: "top" }}>

            { // Your Cart
              (() => {
                const active = clientGameState.localOfficer == true || !(
                  (
                    clientGameState.state == "CustomsIntro"
                    && (
                      (clientGameState.introState == "ready" && clientGameState.localActiveTrader == true)
                      || (
                        clientGameState.introState == "animating"
                        && clientGameState.localActiveTrader == false
                        && iPlayerToNum(iPlayerLocal) === iPlayerToNum(props.clients.incrementIndexModLength(clientGameState.iPlayerActiveTrader, -1))
                      )
                    )
                  )
                  || (
                    clientGameState.state == "Customs"
                    && (
                      (clientGameState.customsState != "ready" && clientGameState.localActiveTrader == true
                        && (clientGameState.customsState != "interrogating" || clientGameState.interrogatingState != "cart entering"))
                      || (clientGameState.customsState == "ready" && clientGameState.readyState.state == "transitioning" && iPlayerToNum(iPlayerLocal) == iPlayerToNum(clientGameState.readyState.iPlayerExitingCart))
                    )
                  )
                );
                return (
                  <Section title="Your Cart">
                    <FloatingAnimatedCart
                      key={`menu_game_local_cart_animated_cart_rerender_${renderCount.current}`}
                      location="Trader Supplies"
                      iPlayerOwner={iPlayerLocal}
                      iPlayerLocal={iPlayerLocal}
                      active={active}
                      style={{ opacity: active ? 1 : 0 }}
                      animation={animation}
                      contents={(() => {
                        switch (clientGameState.state) {
                          case "Refresh":
                            return { labeled: false, state: "no crate" }
                          case "StrategicSwapPack":
                          case "SimpleSwapPack":
                            if (clientGameState.localOfficer == true
                              || clientGameState.localActiveSwapTrader === true
                              || clientGameState.localState === "waiting"
                            ) {
                              return { labeled: false, state: "no crate" };
                            } else if (clientGameState.localState == "done") {
                              return {
                                labeled: true,
                                count: clientGameState.localCart.count,
                                productType: opt(clientGameState.localCart.claimedType),
                                state: "closed crate"
                              };
                            } else if (clientGameState.claimedProductType.hasValue == false) { // packing
                              return {
                                labeled: false,
                                state: "open crate",
                              };
                            } else {
                              return {
                                labeled: true,
                                count: clientGameState.selectedReadyPoolProductsForPacking.filter(s => s).length,
                                productType: opt(clientGameState.claimedProductType.value),
                                state: "open crate"
                              };
                            }
                          case "CustomsIntro":
                          case "Customs": {
                            const cartState = clientGameState.cartStates.get(iPlayerLocal);
                            return (cartState.packed)
                              ? { labeled: true, count: cartState.cart.count, productType: opt(cartState.cart.claimedType), state: "closed crate" }
                              : { labeled: false, state: "no crate" }
                          }
                        }
                      })()}
                      officerTools={{ crowbarPresent: false, stampPresent: false, controls: { localControllable: false } }}
                    />
                  </Section>
                );
              })()
            }

            { // <Section Cart Info
              (
                clientGameState.localOfficer == false
                && (
                  ((clientGameState.state == "StrategicSwapPack" || clientGameState.state === "SimpleSwapPack") && clientGameState.localActiveSwapTrader === false && clientGameState.localState !== "waiting")
                  || (
                    (clientGameState.state == "CustomsIntro" || clientGameState.state == "Customs")
                    && clientGameState.cartStates.get(iPlayerLocal).packed == true
                  )
                )
              )
                ? (
                  <Section
                    title="Cart Info"
                  >
                    {(() => {
                      const { products, claimedProductOpt } = (() => {
                        const transformClaimedCart = (c: ClaimedCart) => {
                          return {
                            products: c.products,
                            claimedProductOpt: { hasValue: true, value: c.claimedType }
                          }
                        };

                        if (clientGameState.state == "CustomsIntro" || clientGameState.state == "Customs") {
                          const localCart = clientGameState.cartStates.get(iPlayerLocal);
                          if (localCart.packed == false) {
                            // TODO fix: should be impossible but need to lift localCart for type system to deduce packed == true
                            return { products: [], claimedProductOpt: nullopt };
                          }
                          return transformClaimedCart(localCart.cart);
                        } else if (clientGameState.localState == "packing") {
                          return {
                            products:
                              currentTraderSupplies.get(iPlayerLocal).readyPool
                                .filter((_c, i) => clientGameState.selectedReadyPoolProductsForPacking[i]),
                            claimedProductOpt: clientGameState.claimedProductType
                          };
                        } else { // localState "done"
                          return transformClaimedCart(clientGameState.localCart);
                        }
                      })();

                      return (
                        <div>
                          <div>
                            <span>Actually contains:</span>
                            <br></br>
                            <span>{products.groupBy(p => p).map(g => `${g.group.length}${getProductInfo(g.key).icon}`).join(", ")}</span>
                          </div>
                          {
                            (claimedProductOpt.hasValue == true && products.length > 0)
                              ? (() => {


                                return (
                                  <div>
                                    <Earnings
                                      getTitle={({ earningsPhrase }) => `${earningsPhrase.capitalize()} if ignored:`}
                                      earnings={products.map(p => getProductInfo(p).value as number).reduce((a, b) => a + b, 0)}
                                    />
                                    <Earnings
                                      getTitle={({ earningsPhrase }) => `${earningsPhrase.capitalize()} if searched:`}
                                      earnings={
                                        (products.every(p => p == claimedProductOpt.value))
                                          ? (getProductInfo(claimedProductOpt.value).value + getProductInfo(claimedProductOpt.value).fine) * products.length
                                          : products.map(p => ((p == claimedProductOpt.value) ? getProductInfo(p).value : -getProductInfo(p).fine) as number).reduce((a, b) => a + b, 0)
                                      }
                                    />
                                  </div>
                                );
                              })()
                              : undefined
                          }
                        </div>
                      )
                    })()}
                  </Section>
                )
                : undefined
            }
          </Section>

          <Section title="Earned Supplies" style={{ display: "inline-block", verticalAlign: "top" }}>
            <TraderSuppliesTable
              key={`menu_game_local_supplies_${renderCount.current}_rerender_${renderCount.current}`}
              usekey={"menu_game_local_supplies"}
              supplies={currentTraderSupplies.get(iPlayerLocal)}
              iPlayerOwner={iPlayerLocal}
              animation={animation}
              type={"local"}
            />
          </Section>
        </div>
      </Section >

      <Section title={"Product Reference"}
        style={{ overflowX: "auto", overflowY: "hidden", whiteSpace: "nowrap", textAlign: "center" }}
      >
        {
          productInfos
            .map((p) => (
              <div
                key={`menu_game_product_reference_${p.type}`}
                style={{ display: "inline-block", verticalAlign: "top" }}
              >
                <div>
                  <span style={{ position: "relative" }}>
                    <span style={{ opacity: 0 }}>{contractIcon}</span>
                    <span style={{ position: "absolute", left: "0px", top: "-5px" }}>{contractIcon}</span>
                    <span style={{ position: "absolute", left: "4px", top: "-2px" }}>{contractIcon}</span>
                  </span>
                  <span>{" "}{props.settings.generalPoolContractCounts.get(p.type)}x</span>
                </div>
                <SupplyContract productType={opt(p.type)} highlighted={false} crossedOut={false} />
              </div>
            ))
            .arr
        }
      </Section>
    </div >
  )
}