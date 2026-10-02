from typing import Literal

from pydantic import BaseModel, Field, model_validator


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


class Evaluation(BaseModel):
    score: int = Field(ge=0, le=100)
    status: Literal["Strong", "Needs Revision", "Weak"]
    correct_points: list[str]
    missing_points: list[str]
    feedback: str = Field(min_length=1)
    misconceptions: list[str] = Field(default_factory=list, max_length=4)
    resolved_misconceptions: list[str] = Field(default_factory=list, max_length=4)


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
    concepts: list[ConceptNode] = Field(min_length=1, max_length=16)
    edges: list[ConceptEdge] = Field(default_factory=list, max_length=32)

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
