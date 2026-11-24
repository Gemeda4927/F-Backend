import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';

if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    connectionTimeoutMillis: 30_000,
  }),
});

function stableId(key: string) {
  const h = createHash('sha256')
    .update(`learnova:ai-course-outline:${key}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const outline = `# ARTIFICIAL INTELLIGENCE (AI)
## COMPLETE COURSE OUTLINE

### CHAPTER ONE: INTRODUCTION TO ARTIFICIAL INTELLIGENCE

1.1 Introduction to Artificial Intelligence
1.2 Definition of Artificial Intelligence
1.3 Goals and Objectives of AI
1.4 History and Evolution of AI
1.5 Foundations of Artificial Intelligence
1.6 Characteristics of Intelligent Systems
1.7 Types of Artificial Intelligence
1.8 Approaches to Artificial Intelligence
1.9 Traditional Programming vs. Artificial Intelligence
1.10 Major Areas of Artificial Intelligence
1.11 Real-World Applications of AI
1.12 Advantages and Limitations of AI
1.13 Challenges of Artificial Intelligence
1.14 Chapter Summary
1.15 Review Questions

### CHAPTER TWO: INTELLIGENT AGENTS AND ENVIRONMENTS

2.1 Introduction to Intelligent Agents
2.2 Definition of an Intelligent Agent
2.3 Structure of Intelligent Agents
2.4 Agent Functions and Agent Programs
2.5 Rationality and Rational Agents
2.6 Performance Measures
2.7 PEAS Framework
2.8 Task Environments
2.9 Properties of Agent Environments
2.10 Types of Intelligent Agents
  2.10.1 Simple Reflex Agents
  2.10.2 Model-Based Reflex Agents
  2.10.3 Goal-Based Agents
  2.10.4 Utility-Based Agents
  2.10.5 Learning Agents (Conceptual Overview)
2.11 Agent Architecture
2.12 Practical Examples of Intelligent Agents
2.13 Chapter Summary
2.14 Review Questions

### CHAPTER THREE: PROBLEM-SOLVING AND SEARCH STRATEGIES

3.1 Introduction to Problem-Solving in AI
3.2 Problem-Solving Agents
3.3 Problem Formulation
3.4 State Space Representation
3.5 Initial State and Goal State
3.6 Actions and Transition Models
3.7 Search Trees and Search Graphs
3.8 Uninformed Search Strategies
  3.8.1 Breadth-First Search (BFS)
  3.8.2 Depth-First Search (DFS)
  3.8.3 Uniform-Cost Search (UCS)
  3.8.4 Depth-Limited Search
  3.8.5 Iterative Deepening Search
  3.8.6 Bidirectional Search
3.9 Informed Search Strategies
  3.9.1 Heuristic Functions
  3.9.2 Greedy Best-First Search
  3.9.3 A* Search Algorithm
3.10 Comparison of Search Algorithms
3.11 Completeness and Optimality
3.12 Time and Space Complexity
3.13 Practical Search Problems
3.14 Chapter Summary
3.15 Review Questions

### CHAPTER FOUR: LOCAL SEARCH AND ADVERSARIAL SEARCH

4.1 Introduction to Local Search
4.2 Local Search vs. Systematic Search
4.3 Hill-Climbing Search
4.4 Problems with Hill Climbing
4.5 Simulated Annealing
4.6 Local Beam Search
4.7 Genetic Algorithms as Search Techniques
4.8 Introduction to Adversarial Search
4.9 Game-Playing Agents
4.10 Game Trees
4.11 Minimax Algorithm
4.12 Alpha-Beta Pruning
4.13 Evaluation Functions
4.14 Applications in Game Playing
4.15 Chapter Summary
4.16 Review Questions

### CHAPTER FIVE: KNOWLEDGE REPRESENTATION AND LOGICAL REASONING

5.1 Introduction to Knowledge Representation
5.2 Knowledge-Based Agents
5.3 Types of Knowledge
5.4 Knowledge Representation Techniques
5.5 Propositional Logic
5.6 Logical Operators and Truth Tables
5.7 Logical Equivalence
5.8 Inference Rules
5.9 First-Order Predicate Logic
5.10 Predicates and Quantifiers
5.11 Syntax and Semantics of Logic
5.12 Forward Chaining
5.13 Backward Chaining
5.14 Resolution and Unification
5.15 Semantic Networks
5.16 Frames and Ontologies
5.17 Applications of Knowledge Representation
5.18 Chapter Summary
5.19 Review Questions

### CHAPTER SIX: REASONING UNDER UNCERTAINTY

6.1 Introduction to Uncertainty in AI
6.2 Sources of Uncertainty
6.3 Reasoning with Incomplete Information
6.4 Fundamentals of Probability
6.5 Conditional Probability
6.6 Bayes' Theorem
6.7 Bayesian Reasoning
6.8 Bayesian Networks
6.9 Probabilistic Inference
6.10 Introduction to Fuzzy Logic
6.11 Fuzzy Sets and Membership Functions
6.12 Fuzzy Rules and Inference
6.13 Probability vs. Fuzzy Logic
6.14 Practical Applications
6.15 Chapter Summary
6.16 Review Questions

### CHAPTER SEVEN: AUTOMATED PLANNING AND CONSTRAINT SATISFACTION

7.1 Introduction to Planning in AI
7.2 Planning Agents
7.3 Goals, Actions, and States
7.4 Classical Planning
7.5 State-Space Planning
7.6 Forward and Backward Planning
7.7 STRIPS Representation
7.8 Partial-Order Planning
7.9 Planning Under Uncertainty
7.10 Introduction to Constraint Satisfaction Problems
7.11 Variables, Domains, and Constraints
7.12 Constraint Graphs
7.13 Backtracking Search
7.14 Constraint Propagation
7.15 Arc Consistency
7.16 Applications of Constraint Satisfaction
7.17 Chapter Summary
7.18 Review Questions

### CHAPTER EIGHT: EXPERT SYSTEMS AND KNOWLEDGE-BASED APPLICATIONS

8.1 Introduction to Expert Systems
8.2 Definition and Characteristics
8.3 Components of Expert Systems
  8.3.1 Knowledge Base
  8.3.2 Inference Engine
  8.3.3 User Interface
  8.3.4 Explanation Facility
  8.3.5 Knowledge Acquisition
8.4 Architecture of Expert Systems
8.5 Rule-Based Expert Systems
8.6 Forward and Backward Reasoning
8.7 Knowledge Engineering
8.8 Development of Expert Systems
8.9 Advantages and Limitations
8.10 Examples of Expert Systems
8.11 Building a Simple Rule-Based Expert System
8.12 Chapter Summary
8.13 Review Questions

### CHAPTER NINE: AI ETHICS, APPLICATIONS, AND FUTURE DIRECTIONS

9.1 Artificial Intelligence in Modern Society
9.2 AI in Healthcare
9.3 AI in Education
9.4 AI in Agriculture
9.5 AI in Transportation
9.6 AI in Business and Finance
9.7 AI in Cybersecurity
9.8 AI in Robotics and Automation
9.9 Ethical Principles of Artificial Intelligence
9.10 Fairness and Accountability
9.11 Privacy and Security
9.12 Transparency and Explainability
9.13 Human-AI Interaction
9.14 Responsible AI Development
9.15 Social and Economic Impacts
9.16 Future Directions of Artificial Intelligence
9.17 Chapter Summary
9.18 Review Questions

## PRACTICAL LABORATORY EXERCISES

Lab 1: Implement a Simple Reflex Agent Using Python
Lab 2: Implement Breadth-First Search (BFS)
Lab 3: Implement Depth-First Search (DFS)
Lab 4: Implement Uniform-Cost Search
Lab 5: Implement A* Search
Lab 6: Implement the Minimax Algorithm
Lab 7: Implement Alpha-Beta Pruning
Lab 8: Build a Rule-Based Reasoning System
Lab 9: Solve a Constraint Satisfaction Problem
Lab 10: Develop a Simple Expert System

## APPENDICES

Appendix A: Artificial Intelligence Terminology
Appendix B: Search Algorithms and Pseudocode
Appendix C: Logic and Reasoning Formulas
Appendix D: Python Examples for Classical AI
Appendix E: Practical AI Project Ideas
Appendix F: Multiple-Choice Questions and Answer Keys

## REFERENCES

The course outline provides the structure for the complete Artificial Intelligence curriculum. Detailed chapter content, laboratory instructions, appendices, and references can be added as each course unit is developed.`;

async function main() {
  const summary = {
    course: 'reused' as 'created' | 'reused',
    chapter: 'reused' as 'created' | 'reused',
    lesson: 'reused' as 'created' | 'reused',
  };
  try {
    await db.$connect();
    await db.$transaction(
      async (tx) => {
        let course = await tx.course.findFirst({
          where: { title: 'Introduction to Artificial Intelligence' },
          orderBy: { created_at: 'asc' },
        });
        if (!course) {
          const instructor = await tx.user.findFirst({
            where: {
              role: { in: ['INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN'] },
              active: true,
            },
            orderBy: { created_at: 'asc' },
          });
          if (!instructor)
            throw new Error(
              'No active instructor or administrator exists to own the AI course',
            );
          course = await tx.course.create({
            data: {
              id: stableId('course'),
              instructor_id: instructor.id,
              title: 'Introduction to Artificial Intelligence',
              description:
                'A complete Artificial Intelligence course outline covering intelligent agents, search, reasoning, planning, expert systems, ethics, applications, and practical laboratories.',
              category: 'Artificial Intelligence',
              price_minor: 0,
              currency: 'ETB',
              published: true,
              visibility: 'PUBLIC',
            },
          });
          summary.course = 'created';
        }

        let chapter = await tx.chapter.findFirst({
          where: { course_id: course.id, title: 'Complete Course Outline' },
        });
        if (!chapter) {
          const last = await tx.chapter.findFirst({
            where: { course_id: course.id },
            orderBy: { position: 'desc' },
            select: { position: true },
          });
          chapter = await tx.chapter.create({
            data: {
              id: stableId('chapter'),
              course_id: course.id,
              title: 'Complete Course Outline',
              position: (last?.position ?? -1) + 1,
            },
          });
          summary.chapter = 'created';
        }

        const lessonId = stableId('lesson');
        const existingLesson = await tx.lesson.findUnique({
          where: { id: lessonId },
        });
        if (
          !existingLesson ||
          !(await tx.learningProgress.count({ where: { lesson_id: lessonId } }))
        ) {
          await tx.lesson.upsert({
            where: { id: lessonId },
            create: {
              id: lessonId,
              course_id: course.id,
              chapter_id: chapter.id,
              chapter: chapter.title,
              title: 'Complete Artificial Intelligence Course Outline',
              position: chapter.position,
              kind: 'TEXT',
              preview: true,
              content: outline,
            },
            update: {
              chapter_id: chapter.id,
              chapter: chapter.title,
              title: 'Complete Artificial Intelligence Course Outline',
              kind: 'TEXT',
              preview: true,
              content: outline,
            },
          });
          summary.lesson = existingLesson ? 'reused' : 'created';
        }
        await tx.course.update({
          where: { id: course.id },
          data: {
            description:
              'A complete Artificial Intelligence course outline covering intelligent agents, search, reasoning, planning, expert systems, ethics, applications, and practical laboratories.',
            category: 'Artificial Intelligence',
            published: true,
            visibility: 'PUBLIC',
            price_minor: 0,
            archived_at: null,
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'COURSE_CONTENT_SEEDED',
            resource_type: 'COURSE',
            resource_id: course.id,
            description:
              'Seeded the complete Artificial Intelligence course outline.',
            metadata: {
              chapter: chapter.title,
              source: 'user-provided course outline',
              chapters: 9,
              labs: 10,
              appendices: 6,
            } as Prisma.InputJsonValue,
          },
        });
      },
      { maxWait: 30_000, timeout: 120_000 },
    );
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await db.$disconnect();
  }
}

await main();
