"""
Preference axis extraction: translates a PsychologicalProfile into a ranked list
of PreferenceAxis objects used by the deliberative scorer.

Three axis families:

  Value axes (food / service / price / atmosphere):
    Derived from value_keyword mention counts in the user's review history.
    weight = count / total_mentions  →  a user mentioning food 8/10 times gets weight=0.8.

  Rating bias axis:
    Fires when |mean − 3.0| ≥ 0.5 (user is meaningfully generous or harsh).
    weight = min(|mean − 3.0| / 2, 1.0)
    Used to surface items whose star ratings align with the user's calibration.

  Cultural register axis:
    Fires when code_switching_detected=True (Nigerian English / pidgin detected).
    weight = min(nigerian_english_index × 10, 1.0)
    Surfaces items whose review corpora contain Nigerian cultural markers.

Axes are sorted by weight descending so the highest-signal dimensions dominate scoring.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

from .profile import PsychologicalProfile, profile_from_dict


@dataclass(frozen=True)
class PreferenceAxis:
    """A single preference dimension with its reranking weight and a human-readable rationale."""
    name: str
    rationale: str
    weight: float


def extract_preference_axes(profile: PsychologicalProfile | Dict[str, object]) -> List[PreferenceAxis]:
    if isinstance(profile, dict):
        profile = profile_from_dict(profile)
    axes: List[PreferenceAxis] = []

    value_keywords = profile.value_keywords
    total_mentions = sum(value_keywords.values())
    if total_mentions > 0:
        for name, count in value_keywords.items():
            weight = count / total_mentions
            if weight == 0:
                continue
            axes.append(
                PreferenceAxis(
                    name=name,
                    rationale=f"Mentions {name} in {count} reviews",
                    weight=weight,
                )
            )

    rating_bias = profile.rating_stats.mean - 3.0
    if abs(rating_bias) >= 0.5:
        bias_label = "generous" if rating_bias > 0 else "harsh"
        axes.append(
            PreferenceAxis(
                name="rating_bias",
                rationale=f"Average rating {profile.rating_stats.mean:.2f} indicates a {bias_label} rater",
                weight=min(abs(rating_bias) / 2.0, 1.0),
            )
        )

    if profile.cultural_signals.code_switching_detected:
        axes.append(
            PreferenceAxis(
                name="cultural_register",
                rationale="Code-switching detected in reviews",
                weight=min(profile.cultural_signals.nigerian_english_index * 10, 1.0),
            )
        )

    return sorted(axes, key=lambda axis: axis.weight, reverse=True)
