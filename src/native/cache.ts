import { invoke } from "@tauri-apps/api/core";

export interface CacheStatus {
  path: string;
  layoutVersion: string;
  writable: boolean;
  availableBytes: number | null;
  custom: boolean;
  note: string;
}

export function getCacheStatus(): Promise<CacheStatus> {
  return invoke<CacheStatus>("get_cache_status");
}

export function selectCacheLocation(): Promise<CacheStatus | null> {
  return invoke<CacheStatus | null>("select_cache_location");
}
