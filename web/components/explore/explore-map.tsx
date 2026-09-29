"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Location, Place } from "@/lib/decide/types";
import { formatDistance } from "@/lib/decide/distance";

function pinIcon(highlighted: boolean) {
  const color = highlighted ? "#fb923c" : "#c9a15a";
  return L.divIcon({
    html: `<svg width="24" height="24" viewBox="0 0 24 24" style="stroke:${color};fill:${color};filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))"><path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.3" fill="#0b0b0d" stroke="none"/></svg>`,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 22],
  });
}

export function ExploreMap({
  places,
  userLocation,
  selectedId,
  onSelect,
}: {
  places: Place[];
  userLocation: Location | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { attributionControl: true, zoomControl: true });
    mapRef.current = map;
    const markers = markersRef.current; // snapshot for the cleanup closure below
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    map.setView(userLocation ? [userLocation.lat, userLocation.lng] : [40.7306, -73.9866], 14);

    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
      userMarkerRef.current = null;
    };
    // Only the initial center matters here; place markers are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();
    for (const p of places) {
      seen.add(p.id);
      const existing = markersRef.current.get(p.id);
      if (existing) {
        existing.setIcon(pinIcon(p.id === selectedId));
      } else {
        const marker = L.marker([p.lat, p.lng], { icon: pinIcon(p.id === selectedId) })
          .addTo(map)
          .bindPopup(`<b>${p.name}</b><br>${p.cuisine} · ${formatDistance(p)}`)
          .on("click", () => onSelectRef.current(p.id));
        markersRef.current.set(p.id, marker);
      }
    }
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

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
    }

    if (places.length) {
      const bounds = L.latLngBounds(places.map((p) => [p.lat, p.lng] as [number, number]));
      if (userLocation) bounds.extend([userLocation.lat, userLocation.lng]);
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
    }
    setTimeout(() => map.invalidateSize(), 100);
  }, [places, userLocation, selectedId]);

  // Pan to the selected marker without re-fitting all bounds.
  useEffect(() => {
    if (!selectedId) return;
    const map = mapRef.current;
    const marker = markersRef.current.get(selectedId);
    if (map && marker) map.panTo(marker.getLatLng());
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full [&_.leaflet-tile-pane]:[filter:var(--map-tile-filter)]"
    />
  );
}
