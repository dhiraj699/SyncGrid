import { useCallback, useEffect, useRef, useState } from 'react';
import { applyBackward, applyForward } from '../domain/replay.js';
import { api } from '../services/apiClient.js';

const PAGE_SIZE = 5_000;

/**
 * Time-travel over the event log. The baseline and events are fetched once;
 * scrubbing then walks events forwards/backwards in memory using previousValue,
 * so cost is proportional to the distance moved, not the sheet size.
 */
export function useReplay({ sheetId, active, liveRevision }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [position, setPosition] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [version, setVersion] = useState(0);
  const model = useRef({ cells: {}, events: [], baselineSeq: 0, position: 0, loading: false });
  const loadStarted = useRef(false);

  const fetchEventsAfter = useCallback(async (afterSeq) => {
    const collected = [];
    let cursor = afterSeq;
    for (;;) {
      const page = await api.getEvents(sheetId, cursor, PAGE_SIZE);
      collected.push(...page.events);
      if (!page.hasMore || page.events.length === 0) return collected;
      cursor = page.events.at(-1).seq;
    }
  }, [sheetId]);

  useEffect(() => {
    if (!active || loadStarted.current) return;
    loadStarted.current = true;
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const baseline = await api.getBaseline(sheetId);
        const events = await fetchEventsAfter(baseline.baselineSeq);
        if (cancelled) return;
        model.current = { cells: { ...baseline.cells }, events, baselineSeq: baseline.baselineSeq, position: events.length, loading: false };
        setEventCount(events.length);
        setPosition(events.length);
        setStatus('ready');
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError.message);
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      loadStarted.current = false;
    };
  }, [active, sheetId, fetchEventsAfter]);

  useEffect(() => {
    const current = model.current;
    const loadedRevision = current.baselineSeq + current.events.length;
    if (status !== 'ready' || !active || current.loading || liveRevision <= loadedRevision) return;
    current.loading = true;
    fetchEventsAfter(loadedRevision)
      .then((fresh) => {
        const followingHead = current.position === current.events.length;
        current.events.push(...fresh);
        if (followingHead) {
          fresh.forEach((event) => applyForward(current.cells, event));
          current.position = current.events.length;
          setPosition(current.position);
          setVersion((value) => value + 1);
        }
        setEventCount(current.events.length);
      })
      .catch(() => {})
      .finally(() => { current.loading = false; });
  }, [status, active, liveRevision, fetchEventsAfter]);

  const seek = useCallback((target) => {
    const current = model.current;
    const destination = Math.max(0, Math.min(current.events.length, target));
    while (current.position < destination) applyForward(current.cells, current.events[current.position++]);
    while (current.position > destination) applyBackward(current.cells, current.events[--current.position]);
    setPosition(destination);
    setVersion((value) => value + 1);
  }, []);

  return {
    status,
    error,
    position,
    eventCount,
    version,
    isReplaying: status === 'ready' && position < eventCount,
    cells: model.current.cells,
    events: model.current.events,
    baselineSeq: model.current.baselineSeq,
    seek,
  };
}
