/** Link that opens turn-by-turn directions in the phone's maps app (or Google Maps on desktop). */
export const mapsUrl = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
