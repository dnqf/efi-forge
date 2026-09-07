import type { WorkflowArtifactSource } from "./artifactLifecycle";

export function artifactAfterMergePreferenceChange(
  active: WorkflowArtifactSource | null,
  customValid: boolean,
): WorkflowArtifactSource | null {
  if (active !== "merged") return active;
  return customValid ? "custom" : null;
}
