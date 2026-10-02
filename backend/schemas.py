from typing import Literal

from pydantic import BaseModel, Field


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

