"""
metrics.py — Collecte et stockage des métriques du chatbot
Intégré dans FastAPI via les routes /metrics/*
"""

import time
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass, field
from collections import deque
from typing import Optional


@dataclass
class MessageMetrics:
    """Métriques d'un seul échange question/réponse."""
    id:                  str
    timestamp:           str
    question:            str
    response_length:     int
    response_time_ms:    float   # Temps total de réponse
    ttfb_ms:             float   # Time to First Byte (streaming)
    tokens_estimated:    int     # Estimation tokens (4 chars ≈ 1 token)
    tokens_per_second:   float
    rag_chunks_used:     int
    rag_score_max:       float   # Score de similarité du meilleur chunk
    rag_score_avg:       float   # Score moyen des chunks utilisés
    model:               str
    workspace:           str
    success:             bool
    error:               Optional[str] = None
    streaming:           bool = True


class MetricsCollector:
    """
    Collecteur de métriques en mémoire (ring buffer de 500 entrées).
    Calcule les agrégats à la demande.
    """

    MAX_HISTORY = 500

    def __init__(self):
        self._history: deque[MessageMetrics] = deque(maxlen=self.MAX_HISTORY)
        self._session_start = datetime.now(timezone.utc).isoformat()
        self._total_requests = 0
        self._total_errors   = 0

    def record(self, m: MessageMetrics) -> None:
        self._history.append(m)
        self._total_requests += 1
        if not m.success:
            self._total_errors += 1

    def summary(self) -> dict:
        """Agrégats globaux pour le dashboard."""
        msgs = list(self._history)
        ok   = [m for m in msgs if m.success]

        if not ok:
            return self._empty_summary()

        rt  = [m.response_time_ms for m in ok]
        tps = [m.tokens_per_second for m in ok if m.tokens_per_second > 0]
        tl  = [m.response_length   for m in ok]
        rs  = [m.rag_score_max     for m in ok if m.rag_score_max > 0]

        # Taux de succès
        success_rate = round(len(ok) / max(self._total_requests, 1) * 100, 1)

        # Percentiles temps de réponse
        rt_sorted = sorted(rt)
        n = len(rt_sorted)
        p50 = rt_sorted[int(n * 0.50)] if n else 0
        p90 = rt_sorted[int(n * 0.90)] if n else 0
        p99 = rt_sorted[int(n * 0.99)] if n else 0

        # Distribution par tranche de temps
        rt_dist = {"<1s": 0, "1-3s": 0, "3-5s": 0, ">5s": 0}
        for r in rt:
            if   r < 1000:  rt_dist["<1s"]  += 1
            elif r < 3000:  rt_dist["1-3s"] += 1
            elif r < 5000:  rt_dist["3-5s"] += 1
            else:           rt_dist[">5s"]  += 1

        # Série temporelle (dernières 20 réponses)
        recent = list(self._history)[-20:]
        timeline = [
            {
                "t":   m.timestamp[11:16],      # HH:MM
                "rt":  round(m.response_time_ms),
                "ok":  m.success,
            }
            for m in recent
        ]

        return {
            "session_start":    self._session_start,
            "total_requests":   self._total_requests,
            "total_errors":     self._total_errors,
            "success_rate":     success_rate,

            # Temps de réponse (ms)
            "rt_avg":           round(sum(rt) / len(rt)),
            "rt_min":           round(min(rt)),
            "rt_max":           round(max(rt)),
            "rt_p50":           round(p50),
            "rt_p90":           round(p90),
            "rt_p99":           round(p99),
            "rt_distribution":  rt_dist,

            # Tokens
            "tps_avg":          round(sum(tps) / len(tps), 1) if tps else 0,
            "tokens_total":     sum(m.tokens_estimated for m in ok),
            "response_len_avg": round(sum(tl) / len(tl)),

            # RAG
            "rag_score_avg":    round(sum(rs) / len(rs), 3) if rs else 0,
            "rag_used_rate":    round(len([m for m in ok if m.rag_chunks_used > 0]) / len(ok) * 100, 1),

            # Série temporelle
            "timeline":         timeline,

            # Dernières erreurs
            "recent_errors": [
                {"t": m.timestamp[11:16], "error": m.error}
                for m in list(self._history)[-50:]
                if not m.success
            ][-5:],
        }

    def _empty_summary(self) -> dict:
        return {
            "session_start": self._session_start,
            "total_requests": 0, "total_errors": 0, "success_rate": 0,
            "rt_avg": 0, "rt_min": 0, "rt_max": 0,
            "rt_p50": 0, "rt_p90": 0, "rt_p99": 0,
            "rt_distribution": {"<1s": 0, "1-3s": 0, "3-5s": 0, ">5s": 0},
            "tps_avg": 0, "tokens_total": 0, "response_len_avg": 0,
            "rag_score_avg": 0, "rag_used_rate": 0,
            "timeline": [], "recent_errors": [],
        }

    def history(self, limit: int = 50) -> list[dict]:
        """Retourne les N dernières métriques individuelles."""
        items = list(self._history)[-limit:]
        return [
            {
                "id":               m.id,
                "t":                m.timestamp[11:19],
                "rt_ms":            round(m.response_time_ms),
                "ttfb_ms":          round(m.ttfb_ms),
                "tokens":           m.tokens_estimated,
                "tps":              round(m.tokens_per_second, 1),
                "response_len":     m.response_length,
                "rag_chunks":       m.rag_chunks_used,
                "rag_score":        round(m.rag_score_max, 3),
                "success":          m.success,
                "error":            m.error,
                "model":            m.model,
            }
            for m in reversed(items)
        ]


# ── Helpers pour mesurer le temps ────────────────────────────────

class ResponseTimer:
    """Chronomètre pour mesurer TTFB et temps total."""

    def __init__(self):
        self.start_ms    = time.time() * 1000
        self.ttfb_ms     = 0.0
        self._first_byte = False

    def mark_first_byte(self):
        if not self._first_byte:
            self.ttfb_ms     = time.time() * 1000 - self.start_ms
            self._first_byte = True

    @property
    def elapsed_ms(self) -> float:
        return time.time() * 1000 - self.start_ms


def estimate_tokens(text: str) -> int:
    """Estimation rapide : 1 token ≈ 4 caractères."""
    return max(1, len(text) // 4)


# Instance globale
metrics_collector = MetricsCollector()