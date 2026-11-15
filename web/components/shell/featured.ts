// Featured regions used on the landing page and in the Explore picker.
// Every id was verified against the catalogue (see docs/build-spec.md, section 3).

export interface FeaturedRegion {
  id: string;
  /** short display name (the catalogue name can be longer) */
  name: string;
  /** what kind of place it is, in a few plain words */
  kind: string;
  /** has GLDAS land-model data */
  hasData: boolean;
}

export const FEATURED: FeaturedRegion[] = [
  { id: "named-sahel", name: "Sahel", kind: "Semi-arid belt south of the Sahara", hasData: true },
  { id: "named-california-central-valley", name: "California Central Valley", kind: "Dry-summer farming valley", hasData: true },
  { id: "named-high-mountain-asia", name: "High Mountain Asia", kind: "Snow and high plateaus", hasData: true },
  { id: "named-indo-gangetic-plain", name: "Indo-Gangetic Plain", kind: "Monsoon farmland", hasData: true },
  { id: "named-amazon-deforestation-arc", name: "Amazon deforestation arc", kind: "Wet tropics at the forest edge", hasData: true },
  { id: "named-arabian-aquifers-saudi", name: "Arabian aquifers (Saudi)", kind: "Desert with no perennial river", hasData: true },
  { id: "named-aral-sea", name: "Aral Sea", kind: "Dry steppe around a shrunken lake", hasData: true },
  { id: "named-taiwan-main-island", name: "Taiwan main island", kind: "Small island, only a few grid cells", hasData: true },
  { id: "b3-3030009130", name: "Lena basin", kind: "Cold river basin with long snow seasons", hasData: true },
  { id: "b3-1030034260", name: "Nile basin", kind: "Long river basin from tropics to desert", hasData: true },
  { id: "b3-7030047060", name: "Missouri basin", kind: "Temperate plains basin", hasData: true },
  { id: "named-greenland", name: "Greenland", kind: "Ice sheet and coast, part sea", hasData: true },
  { id: "ice-EAN", name: "East Antarctic Ice Sheet", kind: "No land-model data here", hasData: false },
];

/** a shorter set for places where space is tight */
export const FEATURED_SHORT = FEATURED.filter((f) =>
  [
    "named-sahel",
    "named-california-central-valley",
    "named-high-mountain-asia",
    "named-indo-gangetic-plain",
    "named-amazon-deforestation-arc",
    "named-arabian-aquifers-saudi",
    "b3-3030009130",
    "named-taiwan-main-island",
  ].includes(f.id),
);
