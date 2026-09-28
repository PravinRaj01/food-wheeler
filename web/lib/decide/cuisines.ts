// Shared between Decide's "Craving" chips and Explore's cuisine filter, so
// both offer the same, actually-local cuisines - not the old US-centric
// list (Mexican/Italian/American/Vegan) that had no Malay, Indian or
// Chinese option at all. `needles` are lowercase substrings checked
// against a place's OSM `cuisine` field (see candidates.list_places) -
// several needles per label because OSM's own cuisine tagging is
// inconsistent (a Japanese place might be tagged "sushi" or "ramen"
// instead of "japanese").
export interface CuisineFilter {
  label: string;
  needles: string[];
}

export const CUISINES: CuisineFilter[] = [
  { label: "Malay", needles: ["malay"] },
  { label: "Chinese", needles: ["chinese"] },
  { label: "Indian", needles: ["indian"] },
  { label: "Japanese", needles: ["japanese", "sushi", "ramen"] },
  { label: "Korean", needles: ["korean"] },
  { label: "Thai", needles: ["thai"] },
  { label: "Western", needles: ["western", "american", "burger", "steak", "italian", "pizza", "european"] },
];

export interface DietFilter {
  id: string;
  label: string;
}

export const DIETS: DietFilter[] = [
  { id: "halal", label: "Halal" },
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
];
