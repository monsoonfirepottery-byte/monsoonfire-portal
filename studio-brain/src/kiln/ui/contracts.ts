import type { KilnOverview } from "../domain/model";
import type { KilnDetailView } from "../services/overview";

export type KilnCommandPageModel = {
  generatedAt: string;
  overview: KilnOverview;
  kilnDetails: KilnDetailView[];
  uploadMaxBytes: number;
};

export type KilnCommandKilnDetailModel = KilnDetailView;
