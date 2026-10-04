import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_CONCEPTS = 16
MAX_EDGES = 32
RELATIONSHIPS = ("prerequisite", "related", "supports", "part_of")


def _canonical(value, options):
    """Accept a model's casing/spacing variants of a fixed label ("needs revision"); keep nonsense invalid."""
    def key(text):
        return " ".join(text.replace("_", " ").split()).casefold()
    if isinstance(value, str):
        return next((option for option in options if key(option) == key(value)), value)
    return value


def _slug(value) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value).casefold()).strip("-")[:80]


class TopicAnalysis(BaseModel):
    topic: str = Field(min_length=1)
    important_concepts: list[str]


class DifficultArea(BaseModel):
    concept: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class PDFAnalysis(BaseModel):
    title: str = Field(min_length=1)
    main_topics: list[TopicAnalysis]
    key_revision_points: list[str]
    difficult_areas: list[DifficultArea]


class Quiz(BaseModel):
    topic: str = Field(min_length=1)
    difficulty: Literal["Easy", "Medium", "Hard"]
    question: str = Field(min_length=1)
    expected_answer: str = Field(min_length=1)
    explanation: str = Field(min_length=1)

    @field_validator("difficulty", mode="before")
    @classmethod
    def canonical_difficulty(cls, value):
        return _canonical(value, ("Easy", "Medium", "Hard"))


class Evaluation(BaseModel):
    score: int = Field(ge=0, le=100)
    status: Literal["Strong", "Needs Revision", "Weak"]
    correct_points: list[str]
    missing_points: list[str]
    feedback: str = Field(min_length=1)
    misconceptions: list[str] = Field(default_factory=list, max_length=4)
    resolved_misconceptions: list[str] = Field(default_factory=list, max_length=4)

    @field_validator("status", mode="before")
    @classmethod
    def canonical_status(cls, value):
        return _canonical(value, ("Strong", "Needs Revision", "Weak"))


class Explanation(BaseModel):
    explanation: str = Field(min_length=1, max_length=6_000)


class WeakTopic(BaseModel):
    topic: str
    average_score: float = Field(ge=0, le=100)
    attempts: int = Field(ge=1)
    why_weak: str
    priority: Literal["High", "Medium", "Low"]
    revision_plan: list[str]
    mini_explanation: str
    practice_question: str


class WeakAreaPlan(BaseModel):
    student_id: str
    weak_topics: list[WeakTopic]


class ConceptNode(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    label: str = Field(min_length=1, max_length=120)
    importance: float = Field(ge=0, le=1)


class ConceptEdge(BaseModel):
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)
    relationship: Literal["prerequisite", "related", "supports", "part_of"]


class ConceptGraph(BaseModel):
    concepts: list[ConceptNode] = Field(min_length=1, max_length=MAX_CONCEPTS)
    edges: list[ConceptEdge] = Field(default_factory=list, max_length=MAX_EDGES)

    @model_validator(mode="before")
    @classmethod
    def normalize_model_output(cls, data):
        """Repair harmless model slips (ID casing, dangling or duplicate edges, too many nodes) instead of
        failing the whole graph. Concepts without a label still fail validation."""
        if not isinstance(data, dict) or not isinstance(data.get("concepts"), list):
            return data
        concepts, ids, seen = [], {}, set()
        for concept in data["concepts"]:
            if not isinstance(concept, dict):
                concepts.append(concept)
                continue
            original = concept.get("id") or concept.get("label") or ""
            slug = _slug(original)
            if not slug or slug in seen:
                continue
            seen.add(slug)
            ids[str(original)] = ids[slug] = slug
            if concept.get("label"):
                ids[str(concept["label"])] = ids[_slug(concept["label"])] = slug
            importance = concept.get("importance", 0.5)
            try:
                importance = min(1.0, max(0.0, float(importance)))
            except (TypeError, ValueError):
                pass
            concepts.append({**concept, "id": slug, "importance": importance})
        def weight(concept):
            value = concept.get("importance") if isinstance(concept, dict) else None
            return -value if isinstance(value, float) else 0
        concepts = sorted(concepts, key=weight)[:MAX_CONCEPTS]
        kept = {c["id"] for c in concepts if isinstance(c, dict)}

        edges, pairs = [], set()
        for edge in data.get("edges") or []:
            if not isinstance(edge, dict):
                continue
            source = ids.get(str(edge.get("source")), _slug(edge.get("source", "")))
            target = ids.get(str(edge.get("target")), _slug(edge.get("target", "")))
            relationship = _canonical(str(edge.get("relationship", "related")), RELATIONSHIPS)
            if relationship not in RELATIONSHIPS:
                relationship = "related"
            if source not in kept or target not in kept or source == target or (source, target) in pairs:
                continue
            pairs.add((source, target))
            edges.append({"source": source, "target": target, "relationship": relationship})
        return {**data, "concepts": concepts, "edges": edges[:MAX_EDGES]}

    @model_validator(mode="after")
    def validate_graph(self):
        identifiers = [concept.id for concept in self.concepts]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Concept identifiers must be unique.")
        known = set(identifiers)
        for edge in self.edges:
            if edge.source not in known or edge.target not in known:
                raise ValueError("Every edge must reference known concept identifiers.")
            if edge.source == edge.target:
                raise ValueError("Concept edges cannot reference the same node twice.")
        return self
