import { useRef, useCallback } from "react";
import type { Caption, Hablante } from "../types";
import { HISTORY_LIMIT } from "../utils/constants";

interface Snapshot {
  captions: Caption[];
  hablantes: Hablante[];
}

export function useHistory(
  captionsRef: React.MutableRefObject<Caption[]>,
  hablantesRef: React.MutableRefObject<Hablante[]>,
  setCaptions: React.Dispatch<React.SetStateAction<Caption[]>>,
  setHablantes: React.Dispatch<React.SetStateAction<Hablante[]>>,
) {
  const pastRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);

  const snapshotActual = useCallback((): Snapshot => ({
    captions: [...captionsRef.current],
    hablantes: [...hablantesRef.current],
  }), [captionsRef, hablantesRef]);

  const pushHistorial = useCallback(() => {
    pastRef.current.push(snapshotActual());
    if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
    futureRef.current = [];
  }, [snapshotActual]);

  const deshacer = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const anterior = pastRef.current.pop()!;
    futureRef.current.push(snapshotActual());
    setCaptions(anterior.captions);
    setHablantes(anterior.hablantes);
    captionsRef.current = anterior.captions;
    hablantesRef.current = anterior.hablantes;
  }, [snapshotActual, setCaptions, setHablantes, captionsRef, hablantesRef]);

  const rehacer = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const siguiente = futureRef.current.pop()!;
    pastRef.current.push(snapshotActual());
    setCaptions(siguiente.captions);
    setHablantes(siguiente.hablantes);
    captionsRef.current = siguiente.captions;
    hablantesRef.current = siguiente.hablantes;
  }, [snapshotActual, setCaptions, setHablantes, captionsRef, hablantesRef]);

  return { pushHistorial, deshacer, rehacer };
}
