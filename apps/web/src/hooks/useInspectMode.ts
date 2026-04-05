import { useState, useCallback, useRef, useEffect } from 'react';
import { ElementContext } from '../types';

export interface UseInspectModeReturn {
  isInspectMode: boolean;
  selectedContext: ElementContext | null;
  toggleInspectMode: () => void;
  iframeRef: React.RefObject<HTMLIFrameElement>;
}

export function useInspectMode(): UseInspectModeReturn {
  const [isInspectMode, setIsInspectMode] = useState(false);
  const [selectedContext, setSelectedContext] = useState<ElementContext | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Post a message to the embedded demo-app iframe
  const sendToFrame = useCallback((type: 'ENABLE_INSPECT' | 'DISABLE_INSPECT') => {
    iframeRef.current?.contentWindow?.postMessage({ type }, '*');
  }, []);

  const toggleInspectMode = useCallback(() => {
    setIsInspectMode((prev) => {
      const next = !prev;
      sendToFrame(next ? 'ENABLE_INSPECT' : 'DISABLE_INSPECT');
      return next;
    });
  }, [sendToFrame]);

  // Listen for ELEMENT_SELECT messages sent back from the iframe
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === 'ELEMENT_SELECT') {
        setSelectedContext(e.data.data as ElementContext);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return { isInspectMode, selectedContext, toggleInspectMode, iframeRef };
}
