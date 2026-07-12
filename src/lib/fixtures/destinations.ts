import type { Destination } from "@/lib/domain/station";

export const FIXTURE_DESTINATIONS: Destination[] = [
  {
    destinationId: "dest_shibuya_hikarie",
    name: "渋谷ヒカリエ",
    category: "facility",
    address: "東京都渋谷区渋谷2-21-1",
    latitude: 35.6595,
    longitude: 139.7036,
    nearestStationCandidates: ["st_shibuya"],
  },
  {
    destinationId: "dest_shinjuku_ncity",
    name: "新宿NSビル",
    category: "facility",
    address: "東京都新宿区西新宿2-4-1",
    latitude: 35.6906,
    longitude: 139.6917,
    nearestStationCandidates: ["st_shinjuku"],
  },
];
