export type DifficultyTier = "beginner" | "intermediate" | "advanced";
export type AttemptStatus  = "passed" | "attempted" | "not_attempted";

export interface ConceptTag {
  slug:      string;
  label:     string;
  sortOrder: number;
}

export interface ProblemListItem {
  id:             string;
  title:          string;
  difficultyTier: DifficultyTier;
  conceptTags:    ConceptTag[];
  status:         AttemptStatus;
}

export interface TestCaseDisplay {
  id:             string;
  input:          string;
  expectedOutput: string;
  orderIndex:     number;
  description:    string | null;
}

export interface ProblemDetail {
  id:                 string;
  title:              string;
  description:        string;
  starterCode:        string | null;
  difficultyTier:     DifficultyTier;
  expectedComplexity: string | null;
  conceptTags:        ConceptTag[];
  testCases:          TestCaseDisplay[]; // non-edge cases only, for display
}
