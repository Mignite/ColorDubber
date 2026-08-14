import { memo, useRef, useState, useCallback, useLayoutEffect, useEffect } from "react";
import type { Caption, Hablante } from "../types";
import { formatTime } from "../utils/time";

const ROW_HEIGHT = 68;
const ROW_MARGIN = 4;
const ROW_TOTAL = ROW_HEIGHT + ROW_MARGIN;
const BUFFER = 8;

interface Props {
  captions: Caption[];
  currentCaptionIdx: number;
  onSelectCaption: (id: string) => void;
  onEliminarCaption: (id: string) => void;
  onSeekTo: (time: number) => void;
  rowRefs?: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  speakerMap: Map<string, Hablante>;
}

function CaptionList({ captions, currentCaptionIdx, onSelectCaption, onEliminarCaption, onSeekTo, rowRefs, speakerMap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      const h = el.clientHeight;
      if (h > 0) setContainerHeight(h);
    }
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      if (h > 0) setContainerHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalHeight = captions.length * ROW_TOTAL;
  const effectiveHeight = containerHeight > 0 ? containerHeight : 600;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_TOTAL) - BUFFER);
  const endIdx = Math.min(
    captions.length,
    Math.ceil((scrollTop + effectiveHeight) / ROW_TOTAL) + BUFFER
  );
  const visibleCaptions = captions.slice(startIdx, endIdx);
  const offsetY = startIdx * ROW_TOTAL;

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return (
    <div
      ref={containerRef}
      className="captionListVirtual"
      onScroll={onScroll}
    >
      {captions.length === 0 ? (
        <p className="placeholder">
          Sin subtítulos cargados (Archivo → Cargar SRT, o arrastrá el .srt acá)
        </p>
      ) : (
        <div style={{ height: totalHeight, position: "relative" }}>
          <div style={{ position: "absolute", top: offsetY, left: 0, right: 0 }}>
            {visibleCaptions.map((c, i) => {
              const idx = startIdx + i;
              const sp = speakerMap.get(c.hablante_id ?? "");
              return (
                <div
                  key={c.id}
                  ref={(el) => {
                    if (rowRefs?.current) rowRefs.current[c.id] = el;
                  }}
                  className={`captionRow ${idx === currentCaptionIdx ? "active" : ""}`}
                  style={{
                    borderLeftColor: sp ? sp.color : "transparent",
                    height: ROW_HEIGHT,
                    marginBottom: ROW_MARGIN,
                  }}
                  onClick={() => {
                    onSelectCaption(c.id);
                    onSeekTo(c.inicio);
                  }}
                >
                  <div className="captionTime">
                    {formatTime(c.inicio)} → {formatTime(c.fin)}
                    {sp && (
                      <span className="captionSpeakerTag" style={{ color: sp.color }}>
                        {sp.nombre || sp.tecla}
                      </span>
                    )}
                    <button
                      className="iconBtnSmall captionDeleteBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEliminarCaption(c.id);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="captionText">{c.texto}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(CaptionList);
