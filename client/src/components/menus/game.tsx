import * as React from "react";

import BufferedWebSocket, { WebSocketHandlers } from "../../core/buffered_websocket";
import * as NetworkTypes from "../../core/network_types";
import { CartState, ClientGameState, CommunityContractPools as CommunityContractPools, ClaimedCart, IgnoreDeal, PersistentGameState, ProductType, ServerGameState, TraderSupplies, getProductInfo, readyPoolSize, illegalProductIcon, legalProductIcon, moneyIcon, fineIcon, productInfos, unknownProductIcon, recycleIcon, trophyIcon, pointIcon, firstPlaceIcon, secondPlaceIcon, awardTypes, winnerIcon, PlayerArray, ProductArray, ValidatedPlayerIndex, ValidPlayerIndex, SerializableServerGameState, iPlayerToNum, GameSettings, officerIcon, contractIcon } from "../../core/game_types";
import { Optional, getRandomInt, nullopt, omitAttrs, opt } from "../../core/util";

import AnimatedEllipses from "../elements/animated_ellipses";
import Keyframes from "../elements/keyframes";

import parchmentLegalImgSrc from '../../../images/parchment.png';
import parchmentIllegalImgSrc from '../../../images/parchment_red.png';
import cartEmptyImgSrc from '../../../images/cart_empty.png';
import cartClosedLabeledImgSrc from '../../../images/cart_closed_labeled.png';
import cartClosedUnlabeledImgSrc from '../../../images/cart_closed_unlabeled.png';
import cartOpenLabeledImgSrc from '../../../images/cart_open_labeled.png';
import cartOpenUnlabeledImgSrc from '../../../images/cart_open_unlabeled.png';
import cartLidImgSrc from '../../../images/cart_lid.png';
import crowbarImgSrc from '../../../images/crowbar.png';

type LocalInfo = {
  localPlayerName: string,
  connectAddress: string,
  clientId: number
};

type MenuGameProps = {
  localInfo: LocalInfo,
  hostInfo: NetworkTypes.HostClientInfo,
  settings: GameSettings,
  clients: PlayerArray<NetworkTypes.ClientInfo>,
  ws: BufferedWebSocket,

  onClose: (props: { warning: string }) => void
};

/**
 * Minimum time between network events sent related to the Customs state's officer crowbar.
 */
const crowbarUpdateMinIntervalMs = 150;


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
  action: "give" | "receive",
  payment: {
    money: number,
  },
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
    recyclePoolsContracts: [[], []]
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
    traderSupplies
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
  console.log(`floating div ${props.usekey} current position: ${JSON.stringify(currentPosition)}`);

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

/**
 * (Element) Span that "types" its text one character at a time over an interval. 
 * Displays and animates according to ClaimMessageGameAnimationSteps in the game-wide GameAnimationSequence.
 */
function ClaimMessageAnimatedRevealingText(props: {
  usekey: string,
  message: string,
  animation: Optional<GameAnimationSequence>,
  [otherOptions: string]: unknown;
}) {
  const attrs = omitAttrs(['animation'], props);

  const { iGameAnimationStep, gameAnimationStep } = useGameAnimationStep(props.animation);

  const messageToMessageLines = (message: string) => {
    return message.split("\n")
      .map(l =>
        l.split(" ")
          .reduce((a: string[], b: string): string[] => {
            const lastLine = a.at(-1);
            if (lastLine === undefined || lastLine.length + b.length > 70) return a.concat([b]);
            else return a.take(a.length - 1).concat([`${lastLine} ${b}`]);
          }, [])
      )
      .reduce((a, b) => a.concat(b))
  }

  const [messageLines, setMessageLines] = React.useState(messageToMessageLines(props.message));
  const [revealProgress, setRevealProgress] = React.useState(props.animation.hasValue == true && props.animation.value.sequence.some(s => s.type === "claim message") ? 0 : 10000000);

  React.useEffect(() => {
    if (gameAnimationStep.hasValue === true) {
      const step = gameAnimationStep.value.step;
      if (step.type === "claim message") {
        let revealProgress = 0;
        const stepMessageLines = messageToMessageLines(step.message);
        const maxRevealProgress = stepMessageLines.map(l => l.length).reduce((a, b) => a + b);
        setMessageLines(stepMessageLines);
        setRevealProgress(revealProgress);
        const interval = window.setInterval((() => {
          while (true) {
            if (revealProgress >= maxRevealProgress) {
              window.clearInterval(interval);
              gameAnimationStep.value.onCompleteRegistrations.forEach(c => c());
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
        }), 1000 / (10 + (step.message.length / 10))); // 20 chars per second

        return () => {
          window.clearInterval(interval);
        }
      }
    }
    return;
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

  const { iGameAnimationStep, gameAnimationStep } = useGameAnimationStep(props.animation);

  const [preAnimationSequenceState, postAnimationStepsStates, postAnimationSequenceState] = (() => {
    const preSequenceState = {
      supplies: props.supplies,
      iPlayerPaymentAreaOwner: nullopt,
      onStateReached: nullopt,
    };

    const postStepsState: {
      supplies: TraderSupplies,
      iPlayerPaymentAreaOwner: Optional<ValidPlayerIndex>,
      onStateReached: Optional<() => void>,
    }[] = [];

    if (props.animation.hasValue == true) {
      (props.animation.value.sequence
        .zip(props.animation.value.onCompleteRegistrations)
        ?? [])
        .forEach(([s, onCompleteRegistration]) => {
          const postPreviousStepState = postStepsState.at(-1) ?? preSequenceState;

          if (s.type == "payment" && (
            (s.action == "give" && iPlayerToNum(s.iPlayerGiver) == iPlayerToNum(props.iPlayerOwner))
            || (s.action == "receive" && iPlayerToNum(s.iPlayerReceiver) == iPlayerToNum(props.iPlayerOwner))
          )) {
            postStepsState.push({
              ...postPreviousStepState,
              supplies: {
                ...postPreviousStepState.supplies,
                money: postPreviousStepState.supplies.money + (s.action == "give" ? -s.payment.money : s.payment.money),
              },
              iPlayerPaymentAreaOwner: opt(s.iPlayerGiver),
              onStateReached: opt(() => {
                onCompleteRegistration.forEach(c => c());
              }),
            });
          } else if (s.type == "crate contents") {
            const animation = s.animation;
            if (animation.animation == "deposit contents") {
              postStepsState.push({
                ...postPreviousStepState,
                supplies: {
                  ...postPreviousStepState.supplies,
                  shopProductCounts:
                    postPreviousStepState.supplies.shopProductCounts
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
              });
            } else {
              postStepsState.push({
                ...postPreviousStepState,
                iPlayerPaymentAreaOwner: nullopt,
                onStateReached: nullopt,
              });
            }
          } else {
            postStepsState.push({
              ...postPreviousStepState,
              iPlayerPaymentAreaOwner: nullopt,
              onStateReached: nullopt,
            });
          }
        });
    }

    const postSequenceState = {
      ...(postStepsState.at(-1) ?? preSequenceState),
      iPlayerPaymentAreaOwner: nullopt,
      onStateReached: nullopt,
    };

    return [preSequenceState, postStepsState, postSequenceState];
  })();
  const [preAnimationStepState, postAnimationStepState] = [
    postAnimationStepsStates[iGameAnimationStep - 1] ?? preAnimationSequenceState,
    postAnimationStepsStates[iGameAnimationStep] ?? postAnimationSequenceState
  ];

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
          ? Array(Math.abs(postAnimationStepState.supplies.money - preAnimationStepState.supplies.money)).fill(false)
            .map((_false, i) => {
              return (
                <FloatingDiv
                  usekey={`${props.usekey}_floating_div_money_${i}_rerender_${renderCount.current}`}
                  animationSteps={
                    (
                      ((): FloatingDivAnimationStep[] => {
                        const paymentAreaMoneyIconEleId = `menu_game_payment_player_${iPlayerToNum(stepIPlayerPaymentAreaOwner.value)}_item_money`;
                        const suppliesMoneyIconEleId = `${props.usekey}_item_icon_money`;
                        const [sourceMoneyIconEleId, destinationMoneyIconEleId] =
                          (postAnimationStepState.supplies.money > preAnimationStepState.supplies.money)
                            ? [paymentAreaMoneyIconEleId, suppliesMoneyIconEleId]
                            : [suppliesMoneyIconEleId, paymentAreaMoneyIconEleId];
                        return [
                          {
                            action: "teleport to",
                            targetPosition: {
                              relativeElementId: sourceMoneyIconEleId
                            }
                          },
                          {
                            action: "wait",
                            delayMs: 300 * i
                          },
                          {
                            action: "float to",
                            targetPosition: {
                              relativeElementId: destinationMoneyIconEleId
                            },
                            animationDuration: "700ms"
                          }
                        ];
                      })()
                    ).concat([
                      {
                        action: "notify",
                        callback: () => {
                          if (postAnimationStepState.onStateReached.hasValue == true && i == Math.abs(postAnimationStepState.supplies.money - preAnimationStepState.supplies.money) - 1) {
                            postAnimationStepState.onStateReached.value();
                          }
                        }
                      }
                    ])
                  }
                >
                  <span>{moneyIcon}</span>
                </FloatingDiv>
              );
            })
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
  [otherOptions: string]: unknown
}) {
  const attrs = omitAttrs(['productType'], props);

  const contractMarginPx = 10;

  return (
    <div
      {...attrs}
      style={{ position: "relative", ...((attrs['style'] !== undefined ? attrs['style'] : {})) }}
    >
      <div>
        <div style={{
          whiteSpace: "nowrap",
          margin: `${contractMarginPx}px`,
        }}>
          <div style={{
            display: "inline-block",
            fontSize: "200%",
            width: "100%",
            textAlign: "center",
          }}>
            {props.productType.hasValue === true ? getProductInfo(props.productType.value).icon : unknownProductIcon}
          </div>
          <div style={{
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
          <div style={{
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
      </div>
      <img
        src={props.productType.hasValue === false || getProductInfo(props.productType.value).category === "legal" ? parchmentLegalImgSrc : parchmentIllegalImgSrc}
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

/**
 * (Element) One of the tables of supply contracts in the local ready pool display.
 */
function LocalReadyPoolSupplyContracts(props: {
  usekey: string,
  contracts: {
    productType: Optional<ProductType>,
    style: ("visible" | "faded" | "hidden"),
    clickable: boolean,
  }[],
  onClick?: (event: { event: MouseEvent, iContract: number }) => void;
  [otherOptions: string]: unknown
}) {
  const attrs = omitAttrs(['usekey', 'contracts', 'onClick'], props);

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
                        opacity: (c.style === "visible") ? 1 : (c.style == "faded") ? 0.3 : 0,
                        display: "inline-block",
                        width: `${Math.floor(100 / (iRow == 0 ? g.length : contractsPerRow)) - 1}%`,
                      }}
                      onClick={(event) => { if (c.clickable && props.onClick !== undefined) props.onClick({ event: event.nativeEvent, iContract: c.iContract }) }}
                    >
                      <SupplyContract productType={c.productType} />
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

type LocalReadyPoolStaticModeProps = {
  mode: "static"
}
type LocalReadyPoolSelectForExitModeProps = {
  mode: "select for exit",
  selectInstruction: string,
  exitTitle: string,
  entry: Optional<{ type: "general pool", title: string }>
  initialSelected?: boolean[],
  isSubmittable?: (state: { selected: boolean[] }) => boolean,
  onSubmit: (event: { selected: boolean[] }) => void,
  onChange?: (state: { selected: boolean[] }) => void,
}
type LocalReadyPoolModeProps =
  | LocalReadyPoolStaticModeProps
  | LocalReadyPoolSelectForExitModeProps
type LocalReadyPoolModeState =
  | LocalReadyPoolStaticModeProps
  | LocalReadyPoolSelectForExitModeProps & {
    selected: boolean[]
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
  const modePropsAsModeState = (modeStateToSynchronize?: LocalReadyPoolModeState) => {
    if (props.mode.mode == "static") {
      return props.mode;

    } else { // select for exit

      if ( // if props.initialSelected matches the existing state's initial selected, keep the state's selected
        modeStateToSynchronize !== undefined
        && modeStateToSynchronize.mode === "select for exit"
        && ((props.mode.initialSelected === undefined) === (modeStateToSynchronize.initialSelected === undefined))
        && (
          (props.mode.initialSelected === undefined || modeStateToSynchronize.initialSelected === undefined)
          || ((() => {
            const zipped = props.mode.initialSelected.zip(modeStateToSynchronize.initialSelected);
            return zipped !== undefined && zipped.every(([propHasInitiallySelected, stateHasInitiallySelected]) => propHasInitiallySelected === stateHasInitiallySelected)
          })())
        )
      ) {
        return {
          ...props.mode,
          selected: modeStateToSynchronize.selected
        };

      } else { // else props.initialSelected changed, so use that for selected
        return {
          ...props.mode,
          selected:
            (props.mode.initialSelected === undefined)
              ? Array(props.contracts.length).fill(false)
              : props.mode.initialSelected.shallowCopy()
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

  return (
    <Section key={props.usekey} {...attrs}>
      <Section
        title={mode.mode === "select for exit" ? mode.selectInstruction : undefined}
      >
        <Section key={`${props.usekey}_ready_pool`}
          title={mode.mode == "select for exit" ? "Keep" : undefined}
          style={{ display: "inline-block", verticalAlign: "top" }}
        >
          <LocalReadyPoolSupplyContracts
            usekey={`${props.usekey}_ready_pool_contracts`}
            contracts={
              (mode.mode === "static")
                ? props.contracts
                  .map((p) => ({ productType: opt(p), style: "visible", clickable: false }))
                : // mode == "select for exit"
                (props.contracts
                  .zip(mode.selected) ?? []) // TODO fix by moving props.contracts into the state, zipped with selected
                  .map(([p, s]) => {
                    return {
                      productType: opt(p),
                      style: (!s) ? "visible" : "faded",
                      clickable: true
                    };
                  })
            }
            onClick={(e) => {
              if (mode.mode == "select for exit") {
                const iContractCurrentSelected = mode.selected[e.iContract];
                if (iContractCurrentSelected === undefined) {
                  console.log(`Bad iContract from ready pool LocalReadyPoolSupplyContracts click event: ${e.iContract}`);
                  console.trace();
                } else {
                  const newSelected = mode.selected.shallowCopy();
                  newSelected[e.iContract] = !iContractCurrentSelected;
                  setModeState({ ...mode, selected: newSelected });
                  if (mode.onChange !== undefined) mode.onChange({ selected: newSelected });
                }
              }
            }}
          />
        </Section>
        { // <Section _exit>
          (mode.mode == "select for exit")
            ? (
              <Section key={`${props.usekey}_exit`}
                style={{ display: "inline-block", verticalAlign: "top" }}
                title={mode.exitTitle}
              >
                <LocalReadyPoolSupplyContracts
                  usekey={`${props.usekey}_exit_contracts`}
                  contracts={
                    (props.contracts
                      .zip(mode.selected) ?? []) // TODO fix, see above
                      .map(([p, s]) => {
                        return {
                          productType: opt(p),
                          style: s ? "visible" : "hidden",
                          clickable: s
                        };
                      })
                  }
                  onClick={(e) => {
                    const iContractCurrentSelected = mode.selected[e.iContract];
                    if (iContractCurrentSelected === undefined) {
                      console.log(`Bad iContract from exit LocalReadyPoolSupplyContracts click event: ${e.iContract}`);
                      console.trace();
                    } else {
                      const newSelected = mode.selected.shallowCopy();
                      newSelected[e.iContract] = !iContractCurrentSelected;
                      setModeState({ ...mode, selected: newSelected });
                      if (mode.onChange !== undefined) mode.onChange({ selected: newSelected });
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
              disabled={!(mode.isSubmittable === undefined || mode.isSubmittable({ selected: mode.selected }))}
              onClick={(_e) => {
                mode.onSubmit({ selected: mode.selected });
              }}
            >
              {mode.exitTitle} Selected
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
type CartOfficerToolsNotPresentState = {
  present: false
}
type CartOfficerToolsPresentState = {
  present: true,
  state: NetworkTypes.OfficerToolState,
}
type CartOfficerTools =
  | (
    & (CartOfficerToolsPresentState)
    & {
      controls: {
        localControllable: true,
        onInternalOfficerToolUpdate: (event: { newToolState: NetworkTypes.OfficerToolState }) => void,
      }
    }
  )
  | (
    & (CartOfficerToolsPresentState | CartOfficerToolsNotPresentState)
    & {
      controls: {
        localControllable: false,
        registerEventHandlers: (args: { onExternalOfficerToolUpdate: (event: { newToolState: NetworkTypes.OfficerToolState }) => void }) => { handlerRegistrationId: number },
        unregisterEventHandlers: (handlerRegistrationId: number) => void,
      }
    }
  )

/**
 * (Element) A trader's cart and contained crate. 
 * Crate lid is animated according to a simple animation type.
 * Animates interactable officer tools internally as needed.
 */
function AnimatedCart(props: {
  contents: CartContents,
  officerTools: CartOfficerTools,
  animation: Optional<{
    animation: "blast lid" | "open lid" | "close lid",
    onComplete: Optional<() => void>,
  }>,
  [otherOptions: string]: unknown
}) {
  const attrs = omitAttrs(['contents', 'officerTools', 'animation'], props);

  const currentRenderTimeMs = Date.now();

  const crowbarStartRotateDeg = -103;
  const crowbarEndRotateDeg = -45;
  const crowbarDragDistanceRequired = 400;
  const crowbarUpdateAnimationDurationMs = crowbarUpdateMinIntervalMs + 50;
  // if function changes make sure to update "calculate..." to emulate the function
  const crowbarUpdateAnimationFunction = "linear";
  const calculateCrowbarAnimationProgress = (args: { animationStartTimeMs: number, nowMs: number }) => {
    return (
      Math.min((args.nowMs - args.animationStartTimeMs), crowbarUpdateAnimationDurationMs)
      / crowbarUpdateAnimationDurationMs
    )
  };

  const dragProgressToStyleDegString = (dragProgress: number) => {
    return `${Math.ceil(crowbarStartRotateDeg + (dragProgress * (crowbarEndRotateDeg - crowbarStartRotateDeg)))}deg`;
  }

  // nullopt if no crowbar present
  const [crowbarData, setCrowbarData] = React.useState<Optional<
    | {
      mouse:
      | { down: false }
      | { down: true, startPosition: { x: number, y: number } },
      dragProgress: number,
      animation: Optional<{
        animationStartTimeMs: number,
        destDragProgress: number,
      }>
    }
  >>(
    props.officerTools.present == true
      && props.officerTools.state.hasValue == true
      && props.officerTools.state.value.tool == "crowbar"
      ? opt({
        mouse: { down: false },
        dragProgress: props.officerTools.state.value.useProgress,
        animation: nullopt
      })
      : nullopt
  );

  const onMouseDownUpHandler = (args: { event: MouseEvent, downEvent: boolean }) => {
    const controls = props.officerTools.controls;
    if (
      controls.localControllable == false
      || (crowbarData.hasValue == true && crowbarData.value.dragProgress >= 1)
    ) {
      return;
    }

    const eventTime = Date.now();
    setCrowbarData(() => {
      //console.log(`Mouse ${args.downEvent ? "down" : "up"} listener, current crowbar data: ${JSON.stringify(currentCrowbarDragData)}`)
      if (crowbarData.hasValue == false) return nullopt;
      if (crowbarData.value.mouse.down == args.downEvent) { // repeat event, shouldn't happen
        return crowbarData;
      }

      controls.onInternalOfficerToolUpdate({
        newToolState: opt({
          tool: "crowbar",
          useProgress: crowbarData.value.dragProgress,
        }),
      });

      if (args.downEvent == true) {
        return opt({
          mouse: { down: true, startPosition: { x: args.event.clientX, y: args.event.clientY } },
          dragProgress: crowbarData.value.dragProgress,
          animation: nullopt,
        });
      } else {
        return opt({
          mouse: { down: false },
          dragProgress: crowbarData.value.dragProgress,
          animation: crowbarData.value.dragProgress == 0 ? nullopt : opt({
            animationStartTimeMs: eventTime,
            destDragProgress: 0,
          })
        });
      }
    });
  }

  React.useEffect(() => {
    const controls = props.officerTools.controls;
    if (controls.localControllable == false) {
      const { handlerRegistrationId } = controls.registerEventHandlers({
        onExternalOfficerToolUpdate: (event) => {
          if (crowbarData.hasValue == true && crowbarData.value.dragProgress >= 1) {
            return;
          }

          const eventTime = Date.now();
          setCrowbarData(() => {
            if (event.newToolState.hasValue == false || event.newToolState.value.tool != "crowbar") return nullopt;
            if (crowbarData.hasValue == false) return opt({
              mouse: { down: false }, // arbitrary -- this won't be used since localControllable false
              dragProgress: event.newToolState.value.useProgress,
              animation: nullopt,
            });

            const currentDragProgress = (
              (crowbarData.value.animation.hasValue == false)
                ? crowbarData.value.dragProgress
                : (
                  crowbarData.value.dragProgress
                  + (
                    calculateCrowbarAnimationProgress({ nowMs: eventTime, animationStartTimeMs: crowbarData.value.animation.value.animationStartTimeMs })
                    * (crowbarData.value.animation.value.destDragProgress - crowbarData.value.dragProgress)
                  )
                )
            );
            return opt({
              mouse: { down: false }, // won't be used
              dragProgress: currentDragProgress,
              animation: opt({
                animationStartTimeMs: eventTime,
                destDragProgress: event.newToolState.value.useProgress,
              }),
            })
          });
        }
      });
      return () => { controls.unregisterEventHandlers(handlerRegistrationId); }

    } else { // localControllable == true
      const onWindowMouseUpListener = (event: MouseEvent) => { onMouseDownUpHandler({ event, downEvent: false }); };
      const onWindowMouseMoveListener = (event: MouseEvent) => {
        if (crowbarData.hasValue == true && crowbarData.value.dragProgress >= 1) return;

        setCrowbarData(() => {
          //console.log(`Mouse move listener, current crowbar data: ${JSON.stringify(currentCrowbarDragData)}`);
          if (crowbarData.hasValue == false || crowbarData.value.mouse.down == false) return crowbarData;

          // translates mouse drag pixels [0,400] to crowbar drag progress [0,1] using a log function, 
          // i.e. mouse drag provides more progress at the starting range (e.g. [0,100]) than the ending
          // See on wolfram alpha: "log2(1 + (x/10)) / log2(40) from x = -20 to x = 400"
          const newDragProgress =
            Math.min(1, Math.max(0,
              Math.log2(1 + ((event.clientY - crowbarData.value.mouse.startPosition.y) / 10))
              / Math.log2(crowbarDragDistanceRequired / 10)
            ));

          controls.onInternalOfficerToolUpdate({
            newToolState: opt({
              tool: "crowbar",
              useProgress: newDragProgress,
            }),
          });

          return opt({
            ...crowbarData.value,
            dragProgress: newDragProgress,
            animation: nullopt,
          });
        })
      };

      window.addEventListener("mouseup", onWindowMouseUpListener);
      window.addEventListener("mousemove", onWindowMouseMoveListener);

      return () => {
        window.removeEventListener("mouseup", onWindowMouseUpListener);
        window.removeEventListener("mousemove", onWindowMouseMoveListener);
      };
    }
  }, [crowbarData])

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
            opacity: props.animation.hasValue == true || crowbarData.hasValue == true ? 1 : 0,
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

        <img
          src={crowbarImgSrc}
          draggable={false} // just prevents mouse events from being suppressed by drag events
          onMouseDown={(event) => { onMouseDownUpHandler({ event: event.nativeEvent, downEvent: true }); }}
          style={{
            opacity: crowbarData.hasValue == true ? 1 : 0,
            position: "absolute",
            left: "52px",
            top: "2px",
            width: "50%",
            zIndex: 2,
            rotate: (crowbarData.hasValue == true && crowbarData.value.animation.hasValue == false)
              ? dragProgressToStyleDegString(crowbarData.value.dragProgress)
              : undefined,
            animationName: (crowbarData.hasValue == true && crowbarData.value.animation.hasValue == true)
              ? (
                `cart_crowbar_animation`
                + `_${dragProgressToStyleDegString(crowbarData.value.dragProgress)}`
                + `_${dragProgressToStyleDegString(crowbarData.value.animation.value.destDragProgress)}`
              )
              : undefined,
            animationDuration: `${crowbarUpdateAnimationDurationMs}ms`,
            animationIterationCount: 1,
            animationTimingFunction: crowbarUpdateAnimationFunction,
            animationFillMode: "both",
            animationDirection: "normal",
            animationDelay: `${Math.floor(
              (crowbarData.hasValue == false || crowbarData.value.animation.hasValue == false)
                ? 0
                : (-Math.min( // negative delay starts animation in middle of animation
                  (currentRenderTimeMs - crowbarData.value.animation.value.animationStartTimeMs),
                  crowbarUpdateAnimationDurationMs
                ))
            )}ms`,
            transformOrigin: "5% 8%",
          }}
          onAnimationEnd={() => {
            //console.log(`ON ANIMATION END ${JSON.stringify(crowbarData)}`);
            setCrowbarData(() => {
              if (crowbarData.hasValue == false || crowbarData.value.animation.hasValue == false) return crowbarData;

              if (props.officerTools.controls.localControllable == true) {
                props.officerTools.controls.onInternalOfficerToolUpdate({
                  newToolState: opt({
                    tool: "crowbar",
                    useProgress: crowbarData.value.animation.value.destDragProgress,
                  }),
                });
              }

              return opt({
                ...crowbarData.value,
                dragProgress: crowbarData.value.animation.value.destDragProgress,
                animation: nullopt,
              });
            });
          }}
        />

        { // crowbar animation Keyframes
          (crowbarData.hasValue == true && crowbarData.value.animation.hasValue == true)
            ? (
              <Keyframes
                name={
                  `cart_crowbar_animation`
                  + `_${dragProgressToStyleDegString(crowbarData.value.dragProgress)}`
                  + `_${dragProgressToStyleDegString(crowbarData.value.animation.value.destDragProgress)}`
                }
                from={{ rotate: dragProgressToStyleDegString(crowbarData.value.dragProgress) }}
                to={{ rotate: dragProgressToStyleDegString(crowbarData.value.animation.value.destDragProgress) }}
              />
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
  officerTools: CartOfficerTools,
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

  const { iGameAnimationStep /* , gameAnimationStep */ } = useGameAnimationStep(props.animation);

  const [preAnimationSequenceState, postAnimationStepsStates, postAnimationSequenceState] = (() => {
    const preSequenceState = {
      location: props.location,
      crateState: props.contents.state == "open crate" ? "lid opened" as "lid opened" : "lid closed" as "lid closed",
      crateContents: { state: "none" as "none" },
      onStateReached: nullopt,
    };

    const postStepsStates: {
      location: "Trader Supplies" | "Suspect Cart Area",
      crateState: "lid blasted" | "lid opened" | "lid closed",
      crateContents:
      | { state: "none" }
      | { state: "displayed", products: ProductType[], iProductCheekyDelay: Optional<number> }
      | { state: "arrived", products: ProductType[], destinations: CrateProductDestination[], illegalsHidden: boolean }
      onStateReached: Optional<() => void>,
    }[] = [];

    if (props.animation.hasValue == true) {
      (props.animation.value.sequence
        .zip(props.animation.value.onCompleteRegistrations) ?? [])
        .forEach(([s, onCompleteRegistration]) => {
          const postPreviousStepState = postStepsStates.at(-1) ?? preSequenceState;

          if (s.type == "cart motion" && iPlayerToNum(s.iPlayerCart) == iPlayerToNum(props.iPlayerOwner)) {
            postStepsStates.push({
              ...postPreviousStepState,
              location: s.motion == "suspect area to trader supplies" ? "Trader Supplies" : "Suspect Cart Area",
              onStateReached: opt(() => {
                //console.log(`Floating Animated cart ${props.location} ${props.iPlayerOwner} calling back ${onCompleteRegistration.length} onCompleteRegistrations`);
                onCompleteRegistration.forEach(c => c());
              }),
            });

          } else if (s.type == "crate" && iPlayerToNum(s.iPlayerCrate) == iPlayerToNum(props.iPlayerOwner)) {
            postStepsStates.push({
              ...postPreviousStepState,
              crateState: s.animation == "blast lid" ? "lid blasted" : s.animation == "open lid" ? "lid opened" : "lid closed",
              onStateReached: opt(() => {
                //console.log(`Floating Animated cart ${props.location} ${props.iPlayerOwner} calling back ${onCompleteRegistration.length} onCompleteRegistrations`);
                onCompleteRegistration.forEach(c => c());
              })
            });

          } else if (s.type == "crate contents" && iPlayerToNum(s.iPlayerCrate) == iPlayerToNum(props.iPlayerOwner)) {
            postStepsStates.push({
              ...postPreviousStepState,
              crateContents: {
                products: s.animation.contents.map(p => p.product),
                ...((s.animation.animation == "display contents")
                  ? { state: "displayed", iProductCheekyDelay: s.animation.iProductCheekyDelay }
                  : {
                    state: "arrived",
                    destinations: s.animation.contents.map(p => p.destination),
                    illegalsHidden: s.animation.illegalsHidden,
                  }
                )
              },
              onStateReached: opt(() => {
                //console.log(`Floating Animated cart ${props.location} ${props.iPlayerOwner} calling back ${onCompleteRegistration.length} onCompleteRegistrations`);
                onCompleteRegistration.forEach(c => c());
              })
            });

          } else {
            postStepsStates.push({
              ...postPreviousStepState,
              onStateReached: nullopt,
            });
          }
        });
    }

    const postSequenceState = {
      ...(postStepsStates.at(-1) ?? preSequenceState),
      onStateReached: nullopt,
    };

    return [preSequenceState, postStepsStates, postSequenceState];
  })();
  const [preAnimationStepState, postAnimationStepState] = [
    postAnimationStepsStates[iGameAnimationStep - 1] ?? preAnimationSequenceState,
    postAnimationStepsStates[iGameAnimationStep] ?? postAnimationSequenceState
  ];

  return (
    <div {...attrs} style={{ marginTop: props.location == "Suspect Cart Area" ? "70px" : "0px", marginLeft: "30px", marginRight: "30px", ...(attrs['style'] ?? {}) }}>
      <AnimatedCart
        key={`${getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}_animated_cart`}
        id={getStaticCartEleId({ location: props.location, iPlayerOwner: props.iPlayerOwner })}
        style={{ opacity: props.active && props.animation.hasValue == false ? 1 : 0, display: "inline-block" }}
        contents={props.contents}
        animation={nullopt}
        officerTools={props.officerTools}
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
                      present: true,
                      state: opt({ tool: "crowbar", useProgress: 1 }),
                      controls: {
                        localControllable: false,
                        registerEventHandlers: (_args) => ({ handlerRegistrationId: -1 }),
                        unregisterEventHandlers: (_args) => { }
                      }
                    }
                    : {
                      present: false,
                      controls: {
                        localControllable: false,
                        registerEventHandlers: (_args) => ({ handlerRegistrationId: -1 }),
                        unregisterEventHandlers: (_args) => { }
                      },
                    }
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

export default function MenuGame(props: MenuGameProps) {
  const iPlayerLocal = props.clients.map((c, i) => { return { ...c, clientIndex: i }; }).arr.filter(c => c.clientId == props.localInfo.clientId)[0]?.clientIndex;
  if (iPlayerLocal === undefined) {
    const err = `Local clientId (${props.localInfo.clientId}) was not found in MenuGame props.clients: ${JSON.stringify(props.clients)}`;
    console.log(err);
    console.trace();
    props.onClose({ warning: err });
    return (<div>An error occurred.</div>);
  }

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

      case "Swap":
        return {
          state: "Swap",
          round: clientGameState.round,
          communityPools: clientGameState.communityPools,
          traderSupplies: clientGameState.traderSupplies,
          iPlayerOfficer: clientGameState.localOfficer == true ? iPlayerLocal : clientGameState.iPlayerOfficer,
          iPlayerActiveTrader: clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader,
        };

      case "Pack":
        return {
          state: "Pack",
          round: clientGameState.round,
          communityPools: clientGameState.communityPools,
          traderSupplies: clientGameState.traderSupplies,
          iPlayerOfficer: clientGameState.localOfficer == true ? iPlayerLocal : clientGameState.iPlayerOfficer,
          cartStates: (() => {
            const states = clientGameState.otherCartStates.shallowCopy();
            states.set(iPlayerLocal,
              (clientGameState.localOfficer == true || clientGameState.localState == "packing")
                ? { packed: false }
                : { packed: true, cart: clientGameState.localCart }
            );
            return states;
          })(),
        };

      case "CustomsIntro":
        return {
          state: "CustomsIntro",
          round: clientGameState.round,
          communityPools: clientGameState.communityPools,
          traderSupplies: clientGameState.traderSupplies,
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
          iPlayerOfficer: clientGameState.localOfficer == true ? iPlayerLocal : clientGameState.iPlayerOfficer,
          cartStates: clientGameState.cartStates,
          ...((clientGameState.customsState == "ready")
            ? { customsState: "ready" }
            : ((clientGameState.customsState == "resolving")
              ? {
                customsState: "resolving",
                iPlayerActiveTrader: clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader,
                ...((clientGameState.result.result == "ignored for deal")
                  ? { result: "ignored for deal", deal: clientGameState.result.deal }
                  : (clientGameState.result.result == "searched")
                    ? { result: "searched", iProductCheekyDelay: clientGameState.result.iProductCheekyDelay }
                    : { result: "ignored" }
                )
              }
              : {
                customsState: "interrogating",
                iPlayerActiveTrader: clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader,
                proposedDeal: clientGameState.proposedDeal,
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

  const onExternalOfficerToolUpdateRegistrations: Optional<(event: { update: NetworkTypes.ServerOfficerToolUpdateEventData }) => void>[] = [];
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
        // convert [new server state + current client state] to new client state
        switch (event.data.state.state) {
          case "Swap": {
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
            const eventIPlayerActiveTrader = props.clients.validateIndex(event.data.state.iPlayerActiveTrader);
            if (eventTraderSupplies.hasValue === false || eventIPlayerOfficer.hasValue === false || eventIPlayerActiveTrader.hasValue === false) {
              console.log(`Received bad STATE_UPDATE: ${JSON.stringify(event)}`);
              break;
            }
            setClientGameState({
              state: "Swap",
              round: event.data.state.round,
              communityPools: event.data.state.communityPools,
              traderSupplies: eventTraderSupplies.value,
              ...((iPlayerToNum(iPlayerLocal) == iPlayerToNum(eventIPlayerOfficer.value))
                ? { localOfficer: true, localActiveTrader: false, iPlayerActiveTrader: eventIPlayerActiveTrader.value }
                : {
                  localOfficer: false,
                  iPlayerOfficer: eventIPlayerOfficer.value,
                  ...((iPlayerToNum(iPlayerLocal) == iPlayerToNum(eventIPlayerActiveTrader.value))
                    ? {
                      localActiveTrader: true,
                      // We must not've been the localActiveTrader before, so simply start fresh instead of checking for existing selected list:
                      selectedSupplyContractsFromReadyPool: Array(readyPoolSize).fill(false)
                    }
                    : { localActiveTrader: false, iPlayerActiveTrader: eventIPlayerActiveTrader.value }
                  )
                }
              ),
            });
          } break;

          case "Pack": {
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
            if (eventTraderSupplies.hasValue === false || eventCartStates.hasValue === false || eventIPlayerOfficer.hasValue === false) {
              console.log(`Received bad STATE_UPDATE: ${JSON.stringify(event)}`);
              break;
            }
            setClientGameState({
              state: "Pack",
              round: event.data.state.round,
              communityPools: event.data.state.communityPools,
              traderSupplies: eventTraderSupplies.value,
              otherCartStates: eventCartStates.value,
              ...((iPlayerToNum(iPlayerLocal) == iPlayerToNum(eventIPlayerOfficer.value))
                ? { localOfficer: true }
                : {
                  localOfficer: false,
                  iPlayerOfficer: eventIPlayerOfficer.value,
                  ...((() => {
                    const localCart = eventCartStates.value.get(iPlayerLocal);

                    if (localCart.packed == true) {
                      return {
                        localState: "done",
                        localCart: localCart.cart
                      };
                    } else if (clientGameState.state == "Pack" && clientGameState.localOfficer == false && clientGameState.localState == "packing") {
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
              ),
            });
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
                      proposedDeal: event.data.state.proposedDeal,
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
                      )
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
                      result: (event.data.state.result == "ignored for deal")
                        ? { result: "ignored for deal", deal: event.data.state.deal }
                        : (event.data.state.result == "searched")
                          ? { result: "searched", iProductCheekyDelay: event.data.state.iProductCheekyDelay }
                          : { result: "ignored" }
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
        onExternalOfficerToolUpdateRegistrations.forEach(c => { if (c.hasValue == true) c.value({ update: event.data }) });
      } break;
    }
  }

  const serverHandleReceivedClientEvent = function (event: NetworkTypes.ClientEvent) {
    switch (event.type) {
      case NetworkTypes.ClientEventType.IDENTIFY:
        // unexpected. ignore? TODO
        break;

      case NetworkTypes.ClientEventType.SWAP_SUPPLY_CONTRACTS: {
        if (serverGameState.state == "Swap" && props.clients.get(serverGameState.iPlayerActiveTrader).clientId == event.data.sourceClientId) {
          const nextState: Optional<SerializableServerGameState> = (() => {
            const iPlayerNext = props.clients.incrementIndexModLength(serverGameState.iPlayerActiveTrader, 1);
            const newPools: CommunityContractPools = {
              generalPoolContractCounts: serverGameState.communityPools.generalPoolContractCounts.shallowCopy(),
              recyclePoolsContracts: [serverGameState.communityPools.recyclePoolsContracts[0]?.shallowCopy() ?? []].concat(serverGameState.communityPools.recyclePoolsContracts.skip(1))
            };
            const readyPoolRecycling =
              serverGameState.traderSupplies.get(serverGameState.iPlayerActiveTrader).readyPool
                .zip(event.data.recycled);
            if (readyPoolRecycling === undefined) {
              console.log(`Received bad SWAP_SUPPLY_CONTRACTS client event: ${JSON.stringify(event)}`);
              console.trace();
              return nullopt;
            }
            const [readyPoolRecycled, newReadyPool] = readyPoolRecycling.splitMap(([product, recycling]) => [recycling, product]);
            newReadyPool.push(...takeContractsFromGeneralPool(props.settings, newPools, readyPoolRecycled.length));
            (newPools.recyclePoolsContracts[0] ?? []).push(...readyPoolRecycled);
            const newTraderSupplies = serverGameState.traderSupplies.shallowCopy();
            newTraderSupplies.set(serverGameState.iPlayerActiveTrader, {
              ...serverGameState.traderSupplies.get(serverGameState.iPlayerActiveTrader),
              readyPool: newReadyPool
            });
            if (iPlayerToNum(iPlayerNext) != iPlayerToNum(serverGameState.iPlayerOfficer)) {
              return opt({
                state: "Swap",
                round: serverGameState.round,
                communityPools: newPools,
                traderSupplies: newTraderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                iPlayerActiveTrader: iPlayerNext.value,
              });
            } else {
              return opt({
                state: "Pack",
                round: serverGameState.round,
                communityPools: newPools,
                traderSupplies: newTraderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                cartStates: props.clients.map(() => { return { "packed": false as false }; }).arr
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
        if (serverGameState.state == "Pack" && iPlayerToNum(serverGameState.iPlayerOfficer) != iPlayerToNum(iPlayerEvent) && serverGameState.cartStates.get(iPlayerEvent).packed == false) {
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
                iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                iPlayerActiveTrader: props.clients.incrementIndexModLength(serverGameState.iPlayerOfficer, 1).value,
                cartStates: nextStateCartStatesOpt.value.arr
              });
            } else {
              return opt({
                state: "Pack",
                round: serverGameState.round,
                communityPools: serverGameState.communityPools,
                traderSupplies: newTraderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
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
            (iPlayerToNum(serverGameState.iPlayerOfficer) == iPlayerToNum(iPlayerEvent) && event.data.action.action != "resolve completed")
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
              && event.data.action.action == "resolve completed"
              && (iPlayerToNum(iPlayerEvent) == iPlayerToNum(iPlayerLocal) && props.hostInfo.localHost == true)
            )
          )
        ) {
          if (serverGameState.customsState == "interrogating" && event.data.action.action == "officer tool update") {
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
                iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                cartStates: serverGameState.cartStates.arr,
                customsState: "interrogating",
                iPlayerActiveTrader: eventIPlayerTrader.value.value,
                proposedDeal: nullopt
              });
            } else if (serverGameState.customsState == "interrogating") {
              if (event.data.action.action == "resume interrogation") {
                handleUnexpectedState();
                return nullopt;
              } else if (event.data.action.action == "pause interrogation") {
                return opt({
                  state: "Customs",
                  round: serverGameState.round,
                  communityPools: serverGameState.communityPools,
                  traderSupplies: serverGameState.traderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                  iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                  cartStates: serverGameState.cartStates.arr,
                  customsState: "ready"
                });
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
                  })
                });
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
                    proposedDeal: nullopt
                  });
                }
              } else { // ignore cart, search cart, or accept deal
                return opt({
                  state: "Customs",
                  round: serverGameState.round,
                  communityPools: serverGameState.communityPools,
                  traderSupplies: serverGameState.traderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                  iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                  cartStates: serverGameState.cartStates.arr,
                  customsState: "resolving",
                  iPlayerActiveTrader: serverGameState.iPlayerActiveTrader.value,
                  ...((event.data.action.action == "accept deal")
                    ? {
                      result: "ignored for deal",
                      deal: (serverGameState.proposedDeal.hasValue == false)// TODO fix, this is proven false
                        ? handleUnexpectedState() as IgnoreDeal
                        : serverGameState.proposedDeal.value
                    }
                    : (event.data.action.action == "search cart")
                      ? {
                        result: "searched", iProductCheekyDelay: (() => {
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
                        })()
                      }
                      : { result: "ignored" }
                  )
                })
              }
            } else { // "resolving"
              const suspectCartState = serverGameState.cartStates.get(serverGameState.iPlayerActiveTrader);
              if (suspectCartState.packed == false || event.data.action.action != "resolve completed") {
                handleUnexpectedState();
                return nullopt;
              }

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
              if (serverGameState.result == "ignored" || serverGameState.result == "ignored for deal") {
                suspectCartState.cart.products.forEach(p => {
                  newTraderSupplies.get(serverGameState.iPlayerActiveTrader).shopProductCounts.set(p, newTraderSupplies.get(serverGameState.iPlayerActiveTrader).shopProductCounts.get(p) + 1);
                });
                if (serverGameState.result == "ignored for deal") {
                  // execute deal
                  newTraderSupplies.get(serverGameState.iPlayerActiveTrader).money += serverGameState.deal.officerGives.money;
                  newTraderSupplies.get(serverGameState.iPlayerActiveTrader).money -= serverGameState.deal.traderGives.money;
                  newTraderSupplies.get(serverGameState.iPlayerOfficer).money += serverGameState.deal.traderGives.money;
                  newTraderSupplies.get(serverGameState.iPlayerOfficer).money -= serverGameState.deal.officerGives.money;
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
                  });
                } else {
                  return opt({
                    state: "Swap",
                    round: newRound,
                    communityPools: newPools,
                    traderSupplies: newTraderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                    iPlayerOfficer: props.clients.incrementIndexModLength(serverGameState.iPlayerOfficer, 1).value,
                    iPlayerActiveTrader: props.clients.incrementIndexModLength(serverGameState.iPlayerOfficer, 2).value,
                  });
                }
              } else {
                const newCartStates = serverGameState.cartStates.shallowCopy();
                newCartStates.set(serverGameState.iPlayerActiveTrader, { "packed": false });
                return opt({
                  state: "Customs",
                  round: serverGameState.round,
                  communityPools: newPools,
                  traderSupplies: newTraderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
                  iPlayerOfficer: serverGameState.iPlayerOfficer.value,
                  cartStates: newCartStates.arr,
                  customsState: "ready"
                });
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
        state: "Swap",
        round: 0,
        communityPools: persistentGameState.communityPools,
        traderSupplies: persistentGameState.traderSupplies.arr.map(s => ({ ...s, shopProductCounts: s.shopProductCounts.arr })),
        iPlayerOfficer: iPlayerOfficer.value,
        iPlayerActiveTrader: props.clients.incrementIndexModLength(iPlayerOfficer, 1).value
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
  const toSequentialTraderOrdering = (iPlayer: ValidatedPlayerIndex) => (iPlayer.value + props.clients.length - iPlayerOfficer.value - 1) % props.clients.length;

  const currentTraderSupplies =
    clientGameState.state == "Customs" && clientGameState.customsState == "resolving"
      ? clientGameState.wipTraderSupplies
      : clientGameState.traderSupplies;
  console.log(currentTraderSupplies);

  const animation: Optional<GameAnimationSequence> = (() => {
    const animationSequence = ((): Optional<{ sequence: GameAnimationStep[], onComplete: () => void }> => {
      switch (clientGameState.state) {
        case "Swap":
        case "Refresh":
        case "Pack":
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
              }
            });
          } else {
            return nullopt;
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
                  }
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
                  }
                })
              } else {
                return nullopt;
              }
            }
            case "resolving": {
              return opt({
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
                      { // fine revealed
                        type: "wait",
                        delayMs: 2000,
                      },
                      {
                        type: "payment",
                        action: "give",
                        iPlayerGiver: (illegalProducts.length > 0) ? iPlayerActiveTrader : iPlayerOfficer,
                        iPlayerReceiver: (illegalProducts.length > 0) ? iPlayerOfficer : iPlayerActiveTrader,
                        payment: {
                          money: (illegalProducts.length > 0 ? illegalProducts : legalProducts).map(p => getProductInfo(p).fine as number).reduce((a, b) => a + b, 0)
                        }
                      },
                      {
                        type: "wait",
                        delayMs: 1000
                      },
                      {
                        type: "payment",
                        action: "receive",
                        iPlayerGiver: (illegalProducts.length > 0) ? iPlayerActiveTrader : iPlayerOfficer,
                        iPlayerReceiver: (illegalProducts.length > 0) ? iPlayerOfficer : iPlayerActiveTrader,
                        payment: {
                          money: (illegalProducts.length > 0 ? illegalProducts : legalProducts).map(p => getProductInfo(p).fine as number).reduce((a, b) => a + b, 0)
                        }
                      },
                      {
                        type: "wait",
                        delayMs: 2000,
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
                      (
                        (clientGameState.result.result != "ignored for deal")
                          ? [] as GameAnimationStep[]
                          : (
                            (
                              (clientGameState.result.deal.traderGives.money == 0)
                                ? []
                                : [
                                  { // payment will reveal
                                    type: "wait",
                                    delayMs: 2000
                                  },
                                  {
                                    type: "payment",
                                    action: "give",
                                    iPlayerGiver: iPlayerActiveTrader,
                                    iPlayerReceiver: iPlayerOfficer,
                                    payment: {
                                      money: clientGameState.result.deal.traderGives.money
                                    }
                                  },
                                  {
                                    type: "wait",
                                    delayMs: 1000,
                                  },
                                  {
                                    type: "payment",
                                    action: "receive",
                                    iPlayerGiver: iPlayerActiveTrader,
                                    iPlayerReceiver: iPlayerOfficer,
                                    payment: {
                                      money: clientGameState.result.deal.traderGives.money
                                    }
                                  },
                                  {
                                    type: "wait",
                                    delayMs: 1000,
                                  },
                                ]
                            ).concat(
                              (clientGameState.result.deal.officerGives.money == 0)
                                ? []
                                : [
                                  { // payment will reveal
                                    type: "wait",
                                    delayMs: 2000
                                  },
                                  {
                                    type: "payment",
                                    action: "give",
                                    iPlayerGiver: iPlayerOfficer,
                                    iPlayerReceiver: iPlayerActiveTrader,
                                    payment: {
                                      money: clientGameState.result.deal.officerGives.money,
                                    }
                                  },
                                  { // payment will reveal
                                    type: "wait",
                                    delayMs: 2000
                                  },
                                  {
                                    type: "payment",
                                    action: "receive",
                                    iPlayerGiver: iPlayerOfficer,
                                    iPlayerReceiver: iPlayerActiveTrader,
                                    payment: {
                                      money: clientGameState.result.deal.officerGives.money,
                                    }
                                  },
                                  { // payment will reveal
                                    type: "wait",
                                    delayMs: 1000
                                  },
                                ]
                            )
                          ) as GameAnimationStep[]
                      )
                        .concat([
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
                        ])
                    );
                  }
                })()
              });
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
      })
      : nullopt;
  })();

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
    <div id="menu_game">
      <Section id="menu_game_title">
        <div>
          Round {clientGameState.round + 1} of {props.settings.numRounds}: {(() => {
            switch (clientGameState.state) {
              case "Swap":
                return "Exchange Supply Contracts";
              case "Pack":
                return "Prepare Cart";
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
              case "Swap":
                return (clientGameState.localOfficer == true)
                  ? (<span>Wait while traders exchange supply contracts<AnimatedEllipses /></span>)
                  : (clientGameState.localActiveTrader == true)
                    ? "Recycle and replace your supply contracts"
                    : (toSequentialTraderOrdering(iPlayerLocal) <= toSequentialTraderOrdering(clientGameState.iPlayerActiveTrader))
                      ? (<span>Wait while the remaining traders exchange supply contracts<AnimatedEllipses /></span>)
                      : (<span>Wait for your turn to exchange supply contracts<AnimatedEllipses /></span>);
              case "Pack":
                return (clientGameState.localOfficer == true)
                  ? (<span>Wait while traders pack their carts with products<AnimatedEllipses /></span>)
                  : (clientGameState.localState == "packing")
                    ? "Select products to pack into your cart, and decide which kind of legal product you'll tell the officer your cart contains"
                    : (<span>Wait while the remaining traders pack their carts<AnimatedEllipses /></span>);
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
                    ? "Withstand interrogation from the officer about your cart's contents"
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
                                case "Swap":
                                case "Refresh":
                                  return { labeled: false, state: "no crate" }
                                case "Pack":
                                case "CustomsIntro":
                                case "Customs": {
                                  const cartState =
                                    (clientGameState.state == "Pack")
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
                                        } else if (clientGameState.state == "Pack") { // trader is packing
                                          return "open crate";
                                        } else { // Customs crate unpacked
                                          return "no crate";
                                        }
                                      })()
                                    };
                                  }
                                }
                              }
                            })()}
                            officerTools={{
                              present: false,
                              controls: {
                                localControllable: false,
                                registerEventHandlers: (_args) => ({ handlerRegistrationId: -1 }),
                                unregisterEventHandlers: (_args) => { }
                              }
                            }}
                          />
                        </div>
                      )
                  }
                  { // status message
                    (() => {
                      switch (clientGameState.state) {
                        case "Swap":
                          if (
                            (clientGameState.localActiveTrader === true && iPlayerToNum(iPlayer) === iPlayerToNum(iPlayerLocal))
                            || (clientGameState.localActiveTrader == false && iPlayerToNum(clientGameState.iPlayerActiveTrader) == iPlayerToNum(iPlayer))
                          ) {
                            return (<span>Swapping Supply Contracts<AnimatedEllipses /></span>);
                          }
                          return;

                        case "Pack":
                          if (
                            (iPlayerToNum(iPlayer) === iPlayerToNum(iPlayerLocal))
                              ? (clientGameState.localOfficer === false && clientGameState.localState === "packing")
                              : (iPlayerToNum(iPlayer) !== iPlayerToNum(iPlayerOfficer) && clientGameState.otherCartStates.get(iPlayer).packed == false)
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
              <Section style={{ display: "inline-block", verticalAlign: "top", minWidth: "400px" }} />
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
                            (iPlayerToNum(iPlayerLocal) == iPlayerToNum(iPlayerOfficer) && active && clientGameState.state == "Customs")
                              ? {
                                present: true,
                                state: opt({ tool: "crowbar", useProgress: 0 }),
                                controls: {
                                  localControllable: true,
                                  onInternalOfficerToolUpdate: (() => {
                                    // buffer these events to avoid spamming server
                                    let newUpdateToSend: NetworkTypes.OfficerToolState = nullopt;
                                    let sendState: (
                                      | { queued: false, lastSendTimeMs: number }
                                      | { queued: true }
                                    ) =
                                      { queued: false, lastSendTimeMs: 0 };
                                    let fullyUsedCrowbarEventSent = false;
                                    const sendTheNewToolStateToSend = () => {
                                      const sendingUpdate = newUpdateToSend;
                                      sendState = { queued: false, lastSendTimeMs: Date.now() };

                                      if (!fullyUsedCrowbarEventSent) {
                                        clientSendClientEventToServer({
                                          type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                                          data: {
                                            sourceClientId: props.localInfo.clientId,
                                            action: {
                                              action: "officer tool update",
                                              update: {
                                                newToolState: sendingUpdate,
                                              }
                                            }
                                          }
                                        });

                                        if (sendingUpdate.hasValue == true
                                          && sendingUpdate.value.tool == "crowbar"
                                          && sendingUpdate.value.useProgress >= 1
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
                                      newUpdateToSend = event.newToolState;
                                      if (sendState.queued == false) {
                                        const minimumRepeatSendIntervalMs = crowbarUpdateMinIntervalMs;
                                        const intervalSinceLastSend = Date.now() - sendState.lastSendTimeMs;
                                        if (intervalSinceLastSend < minimumRepeatSendIntervalMs) {
                                          sendState = { queued: true };
                                          setTimeout(sendTheNewToolStateToSend, (minimumRepeatSendIntervalMs - intervalSinceLastSend));
                                        } else {
                                          sendTheNewToolStateToSend();
                                        }
                                      }
                                    };
                                  })()
                                }
                              }
                              : {
                                present: false,
                                controls: {
                                  localControllable: false,
                                  registerEventHandlers: (args) => {
                                    onExternalOfficerToolUpdateRegistrations.push(opt((event) => {
                                      args.onExternalOfficerToolUpdate(event.update);
                                    }));
                                    return { handlerRegistrationId: onExternalOfficerToolUpdateRegistrations.length - 1 };
                                  },
                                  unregisterEventHandlers: (handlerRegistrationId) => {
                                    onExternalOfficerToolUpdateRegistrations[handlerRegistrationId] = nullopt;
                                  },
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
                          message={(() => {
                            if (clientGameState.state == "CustomsIntro") {
                              const cartState = clientGameState.cartStates.get(clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader);
                              if (cartState.packed == true && cartState.cart.claimMessage.hasValue == true) {
                                return cartState.cart.claimMessage.value;
                              }
                            }
                            return "";
                          })()}
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
                                  <div>Search the crate (pull crowbar)</div>
                                  <div>
                                    <span style={{ display: "inline-block" }}>or{" "}</span>
                                    <button
                                      style={{ display: "inline-block" }}
                                      onClick={() => {
                                        clientSendClientEventToServer({
                                          type: NetworkTypes.ClientEventType.CUSTOMS_ACTION,
                                          data: {
                                            sourceClientId: props.localInfo.clientId,
                                            action: {
                                              action: "ignore cart"
                                            }
                                          }
                                        });
                                      }}
                                    >
                                      Allow Through Without Search
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
                              : undefined
                          }
                          {
                            [
                              {
                                icon: moneyIcon,
                                amount: ((args.givingIsOfficer) ? proposedDeal.value.officerGives : proposedDeal.value.traderGives).money
                              }
                            ]
                              .filter(s => s.amount > 0)
                              .map(s => (
                                <div>{s.amount} {s.icon}</div>
                              ))
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
                          </Section>
                          { // buttons
                            (waitingOnLocal)
                              ? (
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
                              )
                              : (localInvolved)
                                ? (
                                  <div>
                                    Waiting for other player to respond<AnimatedEllipses />
                                  </div>
                                )
                                : undefined
                          }
                        </Section>
                      );
                    })()
                    : undefined
                }
                { // <Section Payment
                  (
                    clientGameState.state == "Customs"
                    && clientGameState.customsState == "resolving"
                    && (clientGameState.result.result != "ignored")
                  )
                    ? (() => {
                      const PaymentArea = (paymentAreaProps: {
                        title: string,
                        animation: Optional<GameAnimationSequence>,
                      }) => {
                        const [iGameAnimationStep, setIGameAnimationStep] = React.useState(0);

                        React.useEffect(() => {
                          if (paymentAreaProps.animation.hasValue == true) {
                            console.log(`Payment Area subscribing`);
                            paymentAreaProps.animation.value.onCompleteRegistrations.forEach((r, i) => r.push(() => {
                              setIGameAnimationStep(i + 1);
                              console.log(`Payment Area updated to animation step ${i + 1}`);
                            }));
                          }
                        }, []);

                        const payments = (() => {
                          const payments: {
                            iPlayerGiver: ValidPlayerIndex,
                            payment: { money: number },
                            iAnimationStepGive: number,
                            iAnimationStepReveal: number,
                            iAnimationStepDistribute: number,
                          }[] = [];
                          if (animation.hasValue == true) {
                            animation.value.sequence.forEach((step, i) => {
                              if (step.type == "payment") {
                                const matchingPayment = (() => {
                                  const matchingPayments = payments.filter(p => iPlayerToNum(p.iPlayerGiver) == iPlayerToNum(step.iPlayerGiver));
                                  const firstMatchingPayment = matchingPayments[0];
                                  if (firstMatchingPayment !== undefined) return firstMatchingPayment;
                                  else {
                                    const newPayment = {
                                      iPlayerGiver: step.iPlayerGiver,
                                      payment: step.payment,
                                      iAnimationStepGive: 0,
                                      iAnimationStepReveal: 0,
                                      iAnimationStepDistribute: 0,
                                    };
                                    payments.push(newPayment);
                                    return newPayment;
                                  }
                                })();
                                if (step.action == "give") {
                                  matchingPayment.iAnimationStepGive = i;
                                  matchingPayment.iAnimationStepReveal = i - 1;
                                } else {
                                  matchingPayment.iAnimationStepDistribute = i;
                                }
                              }
                            });
                          }
                          return payments;
                        })();

                        /*
                        const givePayments =
                          animation.hasValue == false
                            ? []
                            : animation.value.sequence.filterTransform(step => step.type == "payment" && step.action == "give" ? opt((step as PaymentGameAnimationStep)) : nullopt);
                        const givePaymentsRevealed =
                          givePayments.map(p =>
                            paymentAreaProps.animation.hasValue == true
                            && paymentAreaProps.animation.value.sequence.some((step, i) => iGameAnimationStep >= i - 1 && step.type == "payment" && step.iPlayerGiver == p.iPlayerGiver));
                        */

                        return (
                          <Section title={paymentAreaProps.title} style={{ opacity: payments.some(p => iGameAnimationStep >= p.iAnimationStepReveal) ? 1 : 0 }}>
                            {
                              payments
                                .map(payment => {
                                  const givingList = (() => (
                                    <div>
                                      {
                                        [
                                          {
                                            icon: moneyIcon,
                                            amount: payment.payment.money
                                          }
                                        ]
                                          .filter(s => s.amount > 0)
                                          .map(s => (
                                            <span key={`menu_game_payment_player_${iPlayerToNum(payment.iPlayerGiver)}_icon_${s.icon}`}>
                                              {s.amount}{" "}
                                              <span
                                                style={{ opacity: (iGameAnimationStep > payment.iAnimationStepGive && iGameAnimationStep < payment.iAnimationStepDistribute) ? 1 : 0.3 }}
                                                id={`menu_game_payment_player_${iPlayerToNum(payment.iPlayerGiver)}_item_money`}>{s.icon}
                                              </span>
                                            </span>
                                          ))
                                      }
                                    </div>
                                  ))();

                                  return (
                                    <Section
                                      key={`menu_game_payment_area_${iPlayerToNum(payment.iPlayerGiver)}`}
                                      title={`${props.clients.get(payment.iPlayerGiver).name} pays:`}
                                      style={{ opacity: iGameAnimationStep >= payment.iAnimationStepReveal ? 1 : 0 }}
                                    >
                                      {givingList}
                                    </Section>
                                  );
                                })
                            }
                          </Section>
                        );
                      }

                      const iPlayerActiveTrader = clientGameState.localActiveTrader == true ? iPlayerLocal : clientGameState.iPlayerActiveTrader;
                      const activeCart = clientGameState.cartStates.get(iPlayerActiveTrader);
                      if (activeCart.packed == false) {
                        // TODO fix shouldn't happen
                        return (<div></div>);
                      }
                      if (clientGameState.result.result == "searched") {
                        return (
                          <PaymentArea
                            key={`menu_game_payment_area_rerender_${renderCount.current}`}
                            title={activeCart.cart.products.every(p => p == activeCart.cart.claimedType) ? "Trader unreasonably searched!" : "Smuggling caught!"}
                            animation={animation}
                          />
                        );
                      } else { // deal struck
                        return (
                          <PaymentArea
                            key={`menu_game_payment_area_rerender_${renderCount.current}`}
                            title={"Deal accepted!"}
                            animation={animation}
                          />
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
            (clientGameState.localOfficer == false && clientGameState.state == "Pack" && clientGameState.localState == "packing")
              ? (
                <Section
                  title="Prepare Customs Statement"
                  style={{
                    display:
                      (clientGameState.state == "Pack" && clientGameState.localOfficer == false && clientGameState.localState == "packing")
                        ? "inline-block" : "none",
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
                    id="menu_connect_input_address" // unused - just a unique value to facilitate autofill
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
                                      money: 0
                                    },
                                    traderGives: {
                                      money: 0
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
                                  const giveableSupplies = (
                                    nobodyGivingSupplies
                                      .sort((a, b) => a.ordering - b.ordering)
                                      .filterTransform((s) =>
                                        (s.currentGiving.giveable == true)
                                          ? opt({
                                            id: s.id,
                                            icon: s.icon,
                                            set: s.currentGiving.set
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
                                            onChange={(e) => giveableSupplies.filter(s => s.id == parseInt(e.target.value))[0]?.set(1)}
                                          >
                                            <option disabled selected value=""></option>
                                            {
                                              giveableSupplies
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
                                <Section
                                  title={`Trader ${props.clients.get(iPlayerActiveTrader).name} Gives:`}
                                  style={{ display: "inline-block" }}
                                >
                                  <GiveInterface
                                    giverIsOfficer={false}
                                    giverSupplies={currentTraderSupplies.get(iPlayerOfficer)}
                                  />
                                </Section>
                                <Section
                                  title={`Officer ${props.clients.get(iPlayerOfficer).name} Gives:`}
                                  style={{ display: "inline-block" }}
                                >
                                  <GiveInterface
                                    giverIsOfficer={true}
                                    giverSupplies={currentTraderSupplies.get(iPlayerActiveTrader)}
                                  />
                                </Section>
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
                                  deal
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
              (clientGameState.state == "Swap" && clientGameState.localActiveTrader)
              || (clientGameState.state == "Pack" && clientGameState.localOfficer == false && clientGameState.localState == "packing"))
              ? undefined : "Supply Contracts"}
            style={{ display: "inline-block", verticalAlign: "top", flexGrow: "1" }}
          >
            <LocalReadyPool
              key={`menu_game_local_ready_pool_ready_pool_${clientGameState.state}`}
              usekey="menu_game_local_ready_pool_ready_pool"
              contracts={currentTraderSupplies.get(iPlayerLocal).readyPool}
              mode={
                (
                  (clientGameState.state == "Swap" && clientGameState.localActiveTrader)
                  || (clientGameState.state == "Pack" && clientGameState.localOfficer == false && clientGameState.localState == "packing")
                )
                  ? {
                    mode: "select for exit",
                    selectInstruction: `Click Contracts to ${clientGameState.state == "Swap" ? "Recycle" : "Pack into Crate"}`,
                    exitTitle: clientGameState.state == "Swap" ? "Recycle" : "Pack",
                    entry: clientGameState.state == "Swap" ? opt({ type: "general pool", title: "Acquiring" }) : nullopt,
                    isSubmittable: () => true, // clientGameState.state == "Swap" || (selected.some(s => s) && clientGameState.claimedProductType.hasValue),
                    onSubmit: ({ selected }) => {
                      if (clientGameState.state == "Swap") {
                        clientSendClientEventToServer({
                          type: NetworkTypes.ClientEventType.SWAP_SUPPLY_CONTRACTS,
                          data: {
                            sourceClientId: props.localInfo.clientId,
                            recycled: selected
                          }
                        });
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
                              packed: selected,
                              claimedType: clientGameState.claimedProductType.value,
                              claimMessage: claimMessage == "" ? nullopt : opt(claimMessage)
                            }
                          });
                        }
                      }
                    },
                    onChange: ({ selected }) => {
                      if (clientGameState.state == "Pack") {
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
                          case "Swap":
                          case "Refresh":
                            return { labeled: false, state: "no crate" }
                          case "Pack":
                            if (clientGameState.localOfficer == true) {
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
                      officerTools={{
                        present: false,
                        controls: {
                          localControllable: false,
                          registerEventHandlers: (_args) => ({ handlerRegistrationId: -1 }),
                          unregisterEventHandlers: (_args) => { }
                        }
                      }}
                    />
                  </Section>
                );
              })()
            }

            { // <Section Cart Info
              (
                clientGameState.localOfficer == false
                && (
                  clientGameState.state == "Pack"
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
                <SupplyContract productType={opt(p.type)} />
              </div>
            ))
            .arr
        }
      </Section>
    </div >
  )
}