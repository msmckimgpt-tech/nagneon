import { useEffect, useRef, useState } from 'react';
import { createSoundAnalysisSource } from './sound-analysis-source';

export function useSoundAnalysisSource(
  source: MediaStream | null,
  onError: (message: string) => void,
) {
  const [current, setCurrent] = useState<{
    owner: MediaStream | null;
    stream: MediaStream | null;
  } | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  useEffect(() => {
    try {
      const owned = createSoundAnalysisSource(source);
      setCurrent({ owner: source, stream: owned.stream });
      return owned.close;
    } catch {
      setCurrent({ owner: source, stream: null });
      errorRef.current(
        '시스템 소리 분석을 준비하지 못했습니다. 원본 소리의 클립 녹음 연결은 유지합니다.',
      );
    }
  }, [source]);
  // Never hand the previous source to a new capture generation while effects settle.
  return current && current.owner === source ? current.stream : null;
}
