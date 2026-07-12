import type { StationProviderPort } from "./StationProviderPort";
import { FixtureStationAdapter } from "./FixtureStationAdapter";
import { generateBoardingPosition, generateStationFacilities } from "./ai-generation";
import { decodeHeartRailsStationId, fetchNearestStationsFromHeartRails } from "./heartrails";
import { readCollection, writeCollection } from "@/lib/store/json-file-store";
import { FIXTURE_PLATFORMS } from "@/lib/fixtures/stations";
import type { BoardingPosition, Platform, Station, StationFacility } from "@/lib/domain/station";

const FACILITIES_CACHE = "ai-station-facilities";
const BOARDING_CACHE = "ai-boarding-positions";
const NEARBY_STATION_CACHE = "nearby-stations";

interface FacilitiesCacheEntry {
  stationId: string;
  facilities: StationFacility[];
}

interface BoardingCacheEntry {
  platformId: string;
  boardingPositions: BoardingPosition[];
}

interface NearbyStationCacheEntry {
  station: Station;
}

/**
 * FixtureStationAdapter を優先しつつ、fixture に無い駅の改札・出口・号車情報は
 * Gemini で下書き生成して confidence: low として補う複合アダプター。
 * 生成結果はローカルJSONにキャッシュし、同じ駅への再生成を避ける。
 *
 * キャッシュ書き込みが失敗しても(例: 読み取り専用ファイルシステムの本番環境)、
 * 生成結果自体は返す。キャッシュは最適化であり必須要件ではないため。
 * 生成に失敗した(空/null)結果はキャッシュしない — 一時的なAPI障害を
 * 恒久的な「情報なし」として固定してしまうのを防ぐため。
 */
export class CompositeStationAdapter implements StationProviderPort {
  private readonly fixture = new FixtureStationAdapter();

  constructor(private readonly geminiApiKey: string) {}

  searchStations(query: string) {
    return this.fixture.searchStations(query);
  }

  async getStation(stationId: string): Promise<Station | null> {
    const fixtureStation = await this.fixture.getStation(stationId);
    if (fixtureStation) return fixtureStation;

    const cache = readCollection<NearbyStationCacheEntry>(NEARBY_STATION_CACHE);
    const cached = cache.find((c) => c.station.stationId === stationId)?.station;
    if (cached) return cached;

    // キャッシュ書き込みが失敗していても(読み取り専用ファイルシステム等)、
    // HeartRails由来のstationIdには駅名・座標が自己完結的に埋め込まれているため
    // ここで復元できる(路線名等は失われるが、駅の存在自体は解決できる)。
    return decodeHeartRailsStationId(stationId);
  }

  getPlatforms(stationId: string) {
    // Step B(駅マスタの全国対応)までは Platform 自体も fixture 収録分のみのため、
    // HeartRails由来の駅は号車情報「確認できません」として扱われる(route-search.ts側)。
    return this.fixture.getPlatforms(stationId);
  }

  async nearestStations(
    latitude: number,
    longitude: number,
    limit: number
  ): Promise<Station[]> {
    const fromApi = await fetchNearestStationsFromHeartRails(latitude, longitude);
    if (!fromApi || fromApi.length === 0) {
      return this.fixture.nearestStations(latitude, longitude, limit);
    }

    const limited = fromApi.slice(0, limit);

    try {
      const cache = readCollection<NearbyStationCacheEntry>(NEARBY_STATION_CACHE);
      const existingIds = new Set(cache.map((c) => c.station.stationId));
      const toAdd = limited
        .filter((s) => !existingIds.has(s.stationId))
        .map((station) => ({ station }));
      if (toAdd.length > 0) {
        writeCollection(NEARBY_STATION_CACHE, [...cache, ...toAdd]);
      }
    } catch {
      // キャッシュ保存は最適化にすぎないため、失敗しても検索結果自体は返す。
    }

    return limited;
  }

  async getFacilities(stationId: string): Promise<StationFacility[]> {
    const fixtureFacilities = await this.fixture.getFacilities(stationId);
    if (fixtureFacilities.length > 0) return fixtureFacilities;

    const cache = readCollection<FacilitiesCacheEntry>(FACILITIES_CACHE);
    const cached = cache.find((c) => c.stationId === stationId);
    if (cached) return cached.facilities;

    const station = await this.getStation(stationId);
    if (!station) return [];

    const generated = await generateStationFacilities(
      this.geminiApiKey,
      station.stationName,
      station.operator,
      station.lines
    );
    if (generated.length === 0) return [];

    const withStationId = generated.map((f) => ({ ...f, stationId }));

    try {
      writeCollection(FACILITIES_CACHE, [
        ...cache,
        { stationId, facilities: withStationId },
      ]);
    } catch {
      // キャッシュ保存は最適化にすぎないため、失敗しても生成結果は返す。
    }

    return withStationId;
  }

  async getBoardingPositions(platformId: string): Promise<BoardingPosition[]> {
    const fixturePositions = await this.fixture.getBoardingPositions(platformId);
    if (fixturePositions.length > 0) return fixturePositions;

    const cache = readCollection<BoardingCacheEntry>(BOARDING_CACHE);
    const cached = cache.find((c) => c.platformId === platformId);
    if (cached) return cached.boardingPositions;

    const platform = this.findPlatform(platformId);
    if (!platform) return [];

    const station = await this.fixture.getStation(platform.stationId);
    if (!station) return [];

    const generated = await generateBoardingPosition(
      this.geminiApiKey,
      station.stationName,
      platform.lineId,
      platform.direction,
      platformId
    );
    if (!generated) return [];

    const positions = [generated];

    try {
      writeCollection(BOARDING_CACHE, [
        ...cache,
        { platformId, boardingPositions: positions },
      ]);
    } catch {
      // キャッシュ保存は最適化にすぎないため、失敗しても生成結果は返す。
    }

    return positions;
  }

  private findPlatform(platformId: string): Platform | null {
    // Step B(駅マスタの全国対応)までは Platform 自体も fixture 収録分のみのため、
    // fixture データを直接参照する。全国対応時は駅マスタ由来の索引に置き換える。
    return FIXTURE_PLATFORMS.find((p) => p.platformId === platformId) ?? null;
  }
}
