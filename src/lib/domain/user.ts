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
