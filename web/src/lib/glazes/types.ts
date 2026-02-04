export type GlazeFamily = "studio" | "raku";

export type PhotoRef = {
  storagePath: string;
  thumbPath?: string;
  caption?: string;
  cone?: string;
};

export type Glaze = {
  id: string;
  name: string;
  family: GlazeFamily;
  glazy?: {
    url?: string;
    slug?: string;
  };
  tags?: string[];
  notes?: string;
};

export type ComboKey = {
  id: number;
  baseGlazeId: string;
  topGlazeId: string;
};

export type ComboTile = {
  comboId: number;
  photos: PhotoRef[];
  notes?: string;
  coneNotes?: string;
  flags?: string[];
  updatedAt: string;
  updatedBy: string;
};
