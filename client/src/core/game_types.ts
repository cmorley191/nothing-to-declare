import { Optional, getRandomInt, nullopt, nullopt_t, opt } from "./util";

export const playerIcons = ["😘", "😈", "🎅🏽", "🧙🏽", "💩", "💀", "🤡", "👻", "👽", "🤖", "😹", "🐵"];
export const illegalProductIcon = "⛓️";
export const legalProductIcon = "✅";
export const rareProductIcon = "✨";
export const unknownProductIcon = "❓";
export const moneyIcon = "💰";
export const fineIcon = "🚨";
export const recycleIcon = "🗑️";
export const trophyIcon = "🏆";
export const firstPlaceIcon = "🥇";
export const secondPlaceIcon = "🥈";
export const pointIcon = "⭐";
export const winnerIcon = "👑";

export enum ProductType {
  MILK = 0,
  GRAPES = 1,
  PIGS = 2,
  STRAWBERRIES = 3,

  CHEESE = 4,
  ICECREAM = 5,
  JUICE = 6,
  WINE = 7,
  SAUSAGE = 8,
  BACON = 9,
  SHORTCAKE = 10,

  COFFEE = 11,
  HERBS = 12,
  GEMS = 13,
  SWORDS = 14,
}
export const validateProductType = (i: number): Optional<ProductType> => {
  switch (i) {
    case ProductType.MILK:
    case ProductType.GRAPES:
    case ProductType.PIGS:
    case ProductType.STRAWBERRIES:
    case ProductType.CHEESE:
    case ProductType.ICECREAM:
    case ProductType.JUICE:
    case ProductType.WINE:
    case ProductType.SAUSAGE:
    case ProductType.BACON:
    case ProductType.SHORTCAKE:
    case ProductType.COFFEE:
    case ProductType.HERBS:
    case ProductType.GEMS:
    case ProductType.SWORDS:
      return opt(i);
    default:
      return nullopt;
  }
}
export class ProductArray<T> {
  arr: T[] // TODO make private

  private constructor(arr: T[]) {
    if (arr.length != 15) throw `ProductArray constructed with wrong amount of items: ${JSON.stringify(arr)}`;
    this.arr = arr;
  }

  static tryNewArray<U>(arr: U[]) {
    if (arr.length != 15) return nullopt;
    else return opt(new ProductArray(arr));
  }
  static newArray<U>(arr: [U, U, U, U, U, U, U, U, U, U, U, U, U, U, U]) {
    return new ProductArray(arr);
  }

  get(index: ProductType) {
    const obj = this.arr[index];
    if (obj === undefined) {
      throw `ProductArray index error. index: ${index}, arr: ${JSON.stringify(this.arr)}`;
    }
    return obj;
  }

  set(index: ProductType, obj: T) {
    this.arr[index] = obj;
  }

  shallowCopy() {
    return new ProductArray(this.arr.shallowCopy());
  }

  map<U>(transformer: (obj: T, index: ProductType) => U) {
    return new ProductArray(this.arr.map(transformer))
  }
}

export type AwardType =
  | ProductType.MILK
  | ProductType.GRAPES
  | ProductType.PIGS
  | ProductType.STRAWBERRIES;
export const awardTypes = [
  { awardType: ProductType.MILK, firstPlaceEarnings: 20, secondPlaceEarnings: 10 },
  { awardType: ProductType.GRAPES, firstPlaceEarnings: 15, secondPlaceEarnings: 10 },
  { awardType: ProductType.PIGS, firstPlaceEarnings: 15, secondPlaceEarnings: 10 },
  { awardType: ProductType.STRAWBERRIES, firstPlaceEarnings: 10, secondPlaceEarnings: 5 },
]

export type AwardInfo = { productType: AwardType, points: number }

export type ProductCategory = "legal" | "rare" | "illegal";

export type ProductInfoSpec = {
  type: ProductType,
  name: string,
  category: ProductCategory
  icon: string,
  value: number,
  fine: number,
  legal: boolean,
  award: Optional<AwardInfo>
}

export type ProductInfoMilk = { type: ProductType.MILK, name: "Milk", category: "legal", icon: "🥛", value: 2, fine: 2, legal: true, award: { hasValue: true, value: { productType: ProductType.MILK, points: 1 } } };
export const productInfoMilk: ProductInfoMilk = { type: ProductType.MILK, name: "Milk", category: "legal", icon: "🥛", value: 2, fine: 2, legal: true, award: { hasValue: true, value: { productType: ProductType.MILK, points: 1 } } };
export type ProductInfoGrapes = { type: ProductType.GRAPES, name: "Grapes", category: "legal", icon: "🍇", value: 3, fine: 2, legal: true, award: { hasValue: true, value: { productType: ProductType.GRAPES, points: 1 } } };
export const productInfoGrapes: ProductInfoGrapes = { type: ProductType.GRAPES, name: "Grapes", category: "legal", icon: "🍇", value: 3, fine: 2, legal: true, award: { hasValue: true, value: { productType: ProductType.GRAPES, points: 1 } } };
export type ProductInfoPigs = { type: ProductType.PIGS, name: "Pigs", category: "legal", icon: "🐖", value: 3, fine: 2, legal: true, award: { hasValue: true, value: { productType: ProductType.PIGS, points: 1 } } };
export const productInfoPigs: ProductInfoPigs = { type: ProductType.PIGS, name: "Pigs", category: "legal", icon: "🐖", value: 3, fine: 2, legal: true, award: { hasValue: true, value: { productType: ProductType.PIGS, points: 1 } } };
export type ProductInfoStrawberries = { type: ProductType.STRAWBERRIES, name: "Strawberries", category: "legal", icon: "🍓", value: 4, fine: 2, legal: true, award: { hasValue: true, value: { productType: ProductType.STRAWBERRIES, points: 1 } } };
export const productInfoStrawberries: ProductInfoStrawberries = { type: ProductType.STRAWBERRIES, name: "Strawberries", category: "legal", icon: "🍓", value: 4, fine: 2, legal: true, award: { hasValue: true, value: { productType: ProductType.STRAWBERRIES, points: 1 } } };

export type ProductInfoCheese = { type: ProductType.CHEESE, name: "Cheese", category: "rare", icon: "🧀", value: 4, fine: 3, legal: false, award: { hasValue: true, value: { productType: ProductType.MILK, points: 2 } } };
export const productInfoCheese: ProductInfoCheese = { type: ProductType.CHEESE, name: "Cheese", category: "rare", icon: "🧀", value: 4, fine: 3, legal: false, award: { hasValue: true, value: { productType: ProductType.MILK, points: 2 } } };
export type ProductInfoIceCream = { type: ProductType.ICECREAM, name: "Ice Cream", category: "rare", icon: "🍦", value: 6, fine: 4, legal: false, award: { hasValue: true, value: { productType: ProductType.MILK, points: 3 } } };
export const productInfoIceCream: ProductInfoIceCream = { type: ProductType.ICECREAM, name: "Ice Cream", category: "rare", icon: "🍦", value: 6, fine: 4, legal: false, award: { hasValue: true, value: { productType: ProductType.MILK, points: 3 } } };
export type ProductInfoJuice = { type: ProductType.JUICE, name: "Juice", category: "rare", icon: "🧃", value: 6, fine: 4, legal: false, award: { hasValue: true, value: { productType: ProductType.GRAPES, points: 2 } } };
export const productInfoJuice: ProductInfoJuice = { type: ProductType.JUICE, name: "Juice", category: "rare", icon: "🧃", value: 6, fine: 4, legal: false, award: { hasValue: true, value: { productType: ProductType.GRAPES, points: 2 } } };
export type ProductInfoWine = { type: ProductType.WINE, name: "Wine", category: "rare", icon: "🍷", value: 9, fine: 5, legal: false, award: { hasValue: true, value: { productType: ProductType.GRAPES, points: 3 } } };
export const productInfoWine: ProductInfoWine = { type: ProductType.WINE, name: "Wine", category: "rare", icon: "🍷", value: 9, fine: 5, legal: false, award: { hasValue: true, value: { productType: ProductType.GRAPES, points: 3 } } };
export type ProductInfoSausage = { type: ProductType.SAUSAGE, name: "Sausage", category: "rare", icon: "🌭", value: 6, fine: 4, legal: false, award: { hasValue: true, value: { productType: ProductType.PIGS, points: 2 } } };
export const productInfoSausage: ProductInfoSausage = { type: ProductType.SAUSAGE, name: "Sausage", category: "rare", icon: "🌭", value: 6, fine: 4, legal: false, award: { hasValue: true, value: { productType: ProductType.PIGS, points: 2 } } };
export type ProductInfoBacon = { type: ProductType.BACON, name: "Bacon", category: "rare", icon: "🥓", value: 9, fine: 5, legal: false, award: { hasValue: true, value: { productType: ProductType.PIGS, points: 3 } } };
export const productInfoBacon: ProductInfoBacon = { type: ProductType.BACON, name: "Bacon", category: "rare", icon: "🥓", value: 9, fine: 5, legal: false, award: { hasValue: true, value: { productType: ProductType.PIGS, points: 3 } } };
export type ProductInfoShortcake = { type: ProductType.SHORTCAKE, name: "Strawberry Shortcake", category: "rare", icon: "🍰", value: 8, fine: 4, legal: false, award: { hasValue: true, value: { productType: ProductType.STRAWBERRIES, points: 2 } } };
export const productInfoShortcake: ProductInfoShortcake = { type: ProductType.SHORTCAKE, name: "Strawberry Shortcake", category: "rare", icon: "🍰", value: 8, fine: 4, legal: false, award: { hasValue: true, value: { productType: ProductType.STRAWBERRIES, points: 2 } } };

export type ProductInfoCoffee = { type: ProductType.COFFEE, name: "Coffee", category: "illegal", icon: "☕", value: 6, fine: 4, legal: false, award: nullopt_t };
export const productInfoCoffee: ProductInfoCoffee = { type: ProductType.COFFEE, name: "Coffee", category: "illegal", icon: "☕", value: 6, fine: 4, legal: false, award: nullopt };
export type ProductInfoHerbs = { type: ProductType.HERBS, name: "Herbs", category: "illegal", icon: "🌿", value: 7, fine: 4, legal: false, award: nullopt_t };
export const productInfoHerbs: ProductInfoHerbs = { type: ProductType.HERBS, name: "Herbs", category: "illegal", icon: "🌿", value: 7, fine: 4, legal: false, award: nullopt };
export type ProductInfoGems = { type: ProductType.GEMS, name: "Gems", category: "illegal", icon: "💎", value: 8, fine: 4, legal: false, award: nullopt_t };
export const productInfoGems: ProductInfoGems = { type: ProductType.GEMS, name: "Gems", category: "illegal", icon: "💎", value: 8, fine: 4, legal: false, award: nullopt };
export type ProductInfoSwords = { type: ProductType.SWORDS, name: "Swords", category: "illegal", icon: "⚔️", value: 9, fine: 4, legal: false, award: nullopt_t };
export const productInfoSwords: ProductInfoSwords = { type: ProductType.SWORDS, name: "Swords", category: "illegal", icon: "⚔️", value: 9, fine: 4, legal: false, award: nullopt };

export type ProductInfo =
  | ProductInfoMilk
  | ProductInfoGrapes
  | ProductInfoPigs
  | ProductInfoStrawberries
  | ProductInfoCheese
  | ProductInfoIceCream
  | ProductInfoJuice
  | ProductInfoWine
  | ProductInfoSausage
  | ProductInfoBacon
  | ProductInfoShortcake
  | ProductInfoCoffee
  | ProductInfoHerbs
  | ProductInfoGems
  | ProductInfoSwords;

// ensures all ProductInfo types conform to ProductInfoSpec
export const productInfos = ProductArray.newArray([
  (productInfoMilk satisfies (ProductInfoSpec & ProductInfo)) as (ProductInfoSpec & ProductInfo),
  productInfoGrapes,
  productInfoPigs,
  productInfoStrawberries,
  productInfoCheese,
  productInfoIceCream,
  productInfoJuice,
  productInfoWine,
  productInfoSausage,
  productInfoBacon,
  productInfoShortcake,
  productInfoCoffee,
  productInfoHerbs,
  productInfoGems,
  productInfoSwords,
])

export function getProductInfo(type: ProductType) {
  return productInfos.get(type);
}


export type PlayerCount = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
export const readyPoolSize = 6;
export const numRoundsPerPlayer = (numPlayers: PlayerCount) => numPlayers == 3 ? 3 : numPlayers == 4 ? 2 : numPlayers == 5 ? 2 : 1;

export type ValidatedPlayerIndex = {
  validIPlayer: true,
  value: number,
};
const createValidatedPlayerIndex = (i: number): ValidatedPlayerIndex => ({ validIPlayer: true, value: i });
export type ValidPlayerIndex = 0 | 1 | 2 | ValidatedPlayerIndex;
export const iPlayerToNum = (i: ValidPlayerIndex) => typeof i === 'number' ? i : i.value;
export class PlayerArray<T> {
  arr: T[] // TODO make private
  length: PlayerCount

  private constructor(arr: T[]) {
    this.arr = arr;
    if (!(arr.length == 3 || arr.length == 4 || arr.length == 5 || arr.length == 6 || arr.length == 7 || arr.length == 8 || arr.length == 9 || arr.length == 10)) {
      throw `PlayerArray constructed with an invalid length: ${arr}`;
    }
    this.length = arr.length;
  }
  static constructFirstPlayerArray<U>(arr: U[]) {
    if (!(arr.length == 3 || arr.length == 4 || arr.length == 5 || arr.length == 6 || arr.length == 7 || arr.length == 8 || arr.length == 9 || arr.length == 10)) {
      return nullopt;
    }
    return opt(new PlayerArray(arr));
  }
  tryNewPlayerArray<U>(arr: U[]): Optional<PlayerArray<U>> {
    if (arr.length == this.length) return opt(new PlayerArray(arr));
    else return nullopt;
  }

  get(index: ValidPlayerIndex) {
    const indexVal = typeof index === 'number' ? index : index.value;
    const obj = this.arr[indexVal];
    if (obj === undefined) {
      throw `PlayerArray index error. index: ${indexVal}, arr: ${JSON.stringify(this.arr)}`;
    }
    return obj;
  }
  set(index: ValidPlayerIndex, obj: T) {
    const indexVal = typeof index === 'number' ? index : index.value;
    this.arr[indexVal] = obj;
  }

  incrementIndexModLength(index: ValidPlayerIndex, increment: number) {
    const indexValue = typeof index === 'number' ? index : index.value;
    const positiveIncrement = (() => {
      let inc = increment;
      while (inc < 0) {
        inc += this.length;
      }
      return inc;
    })();
    return createValidatedPlayerIndex((indexValue + positiveIncrement) % this.length);
  }
  getRandomIndex() {
    return createValidatedPlayerIndex(getRandomInt(this.length));
  }
  validateIndex(index: number): Optional<ValidatedPlayerIndex> {
    if (index >= 0 && index < this.length) return opt(createValidatedPlayerIndex(index));
    else return nullopt;
  }

  everyTransform<U>(predicate: (element: T, index: ValidatedPlayerIndex) => Optional<U>) {
    const transform = this.arr.everyTransform((x, i) => predicate(x, createValidatedPlayerIndex(i)));
    if (transform.hasValue == false) return nullopt;
    else return opt(new PlayerArray(transform.value));
  }
  map<U>(transformer: (obj: T, index: ValidatedPlayerIndex) => U) {
    return new PlayerArray(this.arr.map((x, i) => transformer(x, createValidatedPlayerIndex(i))));
  }
  shallowCopy() {
    return new PlayerArray(this.arr.shallowCopy());
  }
  zip<U>(other: PlayerArray<U>) {
    return new PlayerArray(this.arr.filterTransform((x, i) => {
      const y = other.arr[i];
      if (y === undefined) return nullopt;
      return opt([x, y] as [T, U]);
    }));
  }
};


export type CommunityContractPools = {
  generalPoolContractCounts: ProductArray<number>,
  recyclePoolsContracts: ProductType[][],
}

export type TraderSupplies = {
  readyPool: ProductType[],
  money: number,
  shopProductCounts: ProductArray<number>,
}
export type SerializableTraderSupplies = {
  readyPool: ProductType[],
  money: number,
  shopProductCounts: number[],
}

export type PackedCart = {
  count: number,
  products: ProductType[]
}
export type ClaimedCart = (
  & PackedCart
  & {
    claimedType: ProductType,
    claimMessage: Optional<string>
  }
);
export type CartState =
  | { packed: false }
  | { packed: true, cart: ClaimedCart }

export type IgnoreDeal = {
  officerGives: {
    money: number,
  },
  traderGives: {
    money: number,
  }
  message: Optional<string>
}

export type PersistentGameState = {
  communityPools: CommunityContractPools,
  traderSupplies: PlayerArray<TraderSupplies>,
}
export type SerializablePersistentGameState = {
  communityPools: CommunityContractPools,
  traderSupplies: SerializableTraderSupplies[],
}

export type ServerRoundGameState =
  & PersistentGameState
  & { round: number, iPlayerOfficer: ValidatedPlayerIndex }
export type SerializableServerRoundGameState =
  & SerializablePersistentGameState
  & { round: number, iPlayerOfficer: number }

export type ServerGameState =
  | ({ state: "Swap", iPlayerActiveTrader: ValidatedPlayerIndex } & ServerRoundGameState)
  | ({ state: "Pack", cartStates: PlayerArray<CartState> } & ServerRoundGameState)
  | ({ state: "CustomsIntro", cartStates: PlayerArray<CartState>, iPlayerActiveTrader: ValidatedPlayerIndex } & ServerRoundGameState)
  | (
    & { state: "Customs", cartStates: PlayerArray<CartState> }
    & ServerRoundGameState
    & (
      | { customsState: "ready" }
      | { customsState: "interrogating", iPlayerActiveTrader: ValidatedPlayerIndex, proposedDeal: Optional<IgnoreDeal & { waitingOnOfficer: boolean }> }
      | (
        & { customsState: "resolving", iPlayerActiveTrader: ValidatedPlayerIndex }
        & (
          | { result: "searched", iProductCheekyDelay: Optional<number> }
          | { result: "ignored" }
          | { result: "ignored for deal", deal: IgnoreDeal }
        )
      )
    )
  )
  | ({ state: "Refresh" } & ServerRoundGameState)
  | ({ state: "GameEnd", finalTraderSupplies: PlayerArray<TraderSupplies> })
export type SerializableServerGameState =
  | ({ state: "Swap", iPlayerActiveTrader: number } & SerializableServerRoundGameState)
  | ({ state: "Pack", cartStates: CartState[] } & SerializableServerRoundGameState)
  | ({ state: "CustomsIntro", cartStates: CartState[], iPlayerActiveTrader: number } & SerializableServerRoundGameState)
  | (
    & { state: "Customs", cartStates: CartState[] }
    & SerializableServerRoundGameState
    & (
      | { customsState: "ready" }
      | { customsState: "interrogating", iPlayerActiveTrader: number, proposedDeal: Optional<IgnoreDeal & { waitingOnOfficer: boolean }> }
      | (
        & { customsState: "resolving", iPlayerActiveTrader: number }
        & (
          | { result: "searched", iProductCheekyDelay: Optional<number> }
          | { result: "ignored" }
          | { result: "ignored for deal", deal: IgnoreDeal }
        )
      )
    )
  )
  | ({ state: "Refresh" } & SerializableServerRoundGameState)
  | ({ state: "GameEnd", finalTraderSupplies: SerializableTraderSupplies[] })

export type OfficerClientRoundGameState =
  & PersistentGameState
  & { round: number, localOfficer: true };
export type TraderClientRoundGameState =
  & PersistentGameState
  & { round: number, localOfficer: false, iPlayerOfficer: ValidatedPlayerIndex }
export type ClientRoundGameState =
  | OfficerClientRoundGameState
  | TraderClientRoundGameState
export type ClientGameState = (
  | { state: "Setup", }
  | (
    & { state: "Swap" }
    & (
      | ({ localActiveTrader: false, iPlayerActiveTrader: ValidatedPlayerIndex } & ClientRoundGameState)
      | ({ localActiveTrader: true } & TraderClientRoundGameState)
    )
  )
  | (
    & { state: "Pack", otherCartStates: PlayerArray<CartState> }
    & (
      | OfficerClientRoundGameState
      | (
        & TraderClientRoundGameState
        & (
          | { localState: "packing", selectedReadyPoolProductsForPacking: boolean[], claimedProductType: Optional<ProductType>, claimMessage: string }
          | { localState: "done", localCart: ClaimedCart }
        )
      )
    )
  )
  | (
    & { state: "CustomsIntro", cartStates: PlayerArray<CartState>, introState: ("animating" | "ready") }
    & (
      | ({ localActiveTrader: false, iPlayerActiveTrader: ValidatedPlayerIndex } & ClientRoundGameState)
      | ({ localActiveTrader: true } & TraderClientRoundGameState)
    )
  )
  | (
    & { state: "Customs", cartStates: PlayerArray<CartState> }
    & (
      | ({ customsState: "ready", readyState: ({ state: "transitioning", iPlayerExitingCart: ValidatedPlayerIndex } | { state: "ready" }) } & ClientRoundGameState)
      | (
        & { customsState: "interrogating", interrogatingState: ("cart entering" | "ready"), proposedDeal: Optional<IgnoreDeal & { waitingOnOfficer: boolean }> }
        & (
          | (TraderClientRoundGameState & { localActiveTrader: false, iPlayerActiveTrader: ValidatedPlayerIndex })
          | (
            & (
              | (TraderClientRoundGameState & { localActiveTrader: true })
              | (OfficerClientRoundGameState & { localActiveTrader: false, iPlayerActiveTrader: ValidatedPlayerIndex })
            )
            & { localWipDeal: Optional<IgnoreDeal> }
          )
        )
      )
      | (
        & { customsState: "resolving", wipTraderSupplies: PlayerArray<TraderSupplies> }
        & (
          | ({ localActiveTrader: true } & TraderClientRoundGameState)
          | ({ localActiveTrader: false, iPlayerActiveTrader: ValidatedPlayerIndex } & ClientRoundGameState)
        )
        & {
          result:
          | { result: "searched", iProductCheekyDelay: Optional<number> }
          | { result: "ignored" }
          | { result: "ignored for deal", deal: IgnoreDeal }
        }
      )
    )
  )
  | { state: "Refresh" } & ClientRoundGameState
  | { state: "GameEnd", finalTraderSupplies: PlayerArray<TraderSupplies> }
);
