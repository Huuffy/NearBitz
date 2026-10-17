// Mirrors the `industries` table (ids are stable). Icons are MaterialCommunityIcons glyph names.
export interface Industry {
  id: number;
  name: string;
  short: string;
  slug: string;
  icon: string;
  tint: string;
}

export const INDUSTRIES: Industry[] = [
  { id: 31, name: 'Steel & Metals', short: 'Steel', slug: 'steel-metals', icon: 'anvil', tint: '#4A6378' },
  { id: 40, name: 'Machinery & Equipment', short: 'Machinery', slug: 'machinery', icon: 'cog', tint: '#5E5A8C' },
  { id: 32, name: 'Construction', short: 'Construction', slug: 'construction', icon: 'crane', tint: '#B5702A' },
  { id: 35, name: 'Textiles & Apparel', short: 'Textiles', slug: 'textiles', icon: 'tshirt-crew', tint: '#A04A73' },
  { id: 41, name: 'Food & Beverages', short: 'Food', slug: 'food-beverage', icon: 'food-variant', tint: '#3F8A4E' },
  { id: 38, name: 'Agriculture & Agro', short: 'Agro', slug: 'agriculture', icon: 'sprout', tint: '#6B8A2E' },
  { id: 45, name: 'Logistics & Transport', short: 'Logistics', slug: 'logistics', icon: 'truck-fast', tint: '#2E7A8A' },
  { id: 34, name: 'Electrical & Electronics', short: 'Electrical', slug: 'electrical', icon: 'flash', tint: '#C08A12' },
  { id: 43, name: 'Paper & Pulp', short: 'Paper', slug: 'paper', icon: 'file-document-multiple', tint: '#7A6A55' },
  { id: 33, name: 'Chemicals & Polymers', short: 'Chemicals', slug: 'chemicals', icon: 'flask', tint: '#7A4FA0' },
  { id: 42, name: 'Rubber & Plastics', short: 'Plastics', slug: 'rubber-plastics', icon: 'cube-outline', tint: '#4F7AA0' },
  { id: 37, name: 'Pharmaceuticals', short: 'Pharma', slug: 'pharma', icon: 'pill', tint: '#C0504D' },
  { id: 39, name: 'Packaging & Printing', short: 'Packaging', slug: 'packaging', icon: 'package-variant', tint: '#8A6A2E' },
  { id: 36, name: 'Automotive', short: 'Auto', slug: 'automotive', icon: 'car-cog', tint: '#3A5068' },
  { id: 44, name: 'IT & Technology', short: 'IT', slug: 'it-tech', icon: 'chip', tint: '#2E5E8A' },
];

export const INDUSTRY_BY_ID = new Map(INDUSTRIES.map((i) => [i.id, i]));
export const INDUSTRY_BY_NAME = new Map(INDUSTRIES.map((i) => [i.name, i]));
