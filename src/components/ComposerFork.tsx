import { useRef, useState } from "react";
import { draftRevision } from "@/lib/drafts";
import { useStoreDispatch } from "@/state/store-select";

export function useComposerFork({ ownerId, kind, threadId, branchLeafId, draftId, text, editText, stopDictation }: {
  ownerId?: string;
  kind: "bot" | "group";
  threadId: string;
  branchLeafId?: string;
  draftId: string;
  text: string;
  editText: (text: string) => void;
  stopDictation: () => void;
}) {
  const dispatch = useStoreDispatch();
  const pending = useRef(false);
  const [failure, setFailure] = useState<{ draftId: string; revision: number; message: string }>();
  const command = Boolean(ownerId && /^\/fork\s*$/i.test(text));
  const error = command && failure?.draftId === draftId && failure.revision === draftRevision(draftId)
    ? failure.message : undefined;

  function submit() {
    if (!command || !ownerId || pending.current) return;
    pending.current = true;
    stopDictation();
    const revision = draftRevision(draftId);
    setFailure(undefined);
    dispatch({
      type: "forkMessage", kind, ownerId, threadId, branchLeafId,
      onSuccess: () => {
        pending.current = false;
        if (draftRevision(draftId) === revision) editText("");
      },
      onError: (message) => {
        pending.current = false;
        setFailure({ draftId, revision, message });
      },
    });
  }

  return { command, error, submit };
}
