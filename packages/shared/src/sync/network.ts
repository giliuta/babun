// STORY-062 slice 2 — shared network-availability detector.
//
// Port of apps/web/src/lib/sync/network.ts, de-coupled from
// `navigator.onLine` so it works on React Native. Instead of reading the
// browser API directly, it delegates to the injected NetworkAdapter
// (getNetwork()): web keeps the navigator default, RN swaps in NetInfo
// via setNetwork() in bootstrap.ts.
//
// The React hook (useIsOnline) stays here — it works on both web and RN
// (react-native re-exports the same useState/useEffect). The web app
// keeps its OWN copy of this module for now (apps/web/src/lib/sync); this
// shared version is what the mobile app + the future shared sync layer
// import. Behaviour is identical because the default NetworkAdapter
// (NavigatorOnlineNetwork) reproduces the old logic byte-for-byte.

import { useEffect, useState } from "react";
import { getNetwork } from "../storage/sql/provider";

export function isOnline(): boolean {
  return getNetwork().isOnline();
}

export function subscribeNetwork(cb: (online: boolean) => void): () => void {
  return getNetwork().subscribe(cb);
}

export function useIsOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => isOnline());
  useEffect(() => subscribeNetwork(setOnline), []);
  return online;
}
