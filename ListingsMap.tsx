'use client';
import { useEffect, useRef } from 'react';
import type { ListingCard } from '@/lib/types';
import { money } from '@/lib/format';
import 'mapbox-gl/dist/mapbox-gl.css';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

/** Price pins on Mapbox. Without a token, shows a placeholder so local dev still works. */
export function ListingsMap({ listings, highlightId }: { listings: ListingCard[]; highlightId?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<import('mapbox-gl').Map | null>(null);
  const markers = useRef<Map<string, import('mapbox-gl').Marker>>(new Map());

  useEffect(() => {
    if (!TOKEN || !el.current || map.current) return;
    let cancelled = false;
    import('mapbox-gl').then(({ default: mapboxgl }) => {
      if (cancelled || !el.current) return;
      mapboxgl.accessToken = TOKEN;
      map.current = new mapboxgl.Map({ container: el.current, style: 'mapbox://styles/mapbox/light-v11', center: [0, 0], zoom: 1 });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    import('mapbox-gl').then(({ default: mapboxgl }) => {
      markers.current.forEach((mk) => mk.remove());
      markers.current.clear();
      const bounds = new mapboxgl.LngLatBounds();
      for (const l of listings) {
        const pin = document.createElement('a');
        pin.href = `/listings/${l.id}`;
        pin.className = 'rounded-full bg-white px-2 py-0.5 text-xs font-semibold shadow ring-1 ring-black/10';
        pin.textContent = money(l.price, l.currency);
        markers.current.set(l.id, new mapboxgl.Marker({ element: pin }).setLngLat([l.lng, l.lat]).addTo(m));
        bounds.extend([l.lng, l.lat]);
      }
      if (listings.length) m.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    });
  }, [listings]);

  useEffect(() => {
    markers.current.forEach((mk, id) => {
      const e = mk.getElement();
      e.style.background = id === highlightId ? '#1f7a5c' : 'white';
      e.style.color = id === highlightId ? 'white' : '';
      e.style.zIndex = id === highlightId ? '10' : '';
    });
  }, [highlightId]);

  if (!TOKEN) {
    return <div className="flex h-full items-center justify-center bg-brand-50 text-sm text-brand-700">Set NEXT_PUBLIC_MAPBOX_TOKEN to show the map</div>;
  }
  return <div ref={el} className="h-full w-full" />;
}
