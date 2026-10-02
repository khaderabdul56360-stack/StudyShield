DIFFICULTIES = ("Easy", "Medium", "Hard")


def status_for_score(score: int) -> str:
    if score >= 85:
        return "Strong"
    if score >= 60:
        return "Needs Revision"
    return "Weak"


def next_difficulty(current: str, score: float) -> str:
    try:
        index = DIFFICULTIES.index(current)
    except ValueError:
        index = 1
    if score >= 85:
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
    weakest = min(averages, key=lambda topic: (averages[topic], topic.lower()))
    topic = weakest if averages[weakest] < 85 else requested_topic
    if topic is None:
        topic = min(by_topic, key=lambda name: len(by_topic[name]))

    attempts = by_topic.get(topic, [])
    if not attempts:
        return topic, "Medium", "Selected a new topic after strong prior performance."
    latest = attempts[-1]
    difficulty = next_difficulty(latest.get("difficulty", "Medium"), latest["score"])
    score = averages[topic]
    reason = f"Selected from deterministic history: {len(attempts)} attempt(s), {score:.1f}% average."
    return topic, difficulty, reason

