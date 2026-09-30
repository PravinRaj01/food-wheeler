"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Candidate, Location } from "@/lib/decide/types";

const PIN_ICON = L.divIcon({
  html: '<svg width="26" height="26" viewBox="0 0 24 24" style="stroke:#c9a15a;fill:#c9a15a;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))"><path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.3" fill="#0b0b0d" stroke="none"/></svg>',
  className: "",
  iconSize: [26, 26],
  iconAnchor: [13, 24],
});

export function RevealMap({
  winner,
  userLocation,
  caption,
}: {
  winner: Candidate;
  userLocation: Location | null;
  caption: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { attributionControl: true, zoomControl: true });
    mapRef.current = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      // The marker/user-marker instances belong to the map being torn down
      // here (Strict Mode mounts effects twice in dev, destroying and
      // recreating the map) - without resetting these too, the next mount's
      // marker effect sees a stale ref and calls setLatLng on a marker
      // attached to a dead map instead of adding a fresh one to the new map.
      markerRef.current = null;
      userMarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (markerRef.current) markerRef.current.setLatLng([winner.lat, winner.lng]);
    else markerRef.current = L.marker([winner.lat, winner.lng], { icon: PIN_ICON }).addTo(map);
    markerRef.current.bindPopup(`<b>${winner.name}</b><br>${caption}`);

    const bounds: [number, number][] = [[winner.lat, winner.lng]];
    if (userLocation) {
      if (userMarkerRef.current) userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng]);
      else
        userMarkerRef.current = L.circleMarker([userLocation.lat, userLocation.lng], {
          radius: 6,
          color: "#6f8f8a",
          fillColor: "#6f8f8a",
          fillOpacity: 0.9,
          weight: 2,
        }).addTo(map);
      bounds.push([userLocation.lat, userLocation.lng]);
    }

    if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40] });
    else map.setView(bounds[0], 15);
    setTimeout(() => map.invalidateSize(), 100);
  }, [winner, userLocation, caption]);

  return (
    <div
      ref={containerRef}
      // isolate - see the identical comment in explore-map.tsx.
      className="isolate h-56 w-full overflow-hidden rounded-xl md:h-64 [&_.leaflet-tile-pane]:[filter:var(--map-tile-filter)]"
    />
  );
}
