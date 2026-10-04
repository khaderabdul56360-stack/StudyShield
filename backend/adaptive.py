"""Deterministic student model. The local model never decides scores, priorities or topic order."""

from collections import Counter

DIFFICULTIES = ("Easy", "Medium", "Hard")
MASTERY_THRESHOLD = 85

# Revision-queue signals, strongest first. Every feature (queue, Quick Revision, Exam Mode,
# session summaries) ranks topics through this one table.
SIGNALS = {
    "high_risk_misconception": (1, "High-confidence misconception"),
    "weak": (2, "Weak: below 60%"),
    "needs_revision": (3, "Below the 85% mastery threshold"),
    "repeated_incorrect": (4, "Repeated incorrect attempts"),
    "high_confidence_incorrect": (5, "Past high-confidence mistake"),
    "uncertain_correct": (6, "Correct but uncertain"),
    "unpracticed": (7, "Not practised yet"),
    "reinforcement": (8, "Mastered: reinforcement"),
}
# Signals that mean a topic still needs work; used by the "Weak Areas" session scope.
NEEDS_WORK = {"high_risk_misconception", "weak", "needs_revision", "repeated_incorrect",
              "high_confidence_incorrect"}
INSIGHT_ORDER = ("Confident & Correct", "Confident but Incomplete", "High-Risk Misconception",
                 "Correct but Uncertain", "Needs Guided Practice", "Needs More Practice",
                 "Medium confidence")


def status_for_score(score: float) -> str:
    if score >= MASTERY_THRESHOLD:
        return "Strong"
    if score >= 60:
        return "Needs Revision"
    return "Weak"


def confidence_insight(confidence: str, score: int, status: str | None = None) -> str:
    """Interpret confidence deterministically; the model never controls this label."""
    normalized = confidence.casefold()
    if normalized == "high":
        if score >= 85:
            return "Confident & Correct"
        if score < 60:
            return "High-Risk Misconception"
        return "Confident but Incomplete"
    if normalized == "low":
        if score >= 85:
            return "Correct but Uncertain"
        if score < 60:
            return "Needs Guided Practice"
        return "Needs More Practice"
    return f"Medium confidence · {status or status_for_score(score)}"


def next_difficulty(current: str, score: float, confidence: str = "medium") -> str:
    try:
        index = DIFFICULTIES.index(current)
    except ValueError:
        index = 1
    if score >= 85 and confidence != "low":
        index = min(index + 1, len(DIFFICULTIES) - 1)
    elif score < 60:
        index = max(index - 1, 0)
    return DIFFICULTIES[index]


def priority_for_score(score: float) -> str:
    if score < 50:
        return "High"
    if score < 70:
        return "Medium"
    return "Low"


def _profiles(history: list[dict], misconceptions=()) -> dict[str, dict]:
    profiles: dict[str, dict] = {}
    for order, attempt in enumerate(history):
        profile = profiles.setdefault(attempt["topic"], {
            "attempts": [], "high_confidence_wrong": 0, "low_confidence_correct": 0,
            "incorrect": 0, "active_misconceptions": 0, "risk_open": False,
        })
        profile["attempts"].append(attempt)
        profile["last_order"] = order
        confidence = attempt.get("confidence", "medium")
        profile["high_confidence_wrong"] += confidence == "high" and attempt["score"] < 60
        profile["low_confidence_correct"] += confidence == "low" and attempt["score"] >= 85
        profile["incorrect"] += attempt["score"] < 60
        # A confident miss stays open until a later Strong answer on the topic provides evidence, the same
        # evidence rule /resolve-misconception uses.
        if confidence == "high" and attempt["score"] < 60:
            profile["risk_open"] = True
        elif attempt["score"] >= MASTERY_THRESHOLD:
            profile["risk_open"] = False
    for item in misconceptions:
        if not item.get("resolved") and item["topic"] in profiles:
            profiles[item["topic"]]["active_misconceptions"] += 1
    return profiles


def _signal_for(profile: dict, average: float) -> str:
    latest = profile["attempts"][-1]
    hcw = profile["high_confidence_wrong"]
    if profile["risk_open"]:
        return "high_risk_misconception"
    if average < 60:
        return "weak"
    if average < MASTERY_THRESHOLD:
        return "needs_revision"
    if profile["incorrect"] >= 2:
        return "repeated_incorrect"
    if hcw:
        return "high_confidence_incorrect"
    if latest.get("confidence") == "low" and latest["score"] >= MASTERY_THRESHOLD:
        return "uncertain_correct"
    return "reinforcement"


def revision_queue(history: list[dict], misconceptions=(), concepts=()) -> list[dict]:
    """Rank every topic the student should study next. `concepts` are unpractised graph concepts."""
    profiles = _profiles(history, misconceptions)
    items = []
    for topic, profile in profiles.items():
        scores = [attempt["score"] for attempt in profile["attempts"]]
        average = round(sum(scores) / len(scores), 1)
        signal = _signal_for(profile, average)
        rank, label = SIGNALS[signal]
        reason = label
        if signal in ("weak", "needs_revision"):
            reason = f"Average score {average:.0f}%"
        if profile["active_misconceptions"] and signal != "high_risk_misconception":
            reason += f" · {profile['active_misconceptions']} active misconception(s)"
        secondary = {
            1: (-profile["high_confidence_wrong"], average),
            4: (-profile["incorrect"], average),
            8: (profile["last_order"], average),
        }.get(rank, (average, 0))
        items.append({
            "topic": topic, "signal": signal, "signal_rank": rank, "reason": reason,
            "priority": "High" if profile["high_confidence_wrong"] else priority_for_score(average),
            "average_score": average, "attempts": len(scores), "status": status_for_score(average),
            "high_confidence_wrong": profile["high_confidence_wrong"],
            "low_confidence_correct": profile["low_confidence_correct"],
            "active_misconceptions": profile["active_misconceptions"],
            "_key": (rank, *secondary, topic.casefold()),
        })
    seen = {topic.casefold() for topic in profiles}
    for concept in sorted(concepts, key=lambda item: -float(item.get("importance", 0))):
        label = concept["label"]
        if label.casefold() in seen:
            continue
        seen.add(label.casefold())
        importance = float(concept.get("importance", 0))
        rank, reason = SIGNALS["unpracticed"]
        items.append({
            "topic": label, "signal": "unpracticed", "signal_rank": rank,
            "reason": "Important concept, not practised yet" if importance >= .7 else reason,
            "priority": "Low", "average_score": None, "attempts": 0, "status": "Unpractised",
            "high_confidence_wrong": 0, "low_confidence_correct": 0, "active_misconceptions": 0,
            "importance": importance, "_key": (rank, -importance, 0, label.casefold()),
        })
    items.sort(key=lambda item: item.pop("_key"))
    for position, item in enumerate(items, start=1):
        item["position"] = position
    return items


def _selection_reason(item: dict) -> str:
    if item["signal"] == "unpracticed":
        return "Important concept from your notes that you haven't practised yet."
    average, attempts = item["average_score"], item["attempts"]
    return {
        "high_risk_misconception": (f"Highest priority: {item['high_confidence_wrong']} high-confidence "
                                    f"incorrect attempt(s); {average:.1f}% topic average."),
        "weak": f"Weakest area: {attempts} attempt(s), {average:.1f}% average.",
        "needs_revision": f"Below the 85% mastery threshold: {attempts} attempt(s), {average:.1f}% average.",
        "repeated_incorrect": f"Repeated incorrect attempts on this topic; {average:.1f}% average.",
        "high_confidence_incorrect": (f"Re-checking a topic you were once confidently wrong about; "
                                      f"{average:.1f}% average."),
        "uncertain_correct": f"Light reinforcement after a correct but uncertain answer; {average:.1f}% topic average.",
        "unpracticed": "Important concept from your notes that you haven't practised yet.",
        "reinforcement": f"Reinforcing a mastered topic: {attempts} attempt(s), {average:.1f}% average.",
    }[item["signal"]]


def choose_next_target(history: list[dict], requested_topic: str | None = None,
                       focus: bool = False, misconceptions=(), concepts=(),
                       scope: str = "adaptive", avoid=()) -> tuple[str | None, str, str]:
    # An explicit "Practice This" / Focus Session choice is honoured; otherwise requested_topic is a hint.
    if focus and requested_topic:
        attempts = [item for item in history if item["topic"] == requested_topic]
        if not attempts:
            return requested_topic, "Medium", "Practising the topic you chose; no previous attempts yet."
        latest = attempts[-1]
        difficulty = next_difficulty(
            latest.get("difficulty", "Medium"), latest["score"], latest.get("confidence", "medium")
        )
        average = sum(item["score"] for item in attempts) / len(attempts)
        return requested_topic, difficulty, (f"Practising the topic you chose: {len(attempts)} attempt(s), "
                                             f"{average:.1f}% average.")

    avoided = {topic.casefold() for topic in avoid}
    if not history and requested_topic and requested_topic.casefold() not in avoided:
        return requested_topic, "Medium", "No previous attempts; begin with a balanced question."

    candidates = list(concepts)
    practised = {item["topic"] for item in history}
    if requested_topic and requested_topic not in practised:
        candidates.insert(0, {"label": requested_topic, "importance": 1.0})
    queue = revision_queue(history, misconceptions, candidates)
    if scope == "weak":
        queue = [item for item in queue if item["signal"] in NEEDS_WORK] or queue
    queue = [item for item in queue if item["topic"].casefold() not in avoided]
    if not queue:
        if not history:
            return None, "Medium", "No previous attempts; begin with a balanced question."
        return None, "Medium", "Covering a new part of your notes."

    top = queue[0]
    attempts = [item for item in history if item["topic"] == top["topic"]]
    if not attempts:
        return top["topic"], "Medium", _selection_reason(top)
    latest = attempts[-1]
    difficulty = next_difficulty(
        latest.get("difficulty", "Medium"), latest["score"], latest.get("confidence", "medium")
    )
    return top["topic"], difficulty, _selection_reason(top)


def _insight_group(label: str) -> str:
    return "Medium confidence" if label.startswith("Medium confidence") else label


def summarize_session(attempts: list[dict], misconceptions=()) -> dict:
    """Deterministic summary of a Quick Revision, Focus Session or Exam from its saved attempts."""
    count = len(attempts)
    scores = [attempt["score"] for attempt in attempts]
    statuses = Counter(status_for_score(score) for score in scores)
    insights = Counter(_insight_group(attempt.get("confidence_insight", "")) for attempt in attempts)

    topics: dict[str, list[int]] = {}
    for attempt in attempts:
        topics.setdefault(attempt["topic"], []).append(attempt["score"])
    topic_rows = []
    for topic, values in topics.items():
        average = round(sum(values) / len(values), 1)
        topic_rows.append({"topic": topic, "questions": len(values), "average_score": average,
                           "status": status_for_score(average)})
    topic_rows.sort(key=lambda row: (-row["average_score"], row["topic"].casefold()))

    overconfident = insights.get("High-Risk Misconception", 0)
    underconfident = insights.get("Correct but Uncertain", 0)
    return {
        "questions_completed": count,
        "average_score": round(sum(scores) / count, 1) if count else None,
        "status_counts": {status: statuses.get(status, 0) for status in ("Strong", "Needs Revision", "Weak")},
        "confidence_counts": [{"label": label, "count": insights[label]}
                              for label in INSIGHT_ORDER if insights.get(label)],
        "calibration": {"aligned": count - overconfident - underconfident,
                        "overconfident": overconfident, "underconfident": underconfident, "total": count},
        "questions": [{
            "attempt_id": attempt["id"], "topic": attempt["topic"], "question": attempt["question"],
            "difficulty": attempt.get("difficulty", "Medium"), "score": attempt["score"],
            "status": status_for_score(attempt["score"]), "confidence": attempt.get("confidence", "medium"),
            "confidence_insight": attempt.get("confidence_insight", ""), "feedback": attempt.get("feedback", ""),
            "correct_points": attempt.get("correct_points", []),
            "missing_points": attempt.get("missing_points", []),
        } for attempt in attempts],
        "topics": topic_rows,
        "strong_topics": [row["topic"] for row in topic_rows if row["status"] == "Strong"],
        "weak_topics": [row["topic"] for row in topic_rows if row["status"] != "Strong"],
        "misconceptions": [{"id": item["id"], "topic": item["topic"], "misconception": item["misconception"],
                            "resolved": bool(item.get("resolved"))} for item in misconceptions],
    }
