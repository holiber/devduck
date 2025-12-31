# Primer: Core Concepts

This document provides a short, beginner-friendly explanation of the core
concepts used in this project. It is intended as a conceptual primer, not a
detailed reference.

All information is accurate to the best of our knowledge as of **late 2025**.

---

## ACP (Agent Control Plane)

ACP is the layer that manages how agents run.

It is responsible for:
- starting and stopping agents
- running agents in parallel
- tracking agent state and progress
- enforcing limits and constraints

Think of ACP as the **control center** for agent execution.

### Example (ACP state)

```json
{
  "run_id": "run_123",
  "repo": "org/project",
  "branch": "main",
  "status": "running",
  "max_agents": 3,
  "agents": [
    { "id": "agent_search", "state": "completed" },
    { "id": "agent_patch", "state": "running" },
    { "id": "agent_test", "state": "pending" }
  ]
}
```

⸻

## Trajectories

A trajectory is a structured record of what an agent actually did while solving
a task.

It records:
	•	actions taken
	•	tool or skill calls
	•	observations and results

Trajectories make agent behavior observable, debuggable, and reproducible.

### Example (trajectory as JSONL event stream)

```jsonl
{"run_id":"run_123","agent_id":"agent_search","step":1,"type":"action","name":"search_codebase","payload":{"query":"UserService"}}
{"run_id":"run_123","agent_id":"agent_search","step":2,"type":"observation","payload":{"files":["user_service.py"]}}
{"run_id":"run_123","agent_id":"agent_patch","step":3,"type":"action","name":"apply_patch","payload":{"file":"user_service.py"}}
{"run_id":"run_123","agent_id":"agent_test","step":4,"type":"action","name":"run_tests","payload":{"cmd":"pytest"}}
{"run_id":"run_123","agent_id":"agent_test","step":5,"type":"observation","payload":{"status":"failed","errors":2}}
```

⸻

## MCP (Model Context Protocol)

MCP defines a standard way for models to interact with tools, data, and external
systems.

It provides:
	•	structured tool definitions
	•	typed inputs and outputs
	•	model-agnostic integrations

MCP separates reasoning from execution.

### Example (tool definition)

```json
{
  "name": "run_tests",
  "description": "Run the project's test suite",
  "input_schema": {
    "type": "object",
    "properties": {
      "cmd": { "type": "string" }
    },
    "required": ["cmd"]
  }
}
```

⸻

## Agents, Micro-Agents, Skills, Commands, and Rules

	•	Agent – the main decision-maker responsible for solving a task
	•	Micro-agent – a specialized agent responsible for one step
	•	Skill – a reusable capability (e.g. edit files, run tests)
	•	Command – a concrete execution of a skill
	•	Rule – a non-executable constraint that guides behavior

⸻

## Tokens

A token is the basic unit of text processed by an LLM.

Approximate rule of thumb:
	•	1 token ≈ 3–4 characters of English text
	•	1 token ≈ ~0.75 words

Tokens affect:
	•	cost
	•	latency
	•	maximum context size

⸻

## Models and Characteristics (late 2025)

Ratings are relative and based on real-world agent usage, not synthetic benchmarks.

### Rating legend

	•	⭐⭐⭐⭐⭐ best-in-class
	•	⭐⭐⭐⭐ very strong
	•	⭐⭐⭐ solid
	•	⭐⭐ limited
	•	⭐ minimal

⸻

### Top-tier reasoning models

Model	Context	Speed	Cost	Reasoning
Claude 3.5 Sonnet / Opus	⭐⭐⭐⭐⭐	⭐⭐⭐	⭐⭐⭐	⭐⭐⭐⭐⭐
GPT-4.x (OpenAI)	⭐⭐⭐⭐	⭐⭐⭐	⭐⭐	⭐⭐⭐⭐⭐
GPT-4.1 (OpenAI)	⭐⭐⭐⭐	⭐⭐⭐	⭐⭐	⭐⭐⭐⭐⭐

⸻

### Fast and cost-efficient models

Model	Context	Speed	Cost	Reasoning
GPT-4o / 4o-mini	⭐⭐⭐⭐	⭐⭐⭐⭐⭐	⭐⭐⭐⭐	⭐⭐⭐⭐
Gemini 2.x Flash	⭐⭐⭐⭐⭐	⭐⭐⭐⭐	⭐⭐⭐⭐	⭐⭐⭐⭐
Claude 3 Haiku	⭐⭐⭐⭐	⭐⭐⭐⭐⭐	⭐⭐⭐⭐	⭐⭐⭐

⸻

### Large-context specialists

Model	Context	Speed	Cost	Reasoning
Gemini 1.5 Pro / 2.x Pro	⭐⭐⭐⭐⭐	⭐⭐⭐⭐	⭐⭐⭐	⭐⭐⭐⭐
Claude 3.5 Sonnet (long context)	⭐⭐⭐⭐⭐	⭐⭐⭐	⭐⭐⭐	⭐⭐⭐⭐⭐

⸻

### Open-source / self-hosted models

Model	Context	Speed	Cost	Reasoning
Mixtral 8x7B / 8x22B	⭐⭐⭐	⭐⭐⭐	⭐⭐⭐⭐⭐	⭐⭐⭐
LLaMA-3.x (70B)	⭐⭐⭐	⭐⭐	⭐⭐⭐⭐⭐	⭐⭐⭐
Qwen / DeepSeek-class	⭐⭐⭐	⭐⭐⭐	⭐⭐⭐⭐⭐	⭐⭐⭐

⸻

## Practical Guidance

	•	Use top-tier models for planning and complex reasoning
	•	Use fast, cheaper models for micro-agents and high-volume steps

Good agent architecture and grounding usually matter more than choosing the
“smartest” model.

⸻

## Further Reading

	•	OpenHands docs: https://docs.openhands.dev
	•	MCP: https://modelcontextprotocol.io
	•	OpenAI models: https://platform.openai.com/docs/models
	•	Anthropic Claude: https://docs.anthropic.com
	•	Google Gemini: https://ai.google.dev
	•	SWE-agent: https://github.com/princeton-nlp/SWE-agent

---

