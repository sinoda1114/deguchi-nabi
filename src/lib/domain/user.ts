import type { Destination, Station } from "./station";

export type SubscriptionPlan = "free" | "premium";

export interface User {
  userId: string;
  email: string;
  displayName: string;
  homeStationId: string | null;
  plan: SubscriptionPlan;
  locale: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedRouteQuery {
  originStationId: string;
  destinationStationId: string;
  mode: string;
}

export interface FavoriteRoute {
  favoriteId: string;
  userId: string;
  routeGuideId: string;
  label: string;
  query: SavedRouteQuery;
  createdAt: string;
}

export interface SearchHistoryEntry {
  historyId: string;
  userId: string;
  routeGuideId: string;
  originLabel: string;
  destinationLabel: string;
  mode: string;
  query: SavedRouteQuery;
  createdAt: string;
}

/**
 * 検索前に単体で登録・呼び出しできる「よく使う目的地」。
 * 検索結果の経路そのものを保存する FavoriteRoute とは異なり、駅または施設単体を保持する。
 */
export type FavoriteDestination =
  | {
      favoriteDestinationId: string;
      userId: string;
      kind: "station";
      station: Station;
      label: string;
      createdAt: string;
    }
  | {
      favoriteDestinationId: string;
      userId: string;
      kind: "place";
      destination: Destination;
      label: string;
      createdAt: string;
    };
