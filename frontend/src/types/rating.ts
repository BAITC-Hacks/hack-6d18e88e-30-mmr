export interface RatingRecommendation {
  field: string;
  message: string;
  possibleGain: number;
}

export interface RatingBreakdown {
  contextNeed: number;
  data: number;
  expectedResult: number;
  successCriteria: number;
  constraints: number;
  users: number;
  businessCommunication: number;
  total: number;
  potentialTotal: number;
  recommendations: RatingRecommendation[];
}
