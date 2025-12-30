# Primer: Core Concepts

This document gives a simple, beginner-friendly explanation of the core concepts
used in this project. It is meant as a quick introduction, not a full reference.

---

## ACP (Agent Control Plane)

ACP is the layer that manages how agents run.

It decides:
- when agents start and stop
- how many agents can run in parallel
- how agent state and progress are tracked

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
  ],
  "created_at": 1710000000
}
```

---

## Trajectories

A trajectory is the recorded history of what an agent did while solving a task.

It captures:
- actions taken by agents
- tool (skill) calls
- results and observations

Trajectories make agent behavior observable, debuggable, and reproducible.

### Example (trajectory as JSONL event stream)

```jsonl
{"run_id":"run_123","agent_id":"agent_search","step":1,"type":"action","name":"search_codebase","payload":{"query":"UserService"},"timestamp":1710000001}
{"run_id":"run_123","agent_id":"agent_search","step":2,"type":"observation","payload":{"files":["user_service.py","user_controller.py"]},"timestamp":1710000003}
{"run_id":"run_123","agent_id":"agent_patch","step":3,"type":"action","name":"apply_patch","payload":{"file":"user_service.py"},"timestamp":1710000006}
{"run_id":"run_123","agent_id":"agent_test","step":4,"type":"action","name":"run_tests","payload":{"cmd":"pytest"},"timestamp":1710000012}
{"run_id":"run_123","agent_id":"agent_test","step":5,"type":"observation","payload":{"status":"failed","errors":2},"timestamp":1710000018}
```

---

## MCP (Model Context Protocol)

MCP defines how models interact with tools, data, and external systems.

It provides:
- a standard way to describe tools
- structured inputs and outputs
- model-agnostic integrations

MCP separates what a tool does from how a model reasons about using it.

### Example (tool definition via MCP)

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
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "status": { "type": "string" },
      "errors": { "type": "integer" }
    }
  }
}
```

---

## Agents, Micro-Agents, Skills, Commands, and Rules

These concepts describe how work is broken down and executed.

- **Agent**
  The main decision-maker responsible for solving a task.
- **Micro-agent**
  A small, specialized agent that handles one step (searching, patching, testing).
- **Skill**
  A reusable capability an agent can use (e.g. run tests, edit files).
- **Command**
  A concrete execution of a skill with specific arguments.
- **Rule**
  A constraint or guideline that influences agent behavior but does not execute actions.

### Example (skill vs command vs rule)

**Skill**

```json
{
  "skill": "apply_patch",
  "description": "Apply a code patch to the workspace"
}
```

**Command**

```json
{
  "command": "apply_patch",
  "arguments": {
    "diff": "--- a/foo.py\n+++ b/foo.py\n..."
  }
}
```

**Rule**

```json
{
  "rule": "Do not modify public APIs",
  "scope": "code_changes",
  "severity": "hard"
}
```

### Example (micro-agent definition)

```json
{
  "agent_id": "agent_test",
  "role": "Fix failing tests",
  "skills": ["run_tests", "apply_patch"],
  "budget": {
    "max_steps": 10,
    "max_cost_usd": 1.0
  }
}
```

---

## Putting It All Together

At runtime, a single task (run) combines all of these concepts:

```json
{
  "run_id": "run_123",
  "goal": "Fix failing login tests",
  "acp": { "...": "..." },
  "agents": [ "...micro-agents..." ],
  "trajectory": [ "...event log..." ]
}
```

---

## Further Reading

- ACP: https://docs.openhands.dev/openhands/usage/run-openhands/acp
- Trajectories (OpenHands): https://docs.openhands.dev
- MCP (Model Context Protocol): https://modelcontextprotocol.io
- SWE-agent: https://github.com/princeton-nlp/SWE-agent
