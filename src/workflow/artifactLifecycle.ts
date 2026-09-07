export type WorkflowArtifactSource = "generated" | "custom" | "merged" | "component-merged";
export type WorkflowOperation =
  | "hardware-input"
  | "usb-map-import"
  | "acpi-analysis"
  | "build"
  | "custom-import"
  | "merge"
  | "component-merge"
  | "component-scan"
  | "verification-import"
  | "copy";

export interface WorkflowRevisionToken {
  id: number;
  operation: WorkflowOperation;
  inputRevision: number;
  planRevision: number;
  artifactRevision: number | null;
}

export interface BoundWorkflowArtifact {
  revision: number;
  inputRevision: number;
  planRevision: number;
  source: WorkflowArtifactSource;
}

export interface WorkflowArtifactLifecycle {
  inputRevision: number;
  planRevision: number;
  nextArtifactRevision: number;
  nextTokenId: number;
  artifact: BoundWorkflowArtifact | null;
  verificationArtifactRevision: number | null;
  copiedArtifactRevision: number | null;
  pending: Partial<Record<WorkflowOperation, WorkflowRevisionToken>>;
}

export function createWorkflowArtifactLifecycle(): WorkflowArtifactLifecycle {
  return {
    inputRevision: 0,
    planRevision: 0,
    nextArtifactRevision: 1,
    nextTokenId: 1,
    artifact: null,
    verificationArtifactRevision: null,
    copiedArtifactRevision: null,
    pending: {},
  };
}

function invalidateArtifact(state: WorkflowArtifactLifecycle): WorkflowArtifactLifecycle {
  return {
    ...state,
    artifact: null,
    verificationArtifactRevision: null,
    copiedArtifactRevision: null,
    pending: {},
  };
}

export function changeWorkflowInput(state: WorkflowArtifactLifecycle): WorkflowArtifactLifecycle {
  return invalidateArtifact({
    ...state,
    inputRevision: state.inputRevision + 1,
    planRevision: state.planRevision + 1,
  });
}

export function acceptWorkflowInputResult(
  state: WorkflowArtifactLifecycle,
  token: WorkflowRevisionToken,
): WorkflowArtifactLifecycle {
  if (token.operation !== "hardware-input" || !canAcceptWorkflowResult(state, token)) return state;
  return changeWorkflowInput(finishWorkflowOperation(state, token));
}

export function changeWorkflowPlan(state: WorkflowArtifactLifecycle): WorkflowArtifactLifecycle {
  return invalidateArtifact({ ...state, planRevision: state.planRevision + 1 });
}

export function beginWorkflowOperation(
  state: WorkflowArtifactLifecycle,
  operation: WorkflowOperation,
): { state: WorkflowArtifactLifecycle; token: WorkflowRevisionToken } {
  const token: WorkflowRevisionToken = {
    id: state.nextTokenId,
    operation,
    inputRevision: state.inputRevision,
    planRevision: state.planRevision,
    artifactRevision: state.artifact?.revision ?? null,
  };
  return {
    token,
    state: {
      ...state,
      nextTokenId: state.nextTokenId + 1,
      pending: { ...state.pending, [operation]: token },
    },
  };
}

export function canAcceptWorkflowResult(
  state: WorkflowArtifactLifecycle,
  token: WorkflowRevisionToken,
): boolean {
  const pending = state.pending[token.operation];
  return Boolean(
    pending?.id === token.id
      && token.inputRevision === state.inputRevision
      && token.planRevision === state.planRevision
      && token.artifactRevision === (state.artifact?.revision ?? null),
  );
}

export function finishWorkflowOperation(
  state: WorkflowArtifactLifecycle,
  token: WorkflowRevisionToken,
): WorkflowArtifactLifecycle {
  if (!canAcceptWorkflowResult(state, token)) return state;
  const pending = { ...state.pending };
  delete pending[token.operation];
  return { ...state, pending };
}

export function bindWorkflowArtifact(
  state: WorkflowArtifactLifecycle,
  token: WorkflowRevisionToken,
  source: WorkflowArtifactSource,
): WorkflowArtifactLifecycle {
  if (!canAcceptWorkflowResult(state, token)) return state;
  const pending = { ...state.pending };
  delete pending[token.operation];
  return {
    ...state,
    nextArtifactRevision: state.nextArtifactRevision + 1,
    artifact: {
      revision: state.nextArtifactRevision,
      inputRevision: state.inputRevision,
      planRevision: state.planRevision,
      source,
    },
    verificationArtifactRevision: null,
    copiedArtifactRevision: null,
    pending,
  };
}

export function discardWorkflowArtifact(
  state: WorkflowArtifactLifecycle,
  token: WorkflowRevisionToken,
): WorkflowArtifactLifecycle {
  if (!canAcceptWorkflowResult(state, token)) return state;
  return invalidateArtifact(finishWorkflowOperation(state, token));
}

export function replaceWorkflowArtifact(
  state: WorkflowArtifactLifecycle,
  source: WorkflowArtifactSource,
): WorkflowArtifactLifecycle {
  return {
    ...state,
    nextArtifactRevision: state.nextArtifactRevision + 1,
    artifact: {
      revision: state.nextArtifactRevision,
      inputRevision: state.inputRevision,
      planRevision: state.planRevision,
      source,
    },
    verificationArtifactRevision: null,
    copiedArtifactRevision: null,
  };
}

export function clearWorkflowArtifact(state: WorkflowArtifactLifecycle): WorkflowArtifactLifecycle {
  return invalidateArtifact(state);
}

export function clearWorkflowArtifactOutcomes(
  state: WorkflowArtifactLifecycle,
): WorkflowArtifactLifecycle {
  return { ...state, verificationArtifactRevision: null, copiedArtifactRevision: null };
}

export function bindWorkflowVerification(
  state: WorkflowArtifactLifecycle,
  token: WorkflowRevisionToken,
): WorkflowArtifactLifecycle {
  if (!canAcceptWorkflowResult(state, token) || !state.artifact) return state;
  return {
    ...finishWorkflowOperation(state, token),
    verificationArtifactRevision: state.artifact.revision,
  };
}

export function bindWorkflowCopy(
  state: WorkflowArtifactLifecycle,
  token: WorkflowRevisionToken,
): WorkflowArtifactLifecycle {
  if (!canAcceptWorkflowResult(state, token) || !state.artifact) return state;
  return {
    ...finishWorkflowOperation(state, token),
    copiedArtifactRevision: state.artifact.revision,
  };
}

export function isWorkflowArtifactCurrent(
  state: WorkflowArtifactLifecycle,
  source?: WorkflowArtifactSource | null,
): boolean {
  return Boolean(
    state.artifact
      && state.artifact.inputRevision === state.inputRevision
      && state.artifact.planRevision === state.planRevision
      && (source === undefined || state.artifact.source === source),
  );
}
