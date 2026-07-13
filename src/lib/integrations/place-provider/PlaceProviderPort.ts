import type { Coordinates, Destination } from "@/lib/domain/station";

export interface PlaceProviderPort {
  /**
   * near を渡すと、その座標付近を優先して検索する(位置バイアス)。
   * 出発地の座標が判明している場合に、同名施設の別店舗など遠方の誤検索を防ぐ。
   */
  searchPlaces(query: string, near?: Coordinates | null): Promise<Destination[]>;
  getPlace(placeId: string): Promise<Destination | null>;
}
