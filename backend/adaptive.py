DIFFICULTIES = ("Easy", "Medium", "Hard")


def status_for_score(score: int) -> str:
    if score >= 85:
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


def choose_next_target(history: list[dict], requested_topic: str | None = None) -> tuple[str | None, str, str]:
    if not history:
        return requested_topic, "Medium", "No previous attempts; begin with a balanced question."

    by_topic: dict[str, list[dict]] = {}
    for attempt in history:
        by_topic.setdefault(attempt["topic"], []).append(attempt)

    averages = {
        topic: sum(item["score"] for item in attempts) / len(attempts)
        for topic, attempts in by_topic.items()
    }
    high_risk = {
        topic: sum(item.get("confidence") == "high" and item["score"] < 60 for item in attempts)
        for topic, attempts in by_topic.items()
    }
    weakest = min(averages, key=lambda topic: (-high_risk[topic], averages[topic], topic.lower()))
    topic = weakest if high_risk[weakest] or averages[weakest] < 85 else requested_topic
    if topic is None:
        topic = min(by_topic, key=lambda name: len(by_topic[name]))

    attempts = by_topic.get(topic, [])
    if not attempts:
        return topic, "Medium", "Selected a new topic after strong prior performance."
    latest = attempts[-1]
    difficulty = next_difficulty(
        latest.get("difficulty", "Medium"), latest["score"], latest.get("confidence", "medium")
    )
    score = averages[topic]
    if high_risk[topic]:
        reason = (f"Highest priority: {high_risk[topic]} high-confidence incorrect attempt(s); "
                  f"{score:.1f}% topic average.")
    elif latest.get("confidence") == "low" and latest["score"] >= 85:
        reason = f"Light reinforcement after a correct but uncertain answer; {score:.1f}% topic average."
    else:
        reason = f"Selected from deterministic history: {len(attempts)} attempt(s), {score:.1f}% average."
    return topic, difficulty, reason
