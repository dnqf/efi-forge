import { describe, expect, it } from "vitest";
import {
  acceptWorkflowInputResult,
  beginWorkflowOperation,
  bindWorkflowArtifact,
  bindWorkflowCopy,
  bindWorkflowVerification,
  canAcceptWorkflowResult,
  changeWorkflowInput,
  changeWorkflowPlan,
  createWorkflowArtifactLifecycle,
  finishWorkflowOperation,
  isWorkflowArtifactCurrent,
} from "./artifactLifecycle";

function builtState() {
  const initial = createWorkflowArtifactLifecycle();
  const started = beginWorkflowOperation(initial, "build");
  return bindWorkflowArtifact(started.state, started.token, "generated");
}

describe("workflow artifact lifecycle", () => {
  it("rejects a slow hardware result after another input revision wins", () => {
    const started = beginWorkflowOperation(createWorkflowArtifactLifecycle(), "hardware-input");
    const changed = changeWorkflowInput(started.state);
    expect(canAcceptWorkflowResult(changed, started.token)).toBe(false);
  });

  it("accepts a current hardware result as one atomic input revision transition", () => {
    const started = beginWorkflowOperation(createWorkflowArtifactLifecycle(), "hardware-input");
    const accepted = acceptWorkflowInputResult(started.state, started.token);
    expect(accepted.inputRevision).toBe(1);
    expect(accepted.planRevision).toBe(1);
    expect(accepted.pending["hardware-input"]).toBeUndefined();
  });

  it("invalidates a build that completes after target macOS changes", () => {
    const started = beginWorkflowOperation(createWorkflowArtifactLifecycle(), "build");
    const changed = changeWorkflowInput(started.state);
    expect(bindWorkflowArtifact(changed, started.token, "generated").artifact).toBeNull();
  });

  it("invalidates artifact, verification, and copy when a plan preference changes", () => {
    let state = builtState();
    const verification = beginWorkflowOperation(state, "verification-import");
    state = bindWorkflowVerification(verification.state, verification.token);
    const copy = beginWorkflowOperation(state, "copy");
    state = bindWorkflowCopy(copy.state, copy.token);

    const changed = changeWorkflowPlan(state);
    expect(changed.artifact).toBeNull();
    expect(changed.verificationArtifactRevision).toBeNull();
    expect(changed.copiedArtifactRevision).toBeNull();
  });

  it("keeps a valid artifact when a file picker is cancelled", () => {
    const state = builtState();
    const started = beginWorkflowOperation(state, "custom-import");
    const cancelled = finishWorkflowOperation(started.state, started.token);
    expect(cancelled.artifact).toEqual(state.artifact);
    expect(isWorkflowArtifactCurrent(cancelled)).toBe(true);
  });


  it("keeps the source artifact and clears only pending target state on failure", () => {
    const state = builtState();
    const started = beginWorkflowOperation(state, "merge");
    const failed = finishWorkflowOperation(started.state, started.token);
    expect(failed.artifact).toEqual(state.artifact);
    expect(failed.pending.merge).toBeUndefined();
  });

  it.each(["build", "custom-import"] as const)(
    "keeps the active source when %s completes without an acceptable artifact",
    (operation) => {
      const state = builtState();
      const started = beginWorkflowOperation(state, operation);
      const rejected = finishWorkflowOperation(started.state, started.token);
      expect(rejected.artifact).toEqual(state.artifact);
      expect(rejected.pending[operation]).toBeUndefined();
    },
  );

  it("does not bind mismatched verification evidence", () => {
    const state = builtState();
    const started = beginWorkflowOperation(state, "verification-import");
    const mismatch = finishWorkflowOperation(started.state, started.token);
    expect(mismatch.verificationArtifactRevision).toBeNull();
    expect(mismatch.artifact).toEqual(state.artifact);
  });

  it("rejects copy completion after the bound artifact changes", () => {
    const state = builtState();
    const copy = beginWorkflowOperation(state, "copy");
    const merge = beginWorkflowOperation(copy.state, "merge");
    const replaced = bindWorkflowArtifact(merge.state, merge.token, "merged");
    expect(canAcceptWorkflowResult(replaced, copy.token)).toBe(false);
    expect(bindWorkflowCopy(replaced, copy.token).copiedArtifactRevision).toBeNull();
  });
});
