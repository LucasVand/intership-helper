export type InternshipSource = "simplify" | "canadian-tech" | "multiple";

export type ScrapedInternship = {
  source: InternshipSource;
  company: string;
  role: string;
  location: string;
  applicationLink: string;
  postedAt?: Date;
  noSponsorship?: boolean;
  requiresCitizenship?: boolean;
  isClosed?: boolean;
  isFaang?: boolean;
  requiresAdvancedDegree?: boolean;
};

export type InternshipSourceAdapter = {
  source: InternshipSource;
  url: string;
  fetchAndParse(): Promise<ScrapedInternship[]>;
};
